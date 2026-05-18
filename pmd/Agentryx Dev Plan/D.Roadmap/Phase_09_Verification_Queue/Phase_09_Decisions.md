# Phase 9 — Decisions Log

## D115 — Mock client as default; real HTTP client deferred to 9-B

**What**: `getVerifyClient()` returns a mock-backed client unless `VERIFY_CLIENT=http` is set. The mock stores bundles in memory, returns a `mock://` portal URL, and is fully inspectable.

**Why**:
- **Verify multi-app mode isn't shipped yet** (per boundary contract doc, this is an open question before 9-B).
- **Factory dev needs a contract to build against today.** Mock lets cognitive-engine evolve without depending on Verify-side timelines.
- **Unit-testability**: the mock makes 9-A's smoke test deterministic without network or auth.
- **Auth choice (shared secret vs OAuth) is also open** — mock sidesteps it until real decisions are made.

**Consequence**: real integration is a 9-B PR that swaps the default client and adds the webhook endpoint in telemetry.mjs. Today's factory runs use the mock harmlessly when the flag is on.

## D116 — BuildBundles reference artifacts by ID, not inline content

**What**: `review_items[i].artifact_id` is a string like `"ART-0033"`. Verify fetches the actual content via a factory endpoint (TBD in 9-B).

**Why**:
- **Bundle payload size.** Inlining a code_output artifact + a qa_report + 3 screenshots easily crosses megabytes. HTTP POSTs to Verify would be wasteful.
- **Single source of truth.** Artifacts live in `_artifacts/` (Phase 6-A). Inlining would mean two copies — one mutable on disk, one frozen in Verify's DB. Diverge over time.
- **Lazy fetch.** Verify only needs the artifact body when a reviewer opens that item. Most review items never get expanded; saving the roundtrip wins.

**Tradeoff**: Verify can't render a fully offline bundle view. Acceptable; Verify is online-first anyway.

## D117 — Fix-cycle routing stubbed in 9-A, real in 9-B

**What**: `handleFeedback()` accepts an optional `fixRouter` dependency. If absent, the planned route is returned with a stubbed `{stubbed: true, note: "9-A — stub"}` result. If supplied, the router is invoked.

**Why**:
- **Real routing needs the fix-cycle agents themselves.** Invoking Spock for code fixes means spawning an LLM call — blocks on OpenRouter credit (same as 5-B / 6-B / 7-E / 8-B).
- **Stub-via-dependency-injection is clean.** 9-A smoke test passes in a stub. 9-B passes in a real router. Production tests (once wired) inject a real LLM-backed router. No code branches inside `handleFeedback`.
- **Separates "did we capture the feedback correctly?" (9-A) from "did we act on it correctly?" (9-B).** Each subphase tests exactly one thing.

## D118 — Observations use existing `project:<id>` scope, no new kind

**What**: Reviewer feedback becomes a `user_note` observation at `project:<project_id>` scope, with `produced_by.source = "verify_portal"` and `produced_by.agent = "human:<reviewer_email>"`.

**Why**:
- **Memory layer (Phase 7-A) already designed for this.** `user_note` kind explicitly cited Verify portal as the canonical producer.
- **Scope is per-project, not global.** A review decision on the todo-app's v0.0.1 belongs to that project's memory; future projects shouldn't see it as a "lesson" unless explicitly promoted.
- **Provenance fields distinguish human-from-agent writes.** `agent: "human:<email>"` is the convention memory-layer types.js already suggests. Consistency saves a schema invention.

## D119 — Fail-open integration posture

**What**: Unreachable Verify (network error, 5xx, timeout) causes the mock/http client to return `{ok: false, error, fail_open: true}`. The publish step is logged; the factory pipeline continues.

**Why**:
- **Factory pipeline is artifact-first (P2).** A successful factory run with an unfinished human review is still a useful run — code and docs are in `_artifacts/`, Verify publish is a separate concern.
- **Verify is a sibling service, not a blocker.** Design mirrors llm-router's fail-open cost capture (Phase 2C) — observability never blocks execution.
- **Retry is a 9-B or later concern.** 9-A captures the failure + logs; 9-B can add a retry queue if reliability warrants it.

**Rejection case**: invalid feedback payloads (validation failures in `handleFeedback`) return `{ok: false, error}` so the eventual HTTP handler can respond 400. That's *payload-level* fail-closed, not *network-level*. Different problem, different semantics.

## D213 — Webhook auth deferred; plan-don't-execute the fix route (added 2026-05-10)

**What**: The Phase 9-B webhook substrate at `POST /api/factory-admin/verify/webhook` ships with two intentional deferrals:
1. **No auth on the endpoint** — accepts any well-formed `FeedbackPayload`; HMAC verification against a shared secret is a full-9-B item.
2. **Plans the fix route but does not execute it** — `handleFeedback` returns a `FixRoute` (`{lane, agent, reason}`); the webhook persists it, logs it, ships it back in the response, but does NOT invoke the agent automatically.

