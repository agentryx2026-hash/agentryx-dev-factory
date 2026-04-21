// HTTP clients for the four backends the router understands.
//
// The OpenRouter, LiteLLM, and direct-openai backends all speak OpenAI's
// /chat/completions shape — so they share one implementation. Anthropic-direct
// uses the Messages API (different shape). Gemini-direct uses generativeai.
//
// Phase 2.5-D: API keys come from the encrypted DB (provider_keys table) via
// keys.js. If the DB is unreachable or no key stored for this provider, we
// fall back to the legacy env-var path so existing deployments keep working.

import { getKey, touchLastUsed } from './keys.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const LITELLM_BASE    = process.env.LITELLM_BASE_URL || 'http://localhost:4000';
const ANTHROPIC_BASE  = 'https://api.anthropic.com/v1';
const GEMINI_BASE     = 'https://generativelanguage.googleapis.com/v1beta';

// Logical provider names used by the keys table. Backends map to these.
// Note: 'litellm' is a PROXY; its own auth key is local and minor — we keep
// the env-var path for it because LITELLM_MASTER_KEY is deployment config,
// not a per-tenant provider secret.
const PROVIDER_MAP = {
  openrouter:        'openrouter',
  'direct-anthropic':'anthropic',
  'direct-openai':   'openai',
  'direct-gemini':   'gemini',
};

async function resolveKey(backend, envVarFallback) {
  const provider = PROVIDER_MAP[backend];
  if (provider) {
    const dbKey = await getKey(provider);
    if (dbKey) {
      // Fire-and-forget — update last_used_at so the admin UI shows real usage.
      touchLastUsed(provider);
      return dbKey;
    }
  }
  return process.env[envVarFallback] || null;
}

export async function callBackend({ backend, model, messages, signal = null, timeoutMs = 60_000 }) {
  switch (backend) {
    case 'openrouter': {
      const key = await resolveKey(backend, 'OPENROUTER_API_KEY');
      return callOpenAICompatible(OPENROUTER_BASE, key, model, messages, { signal, timeoutMs });
    }
    case 'litellm':
      // Master key for local proxy stays in env — it's infra, not a provider secret.
      return callOpenAICompatible(LITELLM_BASE, process.env.LITELLM_MASTER_KEY ?? 'sk-litellm-dev', model, messages, { signal, timeoutMs });
    case 'direct-openai': {
      const key = await resolveKey(backend, 'OPENAI_API_KEY');
      return callOpenAICompatible('https://api.openai.com/v1', key, model, messages, { signal, timeoutMs });
    }
    case 'direct-anthropic': return callAnthropicDirect(model, messages, { signal, timeoutMs });
    case 'direct-gemini':    return callGeminiDirect(model, messages, { signal, timeoutMs });
    default:
      throw new Error(`Unknown backend "${backend}". Use one of: openrouter, litellm, direct-openai, direct-anthropic, direct-gemini`);
  }
}

// ─── OpenAI-format backend (used for openrouter, litellm, direct-openai) ─────
async function callOpenAICompatible(baseUrl, apiKey, model, messages, { signal, timeoutMs }) {
  if (!apiKey) {
    throw httpError(401, `missing API key for backend at ${baseUrl} — set the corresponding _API_KEY env var`);
  }
  // max_tokens cap: providers like Anthropic-via-OpenRouter reserve credits
  // upfront based on the cap (not actual usage). Default model max can be 64K
  // which requires a heavy prepaid balance. 4096 is sane for most factory tasks
  // and per-task overrides land in 2D.
  const body = JSON.stringify({ model, messages, stream: false, max_tokens: 4096 });
  const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://dev-hub.agentryx.dev',  // OpenRouter attribution
      'X-Title': 'Agentryx Dev Factory',
    },
    body,
    signal,
  }, timeoutMs);
  if (!res.ok) throw httpError(res.status, await safeText(res));
  const data = await res.json();
  return {
    id: data.id,
    content: data.choices?.[0]?.message?.content ?? '',
    usage: data.usage ?? null,
    raw: data,
  };
}

// ─── Anthropic Messages API (direct) ─────────────────────────────────────────
async function callAnthropicDirect(model, messages, { signal, timeoutMs }) {
  const apiKey = await resolveKey('direct-anthropic', 'ANTHROPIC_API_KEY');
  if (!apiKey) throw httpError(401, 'no anthropic key available — set one in the admin console or export ANTHROPIC_API_KEY');

  // Anthropic wants system prompt separated from messages.
  const system = messages.find(m => m.role === 'system')?.content;
  const userMessages = messages.filter(m => m.role !== 'system');

  const res = await fetchWithTimeout(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: userMessages,
    }),
    signal,
  }, timeoutMs);
  if (!res.ok) throw httpError(res.status, await safeText(res));
  const data = await res.json();
  return {
    id: data.id,
    content: (data.content ?? []).map(b => b.text ?? '').join(''),
    usage: data.usage
      ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens }
      : null,
    raw: data,
  };
}

// ─── Gemini (direct) ─────────────────────────────────────────────────────────
async function callGeminiDirect(model, messages, { signal, timeoutMs }) {
  const apiKey = (await resolveKey('direct-gemini', 'GEMINI_API_KEY')) ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw httpError(401, 'no gemini key available — set one in the admin console or export GEMINI_API_KEY');
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`;
  const geminiMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: geminiMessages }),
    signal,
  }, timeoutMs);
  if (!res.ok) throw httpError(res.status, await safeText(res));
  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  return {
    id: null,
    content,
    usage: data.usageMetadata
      ? { prompt_tokens: data.usageMetadata.promptTokenCount, completion_tokens: data.usageMetadata.candidatesTokenCount }
      : null,
    raw: data,
  };
}

// ─── Health + discovery ──────────────────────────────────────────────────────
export async function health() {
  const checks = {};
  // Only check backends whose API key is configured.
  if (process.env.OPENROUTER_API_KEY)  checks.openrouter = await ping(`${OPENROUTER_BASE}/models`, process.env.OPENROUTER_API_KEY);
  if (process.env.ANTHROPIC_API_KEY)   checks['direct-anthropic'] = await ping(`${ANTHROPIC_BASE}/models`, process.env.ANTHROPIC_API_KEY, 'anthropic');
  if (process.env.OPENAI_API_KEY)      checks['direct-openai'] = await ping('https://api.openai.com/v1/models', process.env.OPENAI_API_KEY);
  if (process.env.LITELLM_BASE_URL)    checks.litellm = await ping(`${LITELLM_BASE}/health`, process.env.LITELLM_API_KEY ?? 'x');
  return checks;
}

export function listBackends() {
  return ['openrouter', 'litellm', 'direct-openai', 'direct-anthropic', 'direct-gemini'];
}

async function ping(url, apiKey, style = 'bearer') {
  try {
    const headers = style === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${apiKey}` };
    const res = await fetchWithTimeout(url, { headers }, 5_000);
    return res.ok ? 'ok' : `http_${res.status}`;
  } catch (e) {
    return `error:${e.message}`;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function httpError(status, body) {
  const err = new Error(body || `HTTP ${status}`);
  err.httpStatus = status;
  return err;
}

async function safeText(res) {
  try { return await res.text(); } catch { return '<unreadable body>'; }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // If caller provided signal, chain it.
    if (init.signal) init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}
