# Phase 9 — Status: 9-A + 9-B Tier B (read UI) + 9-B webhook substrate COMPLETE ✅  (9-B remainder DEFERRED — Verify-stg auth + real http client + auto-routed fix cycle)

**Phase started**: 2026-04-22
**Phase 9-A closed**: 2026-04-22 (substrate — bundle/feedback contract, mock client, fix-router)
**Phase 9-B Tier B closed**: 2026-05-09 (Verify tab in Admin · Configuration; same session as the visible-factory sprint)
**Phase 9-B webhook substrate closed**: 2026-05-10 (POST /api/factory-admin/verify/webhook live — receives FeedbackPayload, writes user_note observation, plans FixRoute, audits to JSONL log; Verify panel now shows recent feedback alongside recent bundles)
**Duration**: 9-A single session; 9-B Tier B ~10 min composition; 9-B webhook ~30 min

---

## Phase 9-B Tier B — what shipped (read-only)

Backend `GET /api/factory-admin/verify/state` returns enabled flag, client kind (mock vs http), `VERIFY_URL`, REVIEW_DECISIONS enum, and the last 20 published bundles via `createMockClient._inspectStore()`.

Frontend ✅ Verify sub-tab (in Admin · Configuration): 3-stat strip + REVIEW_DECISIONS pills + recent-bundles list + friendly note explaining what 9-B-full unlocks.

## Phase 9-B webhook substrate — what shipped (2026-05-10)

**`POST /api/factory-admin/verify/webhook`** (new endpoint in `factory-dashboard/server/telemetry.mjs`):
- Body: canonical `FeedbackPayload` shape plus an *optional* `project_id` field (Verify portal SHOULD include it for proper observation scoping; defaults to `"unknown"` when missing)
- Pipeline: `validateFeedbackPayload` → `handleFeedback({memory, projectId})` → append to `_factory_runtime/verify_feedback.jsonl`
- 400 on bad payload (validator error in `error`); 200 on success with `{ok, observation_id, route, router_result}`
- Every hit (success or failure) is logged to the JSONL audit log AND surfaced in Live Trace (`✅ Verify webhook: <build_id> (<decision>) by <reviewer> → lane=<lane> → <agent>`)
- Route is **planned but not executed** — full 9-B's "real fix-cycle agent invocation" is the missing piece; today the route lives in the response + the JSONL record where the founder (or full-9-B's auto-router) can act on it

**`GET /api/factory-admin/verify/state` extension**:
- New `recent_feedback: [...]` field — reverse-tail of the last 20 JSONL records
- New `webhook_url: "<base>/api/factory-admin/verify/webhook"` — gives Verify-stg admins a copy-pasteable target without grepping the source

**Frontend `VerifyPanel`** (Admin · Configuration → ✅ Verify):
- New "📥 Feedback webhook" card showing the POST URL + expected body shape
- New "Recent feedback received" list — color-coded decision pill (pass=green, partial=amber, fail=red), reviewer, timestamp, planned fix lane + agent, optional comment preview, error display if the webhook returned 400
- The two lists (bundles published → feedback received) sit side by side, giving the founder a "what we sent / what came back" panel for the Verify integration

**Smoke test** — `cognitive-engine/verify-integration/webhook-integration.smoke.js`:
- **27 assertions** across 6 scenarios — invalid payload → 400 + no log entry; valid pass → 200 + observation persisted + scoped + tagged + log line with correct shape; fail+doc-complaint → docs/data lane; partial+test-complaint → tests/tuvok lane; missing project_id → `"unknown"` fallback; recent-feedback tail-read produces most-recent-first shape with all required fields
- Reproduces the telemetry handler's logic in-process — no HTTP server spin-up needed, uses tmp memory + tmp log dir

## What stays for 9-B remainder

- **Real `createHttpClient()` activation** — needs `VERIFY_URL` env + `auth_token` from Key Console; client.js already has the hooks
- **Multi-app mode** in the Verify portal itself (Verify-stg-side work — not factory-side)
- **Auto-executed fix cycle** — today the route is planned + logged; full 9-B walks the route into the appropriate agent (Spock/Tuvok/Data/Picard) automatically and re-runs the affected pipeline node. Requires OpenRouter credit + the per-project working dir already provided by Phase 14-A.
- **Webhook authentication** — current endpoint is open; full 9-B adds an `X-Verify-Signature` HMAC check against a shared secret from Key Console. Acceptable for v0.0.1 single-VM single-founder; required before any real Verify-stg deploys

