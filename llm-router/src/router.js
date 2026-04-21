// Router: task → fallback chain → call → cost capture.
//
// The only smart module in the package. Everything else (backends, cost, config)
// is thin glue. See pmd/Agentryx Dev Plan/D.Roadmap/Phase_02_LLM_Router/.

import { callBackend } from './backends.js';
import { loadConfig } from './config.js';
import { computeCost } from './cost.js';
import { insertCallRow, projectSpendSinceMidnight, dailySpendTotal } from './db.js';

// Errors that clearly indicate a malformed *payload* (same payload would fail
// on any provider) — these break the chain. Everything else (auth, billing,
// rate limit, outage) is specific to one backend and falls over to the next.
const PAYLOAD_ERROR_STATUSES = new Set([413, 414, 415, 422]);

export async function complete({
  task,
  messages,
  projectId = null,
  phase = null,
  agent = null,
  modelOverride = null,
  signal = null,
}) {
  if (!task) throw new Error('complete(): task is required');
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('complete(): messages must be a non-empty array');
  }

  const cfg = loadConfig();
  const taskCfg = cfg.tasks[task];
  if (!taskCfg) {
    throw new Error(`complete(): unknown task "${task}". Configure it in configs/llm-routing.json`);
  }

  // Fallback chain: modelOverride (if given) → task's primary → fallback_1 → fallback_2.
  const chain = modelOverride
    ? [modelOverride]
    : [taskCfg.primary, ...(taskCfg.fallbacks ?? [])].filter(Boolean);

  if (chain.length === 0) {
    throw new Error(`complete(): no models configured for task "${task}"`);
  }

  // ─── Phase 2E: pre-call budget cap ────────────────────────────────────
  // Fail-CLOSED (unlike cost capture which is fail-open): if we can't verify
  // spend, we refuse the call unless LLM_ROUTER_ALLOW_UNCHECKED=true.
  const allowUnchecked = process.env.LLM_ROUTER_ALLOW_UNCHECKED === 'true';
  const projectCap = cfg.defaults?.max_project_budget_usd ?? Infinity;
  const dailyCap   = cfg.defaults?.max_daily_budget_usd   ?? Infinity;

  const budgetReject = await checkBudget({
    projectId, projectCap, dailyCap, allowUnchecked,
  });
  if (budgetReject) {
    emitCallRow({
      ts: new Date().toISOString(),
      project_id: projectId,
      phase,
      agent,
      task_type: task,
      model_attempted: chain,
      model_succeeded: null,
      error: `budget_exceeded: ${budgetReject.reason}`,
    });
    throw Object.assign(new Error(`complete(): ${budgetReject.reason}`), {
      budgetExceeded: true,
      ...budgetReject,
    });
  }

  const attempts = [];
  const startWall = Date.now();

  for (const entry of chain) {
    const [backend, model] = parseEntry(entry);
    const t0 = Date.now();
    try {
      const result = await callBackend({ backend, model, messages, signal });
      const latency_ms = Date.now() - t0;
      const cost_usd = computeCost(model, result.usage);

      // Hook for Phase 2C — emit a structured row. Non-blocking.
      emitCallRow({
        ts: new Date().toISOString(),
        project_id: projectId,
        phase,
        agent,
        task_type: task,
        router_backend: backend,
        model_attempted: chain,
        model_succeeded: entry,
        input_tokens: result.usage?.prompt_tokens ?? null,
        output_tokens: result.usage?.completion_tokens ?? null,
        cost_usd,
        latency_ms,
        request_id: result.id ?? null,
        error: null,
      });

      return {
        role: 'assistant',
        content: result.content,
        model: entry,
        backend,
        cost_usd,
        latency_ms,
        usage: result.usage,
        raw: result.raw,
      };
    } catch (err) {
      const latency_ms = Date.now() - t0;
      const payloadFatal = err.httpStatus ? PAYLOAD_ERROR_STATUSES.has(err.httpStatus) : false;
      attempts.push({ entry, error: err.message, httpStatus: err.httpStatus, fallOver: !payloadFatal, latency_ms });

      // Truly fatal — the request shape itself is wrong, no fallback will save us.
      if (payloadFatal) {
        emitCallRow({
          ts: new Date().toISOString(),
          project_id: projectId,
          phase,
          agent,
          task_type: task,
          model_attempted: chain,
          model_succeeded: null,
          error: `payload-fatal ${err.httpStatus}: ${err.message}`,
        });
        throw Object.assign(new Error(`complete(): payload-fatal error from ${entry}: ${err.message}`), {
          attempts,
          cause: err,
        });
      }
      // Otherwise fall through to next entry in chain — auth/billing/429/5xx are
      // all per-backend and next entry may have a different backend or key.
    }
  }

  // Exhausted the chain.
  const totalLatency = Date.now() - startWall;
  emitCallRow({
    ts: new Date().toISOString(),
    project_id: projectId,
    phase,
    agent,
    task_type: task,
    model_attempted: chain,
    model_succeeded: null,
    latency_ms: totalLatency,
    error: 'all fallbacks exhausted',
  });
  throw Object.assign(new Error(`complete(): all ${chain.length} models failed for task "${task}"`), {
    attempts,
  });
}

