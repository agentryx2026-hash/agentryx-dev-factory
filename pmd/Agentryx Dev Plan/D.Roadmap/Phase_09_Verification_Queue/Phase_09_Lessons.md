# Phase 9 — Lessons Learned

Phase 9-A closed: 2026-04-22. Duration: single session.

## What surprised us

1. **Phases 6-A and 7-A made 9-A almost trivial.** Bundle builder reads artifacts (6-A). Feedback receiver writes user_note observations (7-A). The "hard" part — typed storage, scope convention, schema — was already done. Phase 9-A was 300 lines of glue that works because the glue has rich substrate on both sides.

2. **Dependency injection beats feature flags for testing.** I briefly considered a `MOCK_ROUTER=true` env var. Switched to passing `fixRouter` as a parameter instead. Result: test suite never touches env vars, every test owns its own stubs, mental model stays small. General lesson: prefer function arguments over global config for anything a test needs to control.

3. **The fix-route heuristic is probably wrong, and that's fine for 9-A.** 5 keyword regex rules aren't going to handle real human review text well. But 9-A proves the *shape* of routing works (feedback → lane → agent → invocation). 9-B can replace the regex classifier with an LLM classifier without touching the contract.

4. **Fail-open semantics split on level.** Network failure = fail-open (pipeline continues). Payload validation = fail-closed (return ok=false, HTTP 400). These feel similar but are different — conflating them would mean either crashing on a typo or silently accepting garbage. Naming the distinction (D119) helped.

## What to do differently

1. **Test-case schema is still open.** The Verify boundary contract lists this as an open question, but 9-A didn't resolve it — review items use a single free-form shape that works for all artifact kinds. This may break when real-world domains (e.g., government compliance vs e-commerce) want very different review forms. Track in Verify-side spec, not factory-side.

2. **Reviewer identity needs a canonical format.** `"subhash@agentryx.dev"` vs `"sthakur"` vs `"subhash-thakur-india"` all appear in this codebase already. 9-B should pick one (probably email) and document it in the boundary contract. Observations will aggregate badly otherwise.

3. **Consider adding a `FACTORY_BUILD_ID` stamp to `llm_calls`.** Today, rolling up "which LLM calls correspond to this Verify build?" requires joining via run_id + project_id. If the build_id were in `llm_calls` directly, Phase 11's cost rollup could answer "what did this build cost?" trivially. Small db.js change; probably Phase 9-B or 11-B's work.

## What feeds next phases

### Phase 9-B (deferred) — real wire-up
- Swap mock client → http client against Verify multi-app endpoint.
- Add `POST /api/verify/feedback` to `factory-dashboard/server/telemetry.mjs`.
- Replace stub `fixRouter` with real agent-invocation that spawns `dev_graph.js` in fix mode.
- Resolve auth (shared secret vs OAuth client_credentials).
- Blocked on Verify side (multi-app mode) + OpenRouter credit (real fix-cycle runs).

### Phase 10 — Courier
- Verify publish events → Courier → Slack "new build awaiting review" notifications.
- Verify feedback events → Courier → Slack "reviewer pushed back on build X" notifications.
- Same pattern: Courier's general notification pipe is consumed by Verify integration.

### Phase 11-B — Cost Dashboard
- Review decisions can tag cost rollups: "cost per approved build" vs "cost per rejected build."
- Threshold alerts (Phase 11-B) also ride Courier, same channel — per D119 / D117 consistency, failure == log-and-continue.

### Phase 13 — Pipeline Replay
- Verify feedback for a build can trigger replay of specific graph nodes (e.g., re-run Tuvok with new coverage directives).
- `planFixRoute()` is the seed — replay is a structured form of fix routing.

### Phase 14 — Multi-Project Concurrency
- Per-project Verify integration endpoint. Bundle publisher auto-infers project_id from `path.basename(projectDir)` — Phase 14 multi-project is ready for this.

### Phase 15 — Self-Improvement Loop
- Aggregate reviewer feedback patterns across projects → propose graph changes ("every project gets auth-coverage failures from Tuvok; add a pre-Tuvok auth-coverage check").
- Direct consumer of the `user_note` observations written by 9-A's feedback receiver.

## Stats

- **1 session**
- **$0.00 spent** (all stubs + mocks, no LLM calls)
- **0 new dependencies** (uses node built-ins + Phase 6-A artifact store + Phase 7-A memory)
- **5 files created**: `verify-integration/{types,bundle-builder,client,feedback-receiver,smoke-test,README}.js|.md` (6 files actually)
- **0 files modified**: graph files, memory.js, tools.js, telemetry.mjs, Verify repo all untouched
- **4 phase docs**: Plan (expanded from sketch), Status, Decisions, Lessons
- **5 Decisions**: D115-D119

## Phase 9-A exit criteria — met

- ✅ `verify-integration/` scaffolded with contract (types), builder, client, receiver
- ✅ Smoke test **30 assertions all pass**: bundle builder, mock client, validation, route planning, full cycle, fail-open
- ✅ Observations land in memory-layer correctly (kind, scope, tags, provenance all right)
- ✅ Fix-route heuristic correctly handles 5 comment patterns + pass case
- ✅ Fail-open for network; fail-closed for invalid payloads — distinction documented
- ✅ Zero changes to graph files, memory.js, tools.js, telemetry.mjs, Verify repo
- ⏳ 9-B real wiring deferred (Verify multi-app + auth + OpenRouter credit)

Phase 9-A is **wired, tested, and ready**. Contract is firm; 9-B swaps mock for http without renegotiation.
