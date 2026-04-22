# Phase 9 — Verification Queue (Verify Portal Integration)

**One-liner**: Stand up the Verify portal (`agentryx-verify`) as a generic multi-app instance. Factory pushes builds + auto-generated test cases; humans approve / reject / comment via the portal; feedback webhook flows back to the factory and triggers fix-cycle agents.

See [Modules/Verify_Portal_Integration.md](../Modules/Verify_Portal_Integration.md) for the boundary contract.

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 ("read existing code before scoping"):

- **Verify portal already exists** at `verify-stg.agentryx.dev` (currently in production for HireStream). Factory needs to integrate with it via HTTP — not build it from scratch.
- **Memory layer (Phase 7-A) has `user_note` kind ready.** Reviewer feedback → `addObservation({kind: "user_note", scope: "project:...", produced_by: {agent: "human:<reviewer>", source: "verify_portal"}})`.
- **Artifact store (Phase 6-A) has `qa_report` kind ready.** Tuvok's test cases already bundle here; Phase 9 just needs a builder that reads them plus related artifacts.
- **`Modules/Verify_Portal_Integration.md`** defines a provisional boundary contract. Phase 9-A formalizes it.

**Open questions that must be resolved before 9-B (real wire-up)**:
- Auth: shared secret vs OAuth client_credentials?
- Multi-app: Verify currently scoped per-project. Needs generification.
- Test-case schema: generic vs domain-specific?
- Verify repo URL (user to provide — the one previously given 404s).

## Design

Three pieces — same pattern as 5-A through 11-A:

1. **Build publisher** — collects artifacts from the current project's `_artifacts/` into a `BuildBundle`, POSTs to Verify via a pluggable client (default = mock, swap to HTTP when Verify ready).
2. **Feedback receiver** — handles `POST /api/verify/feedback`, validates shape, writes `user_note` observations to memory-layer, emits routing events for fix-cycle agents.
3. **Test-case builder** — reads `qa_report` artifacts (and any `test_cases` inside them), transforms into Verify-compatible review items.

```
cognitive-engine pipeline run completes
    │
    ├─ buildPublisher.collect(project_id) ──→ BuildBundle
    │       │
    │       └─ verifyClient.publishBuild(bundle) ──HTTP──→ Verify portal
    │
    ...time passes, humans review...
    │
    POST /api/verify/feedback (from Verify)
    │
    ├─ feedbackReceiver.handle(payload)
    │       │
    │       ├─ memory-layer.addObservation(user_note)     [Phase 7-A]
    │       │
    │       └─ routeToFixCycle(decision, requirement_id)  [stub in 9-A, 9-B real]
```

## Scope for this phase (9-A: contract + scaffolding)

Mirrors 5-A / 6-A / 7-A / 8-A / 11-A pattern — library alongside, feature-flagged, no graph changes, mocked external deps.

| Sub | What | Deliverable |
|---|---|---|
| 9-A.1 | `verify-integration/types.js` — `BuildBundle`, `ReviewItem`, `FeedbackPayload`, `FixRoute` | ✅ |
| 9-A.2 | `verify-integration/bundle-builder.js` — collects bundle from project's `_artifacts/` | ✅ |
| 9-A.3 | `verify-integration/client.js` — pluggable Verify client (mock + http) | ✅ |
| 9-A.4 | `verify-integration/feedback-receiver.js` — validates payload, writes user_note, stubs routing | ✅ |
| 9-A.5 | Smoke test — end-to-end cycle against mock client | ✅ |
| 9-A.6 | `verify-integration/README.md` + flag docs | ✅ |

**Out of scope for 9-A** (deferred to 9-B):

- Real HTTP client against `verify-stg.agentryx.dev` (needs multi-app mode shipped on Verify side)
- Auth negotiation (shared secret vs OAuth)
- HTTP endpoint in `factory-dashboard/server/telemetry.mjs` that receives the feedback webhook
- Actual fix-cycle agent routing (needs live LLM + Phase 8-B parallel branches)
- Verify portal UI changes (out of scope — separate app, separate team)

## Why this scope is right

- **Contract-first.** 9-A nails the `BuildBundle` + `FeedbackPayload` JSON shapes via smoke test before committing to HTTP wire format.
- **Mock client makes 9-A testable without Verify.** Hands-on today; swap mock for http when Verify is ready.
- **Reuses Phases 6-A, 7-A.** Bundle builder reads from artifact store; feedback receiver writes to memory layer. No new substrate.
- **Fail-open integration.** If Verify is unreachable, factory pipeline continues — publish becomes a logged no-op, same P2 ("artifact-first") principle as earlier phases.

## Phase close criteria

- ✅ `verify-integration/` scaffolded
- ✅ Bundle builder collects from `_artifacts/index.jsonl` end-to-end
- ✅ Mock client accepts bundle, returns synthetic feedback
- ✅ Feedback receiver writes `user_note` observation to memory-layer
- ✅ Fix-cycle routing is stubbed (logs the intended route + returns, no real agent invocation)
- ✅ Smoke test covers full cycle: build → publish → mock-feedback → observation write → stub route
- ✅ `USE_VERIFY_INTEGRATION` + `VERIFY_CLIENT` flags documented
- ✅ No changes to graph files, `telemetry.mjs`, or the Verify portal repo
- ✅ Phase docs: Plan (expanded), Status, Decisions (D115-Dxx), Lessons

## Decisions expected

- **D115**: Mock client as default; real HTTP client deferred to 9-B when Verify multi-app mode ready
- **D116**: `BuildBundle` uses artifact IDs (`ART-NNNN`), not inline content — keeps payload small, lets Verify fetch on demand
- **D117**: Feedback routing is a stub in 9-A; 9-B wires it to real fix-cycle agents
- **D118**: Observations use scope `project:<id>` + `source: "verify_portal"` — no new scope needed
- **D119**: Fail-open integration — Verify unreachable = logged no-op, pipeline continues
