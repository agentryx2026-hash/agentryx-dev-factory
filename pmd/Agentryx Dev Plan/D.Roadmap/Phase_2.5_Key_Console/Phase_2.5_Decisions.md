# Phase 2.5 — Decisions Log

## D33 — Phase 2.5 inserted between 2D and 2E (security urgency)

**What**: Build the API Key Console BEFORE finishing Phase 2 (specifically before 2E budget caps).

**Why**: 6 secret leaks in this session (Anthropic key in chat, partial PAT via `gh auth status`, full keys via systemd journal error message, etc.). Each rotation cycle so far has involved another chat-paste step. Console eliminates the chat-paste pattern: keys go browser → encrypted DB, never through chat.

Budget caps (2E) protect against runaway spend; the key console protects against credential exfiltration. The latter is the bigger immediate concern given the leak history.

## D34 — AES-256-GCM for at-rest encryption (not KMS yet)

**What**: API keys stored in `provider_keys.ciphertext` encrypted with AES-256-GCM. Master key is 32 random bytes loaded from `~/.config/factory-master-key`.

**Why**:
- AEAD (Authenticated Encryption with Associated Data) catches tampering — important for a multi-tenant future.
- Standard, fast, in Node's `crypto` module — zero new deps.
- 32-byte key + 12-byte IV per row + 16-byte auth tag = textbook NIST SP 800-38D.

**Tradeoff**: Master key is a flat file on disk. If the VM is compromised, attacker gets master + ciphertext = same exposure as plaintext env vars. So this isn't "true" defense-in-depth — but it adds a meaningful layer against casual disk reads (e.g. an `rsync` of `~/Projects/` to a backup).

**v1.0 upgrade path**: Move master to GCP Secret Manager (or HashiCorp Vault). The schema and code don't change — only how the master is fetched.

## D35 — Master key location: `~/.config/factory-master-key` (chmod 600)

**What**: 32 random bytes, base64-encoded, in a flat file at `~/.config/factory-master-key`. Created by `deploy/restore.sh` on first run if missing. Owner: `subhash.thakur.india`. Mode: 0600.

**Why**:
- Same pattern we used for `agentryx-factory-token` — proven, simple.
- Outside any project directory → never accidentally committed.
- Restore.sh generates it fresh on a new VM if missing → restore.sh remains idempotent and "one command on a fresh box."

**Risk**: VM disk snapshot includes this file. Anyone who can read the snapshot can decrypt the keys DB. Acceptable at v0.0.1 R&D where snapshots stay in our GCP project. v1.0: snapshot encryption + KMS-managed master.

## D36 — Same htpasswd as claw-code for the admin UI

**What**: Phase 2.5-B and 2.5-C will guard `/admin/*` paths with the existing `/etc/nginx/.htpasswd-claw-code` file (same `subhash` user used for claw-code).

**Why**:
- Single credential to rotate later.
- Avoids designing a "real" auth system — that's Phase 12 (full B7) scope.
- Per-route auth blocks at nginx layer means downstream services don't need to know about auth at all.

## D37 — Provider catalog in `configs/providers.json` (declarative)

**What**: A static JSON file lists every supported provider, with display label, expected key prefix, and optional test endpoint:

```json
{
  "anthropic":  { "label": "Anthropic", "key_prefix": "sk-ant-", "test_endpoint": "https://api.anthropic.com/v1/models" },
  "openrouter": { "label": "OpenRouter", "key_prefix": "sk-or-v1-", "test_endpoint": "https://openrouter.ai/api/v1/models" },
  ...
}
```

**Why**: Adding a new provider = one row in JSON + (eventually) one `model_list` entry in LiteLLM config. No code changes. Decouples "what providers exist" (config) from "how we call them" (router code).

The prefix lets us validate user input before storing — catches "I pasted the wrong type of key" mistakes.

## D38 — Backend-first rollout (CLI test before HTTP API)

**What**: Phase 2.5-A ships a Node-CLI testable module (`keys.js` exports `getKey/setKey/listKeys/toggleKey/deleteKey`). 2.5-B wraps it in HTTP endpoints. 2.5-C wraps that in a React UI.

**Why**: Each layer is independently testable. If the HTTP API misbehaves we can verify the CRUD layer is fine via Node CLI. If the UI misbehaves we can verify the API via curl. Faster bisection on bugs.

## D39 — Audit log in same DB, separate table

**What**: `key_audit_log` table records every change (create/update/toggle/delete) with actor + provider + JSONB details + timestamp.

**Why**: Complements the encryption — you can see WHEN keys changed even if you can't see WHAT they changed to (ciphertext-only). Combined with nginx access logs (which see the auth user), gives full forensic chain.

**Privacy**: The `details` JSONB never contains the actual key value — only metadata (e.g. `{"prefix":"sk-ant","length":108}`). So the audit log is safe to read without decryption keys.

## D40 — `last_used_at` column updated by router, not by API

**What**: Router (Phase 2.5-D) updates `provider_keys.last_used_at` on every call that uses a key. Admin UI just reads it.

**Why**: True usage signal — if a key shows "last used: 3 weeks ago" with `enabled=true`, admin knows it's stale and can clean up. Tells operational story without needing a separate analytics layer.

