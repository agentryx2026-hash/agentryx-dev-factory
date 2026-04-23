# Phase 13 — Lessons Learned

Phase 13-A closed: 2026-04-23. Duration: single session.

## What surprised us

1. **Phase 6-A's `parent_ids` field made the dependency walk trivial.** Two BFS loops in `planner.js` (one for descendants, one for frozen-set parents) and replay topology fell out automatically. Without typed lineage on artifacts, replay would have required parsing graph code. Phase 6-A's small-but-firm contract paid off.

2. **The bug caught during smoke testing was the most informative moment.** First executor only resolved parents from `ctx.snapshot`. Substitution targets from a *different* run came back as placeholder `{agent: "?"}` which broke `find(p => p.agent === "spock")` in the test. The fix (fall back to `getArtifact` from disk) is the right semantics — substituted artifacts deserve real metadata. Caught by the test's specificity. **General lesson**: smoke tests that assert *content* of resolved data, not just shape, catch resolution bugs that schema-only tests miss.

3. **Stubs as dependency injection is the same pattern Phase 9-A used (`fixRouter`).** Two phases, two contracts, one technique: caller passes the real-vs-stub function. No env flag, no global registry. This is a pattern worth codifying — likely Phase 15 self-improvement will use it again for evaluating proposed graphs.

4. **Cross-pipeline replay is structurally similar to single-pipeline replay** but I deferred it to 13-B. Reason: pre_dev → dev → post_dev are three separate graph runners today, each with their own `run_id` namespace. A pipeline-spanning replay would need a "meta-run-id" concept. Worth designing once we know whether Phase 14 (multi-project concurrency) keeps the three-graph split or unifies.

## What to do differently

1. **Add `kind:"replay_summary"` artifact to the catalog.** Each replay could write a summary artifact at the end describing what was replayed, what changed, total cost. Would let Phase 11-A cost rollups attribute spend to "replay activity" cleanly. Not in 13-A scope; recommend as 13-B addition.

2. **Substitution targets should be validated.** Today an invalid substitution (typo in artifact id) becomes a placeholder `{agent: "?"}` parent. The executor resolves it from disk OR fails silently. Validation in `buildReplayPlan` would catch this before execution starts.

3. **`new_run_id` collision protection is loose.** `nextReplaySequence` only checks the IDs we pass in. If two operators replay simultaneously without coordinating via a shared list, they could collide. Defer to 13-B (admin UI naturally serializes through one DB write).

## What feeds next phases

### Phase 13-B (deferred) — LLM stub + UI + HTTP + cross-pipeline
- Default LLM stub re-invokes the original agent with router-backed call
- HTTP `POST /api/replay/{run_id}` endpoint in telemetry.mjs
- React UI: timeline of recorded run, click any node to "replay from here"
- Side-by-side artifact diff (original vs replayed content)
- Cost guardrails: replays count against same budget caps as live runs (Phase 2E + Phase 11-A integration)
- Cross-pipeline (pre → dev → post) replay coordination
- Blocked on OpenRouter credit + UI work

### Phase 11-A — Cost Tracker (already shipped)
- Cost rollups will see replay artifacts. Add a "show only originals / show all" filter in 11-B UI per D135 tradeoff note.

### Phase 12-B — Admin UI
- "Replays" tab in admin panel: list recent replays, drill into diffs, retire/archive replay branches.

### Phase 15 — Self-Improvement Loop
- Direct dependency. Self-improvement proposes graph changes; evaluation = replay past runs through proposed graph, compare outcomes.
- 13's substitution model handles "what if this node behaved differently" out of the box.

### Phase 18 — Pipeline Module Marketplace
- Module install workflow could include "replay last N runs through this new module to compare." Same engine; different stub registration (the new module's agent).

### Phase 9 — Verify Portal
- Reviewer rejection → "replay this build with [proposed fix to spec]" — substitute the spec artifact, replay, post new build. Closes the human-feedback loop end-to-end.

## Stats

- **1 session**
- **$0.00 spent** (all stubs, no LLM calls)
- **0 new dependencies** (uses Phase 6-A artifact store + Phase 7-A walker + node built-ins)
- **5 files created**: `replay/{types,run-collector,planner,executor,smoke-test,README}.js|.md` (6 files)
- **0 files modified**: graph files, artifact store, memory layer, all other modules untouched
- **4 phase docs**: Plan (expanded from sketch), Status, Decisions, Lessons
- **5 Decisions**: D131-D135

## Phase 13-A exit criteria — met

- ✅ `replay/types.js` — full type system + run_id helpers
- ✅ `replay/run-collector.js` — workspace walker + run filter + listRunIds
- ✅ `replay/planner.js` — dependency-aware replay subset + frozen set + new run_id
- ✅ `replay/executor.js` — stub-driven execution + lineage rewrite + substitution from any source
- ✅ Smoke test — **36 assertions all pass** including substitution from outside-snapshot artifacts
- ✅ Bug caught + fixed during testing (cross-snapshot substitution resolution)
- ✅ Zero changes to graph files, artifact store, memory layer, or any other module
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons

Phase 13-A is **wired, tested, and ready**. Engine is firm — 13-B builds the operator-facing layer (LLM stub + UI + HTTP) on top.
