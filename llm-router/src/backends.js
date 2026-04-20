// HTTP clients for the four backends the router understands.
//
// The OpenRouter, LiteLLM, and direct-openai backends all speak OpenAI's
// /chat/completions shape — so they share one implementation. Anthropic-direct
// uses the Messages API (different shape). Gemini-direct uses generativeai.

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const LITELLM_BASE    = process.env.LITELLM_BASE_URL || 'http://localhost:4000';
const ANTHROPIC_BASE  = 'https://api.anthropic.com/v1';
const GEMINI_BASE     = 'https://generativelanguage.googleapis.com/v1beta';

export async function callBackend({ backend, model, messages, signal = null, timeoutMs = 60_000 }) {
  switch (backend) {
    case 'openrouter':      return callOpenAICompatible(OPENROUTER_BASE, process.env.OPENROUTER_API_KEY, model, messages, { signal, timeoutMs });
    case 'litellm':         return callOpenAICompatible(LITELLM_BASE,    process.env.LITELLM_API_KEY ?? 'sk-litellm', model, messages, { signal, timeoutMs });
    case 'direct-openai':   return callOpenAICompatible('https://api.openai.com/v1', process.env.OPENAI_API_KEY, model, messages, { signal, timeoutMs });
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
  const body = JSON.stringify({ model, messages, stream: false });
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw httpError(401, 'ANTHROPIC_API_KEY not set for direct-anthropic backend');

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
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw httpError(401, 'GOOGLE_API_KEY not set for direct-gemini backend');
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