**Performance**: One UPDATE per LLM call adds <2ms; non-blocking via fire-and-forget pattern (same as `insertCallRow`).

---

## Phase 2.5-B decisions (captured during execution)

### D41 — Separate systemd service (`factory-admin` on :4402) rather than extending telemetry.mjs

**What**: New service `factory-admin.service` running `server/admin-keys.mjs` on port 4402. Lives in the mono-repo at `agentryx-factory/server/`.

**Why**:
- telemetry.mjs is in `pixel-factory-ui/` (outside mono-repo until Phase 1.5) — adding admin routes there creates a snapshot-tracking problem for every change.
- Keeps admin concerns isolated from factory-flow concerns. If admin service crashes, factory keeps running (and vice versa).
- Simpler restart semantics — `systemctl restart factory-admin` doesn't interrupt in-flight cognitive-engine spawns.

**Tradeoff**: One more port + one more unit + one more systemd dependency. Acceptable.

### D42 — nginx strips `/admin/` before forwarding; admin-keys.mjs sees `/api/admin/keys/...`

**What**: The nginx `location /admin/api/` block has `rewrite ^/admin/(.*) /$1 break;` so the backend sees `/api/admin/keys/...` without the admin prefix. Backend routes match that shape.

**Why**: Keeps the backend path-naming aligned with the conventional `/api/admin/*` pattern (which is what the UI fetches). nginx just makes the public URL work.

### D43 — Admin service health check uses `/health` (unauthenticated)

**What**: `GET /health` returns `{status:'ok',service,port}` without any auth. Used by systemd + docker + anything monitoring for liveness.

**Why**: Health checks must not require auth or they become noisy 401s. The endpoint reveals only the service name + port, not any config or data.

---

## Phase 2.5-C decisions

### D44 — UI is duck-typed state-based page (not React Router)

**What**: AdminKeys tab added to the existing state-based `activePage` switch in App.tsx. No URL routing, no react-router-dom added.

**Why**: Consistent with existing pattern (PreDev, FactoryFloor, PostDev, Analytics, SkillMemory, SystemResources, AdminConfig are all state-switched). Adding React Router now would require a sweeping refactor outside this phase's scope. Page is accessible via the sidebar click — sufficient.

### D45 — Admin UI auth is triggered on first fetch, not page load

**What**: No separate auth gate on the dashboard page itself. Browser asks for Basic Auth the FIRST time any `/admin/api/*` call runs (i.e., when the AdminKeys page fetches its data).

**Why**: UX: non-admin users never see an auth prompt when browsing the rest of the dashboard. The prompt appears only when they click "API Keys", which is a signal they intend to authenticate.

**Alternative rejected**: gating `/admin/` as a URL at nginx → too aggressive; broke the state-based UI model.

### D46 — "Test" button pings provider's `/models` endpoint

**What**: UI has a "Test" button per key that calls `POST /api/admin/keys/:provider/test` which fetches the provider's `/models` endpoint with the stored key.

**Why**: Quick way to verify a newly-entered key is valid before trusting it in production. Uses provider's cheapest read endpoint (5-second timeout). Non-destructive.

---

## Phase 2.5-D decisions

### D47 — Keys resolution order: DB → env var → null (401)

**What**: `resolveKey(backend, envVarName)` in `backends.js` checks DB first via `getKey(provider)`. If no enabled DB key, reads `process.env[envVarName]`. If neither, returns null → 401 error.

**Why**:
- DB-first ensures the Admin UI is the source of truth once a key is set there.
- Env-var fallback preserves the bootstrap experience — on a fresh VM with no DB keys yet, the router still works if `.env` has keys. Smooth migration path.
- Explicit null return (not "undefined") makes downstream 401 logic deterministic.

### D48 — LiteLLM master key stays in env, not DB

**What**: `LITELLM_MASTER_KEY` is still read from `process.env`. Only the 4 provider backends (openrouter, direct-anthropic, direct-openai, direct-gemini) go through the DB.

**Why**: LiteLLM's master key is **infrastructure config**, not a provider secret. It gates a local proxy, not a cloud provider. Storing it in the admin-UI DB would be category confusion — and the UI wouldn't know what to do with it.

### D49 — Router fire-and-forgets `touchLastUsed(provider)` on success

**What**: On successful backend call, router calls `touchLastUsed(provider)` which launches a `pool.query(UPDATE)` without awaiting it.

**Why**: Admin UI's `last_used_at` is a UX nicety, not critical. Making the router await an UPDATE adds ~2ms latency to every LLM call for no user benefit. Fire-and-forget pattern also matches `insertCallRow` (D17 fail-open policy).

**Observed**: verified end-to-end — post-cutover test showed `last_used_at` jumped from `null` to a timestamp within 1 second of the first call. Good enough.

### D50 — Env var names kept for fallback even after DB has keys

**What**: Even when DB has keys, router never removes env-var support. Admin can deliberately unset env vars if they want to force DB-only mode.

**Why**: Operators may have an emergency recovery scenario — DB down, need to bring router back up with a quick `.env` update. Preserving env fallback means no redeploy needed in that scenario.

**Documentation**: Will add a deploy/README note once Phase 2.5-E closes: "After admin UI is live and you've added keys, you may delete `.env` values or keep them as disaster-recovery backup."