**Why no auth (yet)**:
- v0.0.1 single-VM single-founder: the telemetry server is bound to localhost-via-nginx; no external Verify-stg is calling it yet.
- The Verify portal itself isn't deployed for multi-app mode yet; until that lands the webhook is a contract surface, not a production endpoint.
- Adding HMAC now requires a shared-secret rotation story, a Key Console entry, and a Verify-side signer — all of which belong to the same coordinated 9-B remainder ship.
- Auth IS required before any external Verify-stg deploy; this decision is "wait until there's something to authenticate," not "skip auth."

**Why plan-don't-execute**:
- The route depends on per-project context (project dir, last-known dev-graph state, OpenRouter credit) that the webhook doesn't currently load.
- Auto-routing a `partial`/`fail` decision into a fresh `tuvok`/`spock`/`data` invocation is a meaningful spend without founder sign-off — better to surface the route in the UI and let the founder confirm-and-trigger via the existing Phase 14-B queue submit panel for now.
- This matches D117's posture from 9-A: "Fix-cycle routing stubbed in 9-A, real in 9-B" — the substrate is here, the auto-invocation is the last 9-B mile.

**Tradeoff**: a Verify reviewer who flags a fail today still requires founder action (one queue submit) before the fix cycle runs. Acceptable while real factory cycles cost real OpenRouter dollars; the auto-router lands once budget guardrails (Phase 14-B per-project quotas, just shipped via D212) are paired with an explicit `verify_auto_route: true` flag per project.

## D214 — Append-only JSONL log for webhook audit (added 2026-05-10)

**What**: Every webhook hit (success OR failure) appends one JSON record to `_factory_runtime/verify_feedback.jsonl`. The Verify panel reads the tail of this file to show "recent feedback."

**Why JSONL over Postgres or in-memory**:
- Matches Phase 11-A and Phase 14-A conventions: filesystem-first, observable via `tail -f`, no DB dependency.
- Idempotent restart: telemetry can restart without losing the visible history.
- Rotates trivially once it matters (`logrotate` or a Phase 14-A-style sweep — not needed at v0.0.1 volumes).

**Why log failures too**: a 400 response from the webhook IS evidence — likely a Verify-side schema drift. Persisting the failure (with `ok: false, error`) puts it in the founder's UI alongside successes so contract regressions are caught early.

## D218 — Webhook auth via HMAC-SHA256 + dev-mode bypass when secret unset (added 2026-05-11)

**What**: Phase 9-B's `/api/factory-admin/verify/webhook` endpoint now verifies an `X-Verify-Signature` HMAC-SHA256 header against the raw request body and `process.env.VERIFY_WEBHOOK_SECRET`. When the secret is unset (or empty), verification is bypassed with a warn log — preserving the substrate's open-endpoint behaviour from the initial 9-B ship as an explicit opt-out.

**Why HMAC-SHA256 (not JWT, not OAuth, not mTLS)**:
- **Industry standard for webhooks**: Slack, Stripe, GitHub, Twilio all sign webhooks the same way. Matching the convention saves Verify-side signer work — copy any existing implementation.
- **No issuance / rotation machinery at v0.0.1**: rotate by editing one env var on each side. JWT would need an issuer + key-rotation flow Phase 22 hasn't built yet. mTLS would need cert management infrastructure we don't have. HMAC is the minimum-machinery option that's still cryptographically sound.
- **Constant-time compare via `crypto.timingSafeEqual`**: prevents timing-attack signature recovery.
- **Phase 22 (Action Boundary Enforcement, v2→v3) replaces this** with proper signer + key rotation — HMAC here is the v0.0.1→v2 placeholder, not the final answer.

**Why dev-mode bypass (no secret = open endpoint)**:
- The initial 9-B substrate shipped intentionally open (D213) so the factory and Verify-stg could iterate the contract without coordinating secrets.
- Forcing HMAC by default would mean every dev environment needs the secret set or the webhook breaks — annoying friction for legitimate exploration.
- Opt-in to enforcement is the explicit choice: set the env var per-environment when ready. Staging-on / dev-off is a normal operational pattern.
- Production should always have the secret set; the warn log on every bypass surfaces forgotten-secret incidents loudly.

**Why raw-bytes-before-JSON.parse**:
- HMAC signs bytes, not abstract JSON. JSON canonicalisation (key order, whitespace, escaping) silently differs between signers and verifiers; signing the raw payload bytes avoids that whole category of bug.
- This is why Slack / Stripe / GitHub all sign the raw body, not a re-serialised version. Following the convention exactly.

**Tradeoff acknowledged**: the dev-mode bypass creates a "warn-then-allow" path that a careless operator could miss in logs. Mitigation: the warn log fires on every request (loud, hard to ignore); the Verify panel in Admin · Configuration could surface "last X requests bypassed auth" in a future ship if it becomes a real concern.
