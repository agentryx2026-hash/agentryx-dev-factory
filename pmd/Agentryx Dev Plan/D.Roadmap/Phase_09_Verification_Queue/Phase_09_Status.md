# Phase 9 — Status: 9-A COMPLETE ✅  (9-B DEFERRED)

**Phase started**: 2026-04-22
**Phase 9-A closed**: 2026-04-22
**Duration**: single session

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
