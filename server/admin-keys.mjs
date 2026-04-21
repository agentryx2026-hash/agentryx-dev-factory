#!/usr/bin/env node
// Phase 2.5-B — HTTP API for the Key Console.
//
// Listens on port 4402 (configurable via ADMIN_PORT env). Proxied behind
// nginx with HTTP Basic Auth on /admin/api/keys/*. nginx forwards the
// authenticated username via X-Remote-User header — we use that as the
// audit `actor`.
//
// Run: node server/admin-keys.mjs
// Or via systemctl: factory-admin.service

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  getKey, setKey, listKeys, toggleKey, deleteKey, getAuditLog,
} from '../llm-router/src/keys.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const PORT = Number(process.env.ADMIN_PORT) || 4402;
const HOST = process.env.ADMIN_HOST || '127.0.0.1';

// Provider catalog — reloaded on every list call to support live edits.
function loadProviders() {
  const path = resolve(REPO_ROOT, 'configs', 'providers.json');
  return JSON.parse(readFileSync(path, 'utf8')).providers;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function sendJSON(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > 64 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function actorFrom(req) {
  return req.headers['x-remote-user'] || req.headers['x-forwarded-user'] || 'unknown';
}

function validateProvider(name, providers) {
  if (!providers[name]) {
    throw Object.assign(new Error(`unknown provider "${name}"`), { httpStatus: 400 });
  }
}

function validateKeyShape(plaintext, providers, name) {
  const p = providers[name];
  if (typeof plaintext !== 'string' || plaintext.length < 8) {
    throw Object.assign(new Error('key must be a string of at least 8 characters'), { httpStatus: 400 });
  }
  if (p.key_prefix && !plaintext.startsWith(p.key_prefix)) {
    throw Object.assign(new Error(`key for ${name} should start with "${p.key_prefix}" (got "${plaintext.slice(0, 6)}...")`), { httpStatus: 400 });
  }
  if (p.expected_length) {
    const [min, max] = p.expected_length;
    if (plaintext.length < min || plaintext.length > max) {
      throw Object.assign(new Error(`key length ${plaintext.length} outside expected [${min},${max}] for ${name}`), { httpStatus: 400 });
    }
  }
}

// ─── Routes ────────────────────────────────────────────────────────────────

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
  const path = url.pathname;
  const method = req.method;

  // Health (unauthenticated — used by systemd / docker / nginx)
  if (path === '/health' && method === 'GET') {
    return sendJSON(res, 200, { status: 'ok', service: 'factory-admin', port: PORT });
  }

  // ─── Provider catalog ──────────────────────
  if (path === '/api/admin/providers' && method === 'GET') {
    return sendJSON(res, 200, { providers: loadProviders() });
  }

  // ─── List keys (masked) ────────────────────
  if (path === '/api/admin/keys' && method === 'GET') {
    const keys = await listKeys();
    const providers = loadProviders();
    // Augment with catalog metadata so the UI can show every supported provider,
    // including ones with no key set yet.
    const merged = Object.entries(providers).map(([name, meta]) => {
      const stored = keys.find((k) => k.provider === name);
      return {
        provider: name,
        label: meta.label,
        docs_url: meta.docs_url,
        key_prefix_hint: meta.key_prefix,
        expected_length: meta.expected_length,
        ...(stored || { masked: null, length: null, enabled: false, last_used_at: null, created_at: null, updated_at: null }),
      };
    });
    // Also include any keys for providers NOT in catalog (legacy / test).
    for (const k of keys) {
      if (!providers[k.provider]) merged.push({ ...k, label: k.provider, _orphan: true });
    }
    return sendJSON(res, 200, { keys: merged });
  }

  // ─── Set / update a key ────────────────────
  // POST /api/admin/keys/:provider   body: { key, label?, notes? }
  let m = path.match(/^\/api\/admin\/keys\/([a-z0-9_-]+)$/i);
  if (m && method === 'POST') {
    const providers = loadProviders();
    const provider = m[1];
    validateProvider(provider, providers);
    const body = await readBody(req);
    if (!body.key) throw Object.assign(new Error('field "key" required'), { httpStatus: 400 });
    validateKeyShape(body.key, providers, provider);
    const result = await setKey(provider, body.key, { actor: actorFrom(req), label: body.label, notes: body.notes });
    return sendJSON(res, 200, { ok: true, ...result });
  }

  // ─── Delete a key ──────────────────────────
  if (m && method === 'DELETE') {
    const provider = m[1];
    const ok = await deleteKey(provider, { actor: actorFrom(req) });
    if (!ok) return sendJSON(res, 404, { error: `no key for provider ${provider}` });
    return sendJSON(res, 200, { ok: true, provider, action: 'deleted' });
  }

  // ─── Toggle enabled ────────────────────────
  // PATCH /api/admin/keys/:provider/toggle   body: { enabled: bool }
  m = path.match(/^\/api\/admin\/keys\/([a-z0-9_-]+)\/toggle$/i);
  if (m && method === 'PATCH') {
    const provider = m[1];
    const body = await readBody(req);
    if (typeof body.enabled !== 'boolean') {
      throw Object.assign(new Error('field "enabled" must be boolean'), { httpStatus: 400 });
    }
    const result = await toggleKey(provider, body.enabled, { actor: actorFrom(req) });
    if (!result) return sendJSON(res, 404, { error: `no key for provider ${provider}` });
    return sendJSON(res, 200, { ok: true, ...result });
  }

  // ─── Audit log ─────────────────────────────
  if (path === '/api/admin/keys/audit' && method === 'GET') {
    const provider = url.searchParams.get('provider');
    const limit = Math.min(Number(url.searchParams.get('limit') || '100'), 500);
    return sendJSON(res, 200, { entries: await getAuditLog({ provider, limit }) });
  }

  // ─── Test a stored key against the provider ──
  // POST /api/admin/keys/:provider/test  →  pings provider's models endpoint
  m = path.match(/^\/api\/admin\/keys\/([a-z0-9_-]+)\/test$/i);
  if (m && method === 'POST') {
    const providers = loadProviders();
    const provider = m[1];
    validateProvider(provider, providers);
    const meta = providers[provider];
    if (!meta.test_endpoint) return sendJSON(res, 200, { skipped: true, reason: `no test endpoint configured for ${provider}` });
    const apiKey = await getKey(provider);
    if (!apiKey) return sendJSON(res, 404, { error: `no enabled key stored for ${provider}` });
    const headers = meta.test_auth_header === 'x-api-key'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { 'Authorization': `Bearer ${apiKey}` };
    try {
      const t0 = Date.now();
      const resp = await fetch(meta.test_endpoint, { method: 'GET', headers, signal: AbortSignal.timeout(5000) });
      return sendJSON(res, 200, { ok: resp.ok, http_status: resp.status, latency_ms: Date.now() - t0 });
    } catch (err) {
      return sendJSON(res, 502, { ok: false, error: err.message });
    }
  }

  return sendJSON(res, 404, { error: 'route not found', path, method });
}

// ─── Server ────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (err) {
    const status = err.httpStatus || 500;
    sendJSON(res, status, { error: err.message });
    if (status >= 500) console.error('admin-keys 5xx:', err);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[factory-admin] listening on ${HOST}:${PORT}`);
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[factory-admin] ${sig} received, closing`);
    server.close(() => process.exit(0));
  });
}
