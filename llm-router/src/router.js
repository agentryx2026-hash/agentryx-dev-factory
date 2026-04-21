// Router: task → fallback chain → call → cost capture.
//
// The only smart module in the package. Everything else (backends, cost, config)
// is thin glue. See pmd/Agentryx Dev Plan/D.Roadmap/Phase_02_LLM_Router/.

import { callBackend } from './backends.js';
import { loadConfig } from './config.js';
import { computeCost } from './cost.js';
import { insertCallRow } from './db.js';

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

// Parse "backend:model" or bare "model" (defaults to openrouter for convenience).
// Backend-qualified examples:
//   openrouter:anthropic/claude-opus-4-7
//   direct-anthropic:claude-opus-4-7
//   litellm:claude-sonnet-4-6
function parseEntry(entry) {
  const colon = entry.indexOf(':');
  if (colon === -1) {
    return ['openrouter', entry];
  }
  return [entry.slice(0, colon), entry.slice(colon + 1)];
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