export async function compare({ messages, models, signal = null }) {
  // Run N models in parallel on the same input. Surface whichever succeeds/fails.
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('compare(): models must be a non-empty array');
  }
  const calls = models.map(async (entry) => {
    const [backend, model] = parseEntry(entry);
    const t0 = Date.now();
    try {
      const result = await callBackend({ backend, model, messages, signal });
      return {
        model: entry,
        content: result.content,
        latency_ms: Date.now() - t0,
        cost_usd: computeCost(model, result.usage),
        usage: result.usage,
        error: null,
      };
    } catch (err) {
      return {
        model: entry,
        content: null,
        latency_ms: Date.now() - t0,
        cost_usd: 0,
        usage: null,
        error: err.message,
      };
    }
  });
  return Promise.all(calls);
}

// Parse "backend:model" or bare "model".
//
// For bare model names, the default backend is taken from the env var
// LLM_ROUTER_BACKEND (Phase 2D — admin-flippable). Falls back to 'openrouter'
// if the env var is unset, which is the safest default (works without any
// self-hosted infra).
//
// Examples (all valid):
//   openrouter:anthropic/claude-opus-4-7   ← explicit backend
//   direct-anthropic:claude-opus-4-7       ← bypass any router proxy
//   litellm:claude-sonnet-4-6              ← go via self-hosted LiteLLM
//   anthropic/claude-opus-4-7              ← bare; uses LLM_ROUTER_BACKEND env
const KNOWN_BACKENDS = new Set(['openrouter', 'litellm', 'direct-anthropic', 'direct-gemini', 'direct-openai']);

function parseEntry(entry) {
  const colon = entry.indexOf(':');
  if (colon !== -1) {
    const candidate = entry.slice(0, colon);
    // Only treat the prefix as a backend if we recognize it. Otherwise the colon
    // is part of the model name (e.g. "groq:llama-3.1" if we add Groq later).
    if (KNOWN_BACKENDS.has(candidate)) {
      return [candidate, entry.slice(colon + 1)];
    }
  }
  const defaultBackend = process.env.LLM_ROUTER_BACKEND || 'openrouter';
  return [defaultBackend, entry];
}

// Phase 2C: try Postgres INSERT first; on any error, fall back to stderr. Both
// are non-blocking — this function returns void synchronously (the await on db
// happens but the caller already has its result by the time we get here).
function emitCallRow(row) {
  insertCallRow(row).catch(err => {
    try {
      process.stderr.write(`LLM_CALL_FATAL emit failed entirely :: ${err.message} :: ${JSON.stringify(row)}\n`);
    } catch { /* nothing more we can do */ }
  });
}

// Phase 2E: return null if allowed, or {reason, projectSpend?, dailySpend?, cap?}
// if rejected. Fail-CLOSED by default — a null from the DB means "unknown spend"
// which we treat as "refuse" unless allowUnchecked is on.
async function checkBudget({ projectId, projectCap, dailyCap, allowUnchecked }) {
  // Unbounded caps — skip the DB round-trips entirely.
  if (!isFinite(projectCap) && !isFinite(dailyCap)) return null;

  const [projectSpend, dailySpend] = await Promise.all([
    projectId && isFinite(projectCap) ? projectSpendSinceMidnight(projectId) : Promise.resolve(0),
    isFinite(dailyCap) ? dailySpendTotal() : Promise.resolve(0),
  ]);

  // DB unreachable or error → projectSpendSinceMidnight/dailySpendTotal returned null.
  if (projectSpend === null || dailySpend === null) {
    if (allowUnchecked) return null;
    return {
      reason: 'cannot verify spend — DB unreachable and LLM_ROUTER_ALLOW_UNCHECKED not set',
      cap: 'unknown',
    };
  }

  if (projectId && isFinite(projectCap) && projectSpend >= projectCap) {
    return {
      reason: `project "${projectId}" spent $${projectSpend.toFixed(4)} today; cap is $${projectCap}`,
      projectSpend,
      cap: projectCap,
      scope: 'project',
    };
  }
  if (isFinite(dailyCap) && dailySpend >= dailyCap) {
    return {
      reason: `daily factory total spent $${dailySpend.toFixed(4)} today; cap is $${dailyCap}`,
      dailySpend,
      cap: dailyCap,
      scope: 'daily',
    };
  }
  return null;
}