---

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 9-A.1 | `verify-integration/types.js` — BuildBundle / ReviewItem / FeedbackPayload / FixRoute shapes + validators | ✅ done |
| 9-A.2 | `verify-integration/bundle-builder.js` — reads artifact store, maps kinds to review items | ✅ done |
| 9-A.3 | `verify-integration/client.js` — pluggable mock + http clients | ✅ done |
| 9-A.4 | `verify-integration/feedback-receiver.js` — validates, writes observation, plans route | ✅ done |
| 9-A.5 | Smoke test — 30 assertions across 6 test groups | ✅ done — all pass |
| 9-A.6 | `verify-integration/README.md` — contract, flow diagram, flags, decisions | ✅ done |
| 9-B | Real HTTP client + webhook endpoint + fix-cycle routing | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/verify-integration/types.js` (new, ~60 lines)
- `BuildBundle`, `ReviewItem`, `FeedbackPayload`, `FixRoute` JSDoc shapes
- `isValidDecision()` — pass/partial/fail enum check
- `validateFeedbackPayload()` — single function returning null (ok) or error string
- `SCHEMA_VERSION = 1`

### `cognitive-engine/verify-integration/bundle-builder.js` (new, ~70 lines)
- `buildBundle(projectDir, {build_id, version, preview_url, agent_trace_url})` → BuildBundle
- Reads `_artifacts/index.jsonl` via Phase 6-A `listArtifacts()`
- Kind mapping: qa_report → automated item, code_output → manual item, pmd_doc → manual item, architect_review → release_notes
- Review item IDs monotonic `RI-NNNN` per bundle

### `cognitive-engine/verify-integration/client.js` (new, ~55 lines)
- `createMockClient()` — in-memory store, deterministic portal_url, inspectable
- `createHttpClient({baseUrl, auth_token, headers})` — POSTs to `${VERIFY_URL}/api/projects/{id}/builds`, fail-open on error
- `getVerifyClient({kind})` — reads `VERIFY_CLIENT` env (default mock)
- `isEnabled()` — reads `USE_VERIFY_INTEGRATION`

### `cognitive-engine/verify-integration/feedback-receiver.js` (new, ~90 lines)
- `handleFeedback(payload, {memory, projectId, fixRouter})` — returns `{ok, observation_id, route, router_result}`
- `planFixRoute(payload)` — 5-rule heuristic mapping comments to fix lanes (tests/docs/triage/code/none)
- Never throws — validation errors return `{ok: false, error}` for clean HTTP 400 handling
- Writes observations with `kind: "user_note"`, `scope: "project:<id>"`, `source: "verify_portal"`, tags `["verify", "decision:<d>", "req:<r>"]`

### `cognitive-engine/verify-integration/smoke-test.js` (new)
- 6 test groups, **30 assertions** all pass:
  - bundle-builder: 7 (review items categorized correctly, release_notes from architect_review, project_id inferred)
  - mock client: 4 (publish ok, portal_url format, round-trip retrievable)
  - feedback validation: 4 (null/empty/invalid rejected, valid accepted)
  - fix-route planning: 5 (pass→none, test complaint→tests, doc→docs, scope→triage, default→code)
  - full cycle: 13 (handle ok, observation persisted with right scope/kind/tags/provenance, router invoked with correct agent, pass skips router)
  - fail-open: 2 (missing deps return ok=false, not thrown)

### `cognitive-engine/verify-integration/README.md` (new)
- Contract (POST shapes both directions), flow diagram, heuristic table, flags, design decisions, rollback

### Unchanged
- Graph files, `memory.js`, `tools.js`, `telemetry.mjs`, Verify portal repo — all untouched
- Zero regression risk

## Smoke test highlight

```
[full feedback cycle]
  ✓ handle result ok
  ✓ observation created (OBS-0001)
  ✓ route lane=tests (got tests)
  ✓ stub router invoked once
  ✓ routed to tuvok
  ✓ observation persisted in memory
  ✓ kind=user_note
  ✓ tagged verify
  ✓ tagged decision:fail
  ✓ tagged requirement
  ✓ produced_by.source=verify_portal
  ✓ produced_by.agent=human:<reviewer>
  ✓ pass does NOT invoke router (still 1 call)
```

## Why 9-B deferred

9-B = real HTTP client wired against `verify-stg.agentryx.dev` + webhook endpoint in `factory-dashboard/server/telemetry.mjs` + real fix-cycle routing. Blockers:

- Verify **multi-app mode** not shipped. Currently scoped per-project (HireStream). Generification is Verify-side work.
- **Auth negotiation** — shared secret vs OAuth client_credentials decision outstanding.
- **Webhook endpoint** needs an HTTP path (`/api/verify/feedback`) in telemetry.mjs — same scope discipline as prior phases (no telemetry.mjs changes in scaffolding phase).
- **Real fix-cycle agent invocation** — touches graph files and needs LLM credit for validation. Blocks on same constraint as 5-B / 6-B / 7-E / 8-B.

Better to ship 9-A crisp (contract + cycle verified against mock) and open 9-B as a bundled "wire everything to real Verify" PR once those blockers clear.

## Feature-flag posture (P1 configurability-first)

| Flag | Default | Effect |
|---|---|---|
| `PRE_DEV_USE_GRAPH` | off | Phase 4 |
| `USE_MCP_TOOLS` | off | Phase 5 — awaits 5-B |
| `USE_ARTIFACT_STORE` | off | Phase 6 — awaits 6-B |
| `USE_MEMORY_LAYER` | off | Phase 7 — awaits 7-E |
| `USE_PARALLEL_DEV_GRAPH` | off | Phase 8 — awaits 8-B |
| `USE_COST_TRACKER` | off | Phase 11 — awaits 11-B |
| `USE_VERIFY_INTEGRATION` | off | Phase 9 — awaits 9-B |
| `VERIFY_CLIENT` | `mock` | swap to `http` once Verify multi-app ready |

## Phase 9-A exit criteria — met

- ✅ Contract (BuildBundle + FeedbackPayload shapes) formalized, smoke-tested
- ✅ Bundle builder reads real Phase 6-A artifacts end-to-end
- ✅ Mock client accepts publishes + returns retrievable bundles
- ✅ Feedback receiver writes correct observations (scope, kind, tags, provenance)
- ✅ Fix-route heuristic maps all 5 signal types + default correctly
- ✅ Fail-open validation — invalid payloads return ok=false, don't throw
- ✅ Zero changes to graph files, memory.js, tools.js, telemetry.mjs, Verify repo
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 9-B real wiring deferred (blocks on Verify multi-app + auth + LLM credit)

Phase 9-A is **wired, tested, and ready**. Contract is firm for 9-B.
