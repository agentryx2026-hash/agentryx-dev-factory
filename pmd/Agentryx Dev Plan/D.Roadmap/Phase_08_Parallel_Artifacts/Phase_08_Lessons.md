# Phase 8 — Lessons Learned

Phase 8-A closed: 2026-04-22. Duration: single session.

## What surprised us

1. **LangGraph fan-out is implicit, not explicit.** I expected a `fanOut(['torres', 'tuvok', 'data'])` API or a `parallel: true` flag. Instead, you just call `addEdge(source, target)` multiple times from the same source — the runtime sees multiple outgoing edges and runs them concurrently. Less ceremony than I thought; well-designed.

2. **The default reducer is a parallelism trap.** `(a, b) => b ?? a` works perfectly for sequential graphs. Switch to parallel with no other change and **two branches silently overwrite each other**. The bug isn't a crash — it's missing data. This is exactly the kind of bug that ships if you don't think carefully. Reducers as a named, documented module + a smoke test catching the failure mode = the only safety net.

3. **Wall-clock proof was the most convincing artifact.** "1061ms vs 3000ms sequential" is six numeric chars that prove the entire phase. Without that, "concurrency works" is just a claim. Smoke tests should always include a measurable proof of the property they're meant to verify, not just functional assertions.

4. **The proof is essentially the production code.** D108's "use real LangGraph not a mock" decision means `proof.js` is structurally what `dev_graph.js` will look like in 8-B. The phase didn't build a throwaway — it built a template.

## What to do differently

1. **Add a parallelism lint check.** Once 8-B lands, any new state field added to `FactoryState` should explicitly choose a reducer (not inherit `lastWriteWins`). Could be a code-review checklist item or a test that fails when fields use the default reducer in a graph that has fan-out.

2. **Failure-isolation should have an explicit example in 8-B's PR.** Not just policy — a smoke test where torres throws and we verify tuvok+data still publish their artifacts (or document why they don't). Otherwise the policy stays theoretical.

3. **Consider a `parallel/budget.js` helper for 8-B.** With 3 branches running in parallel, total LLM cost is the SUM not the MAX of branch costs. A pre-flight budget check should account for this. Phase 11 (Cost/Quota) will need this anyway — could ship together.

## What feeds next phases

### Phase 8-B (deferred) — `dev_graph.js` integration
- Topology copy from `proof.js`
- `FactoryState` annotations updated with parallel-safe reducers
- Add `docsOutput` field to state schema
- Failure-isolation policy chosen + tested
- E2E LLM run to validate latency improvement and state coherence
- Blocked on OpenRouter credit (same as 5-B / 6-B / 7-E)

### Phase 11 — Cost + Quota Dashboard
- `sumNumbers` reducer matches what cost-tracking needs across parallel branches
- Pre-flight budget check should account for parallel multiplier (3 branches in flight = 3 concurrent LLM calls)
- The `parallel/budget.js` helper proposed above naturally lives in Phase 11's scope

### Phase 13 — Pipeline Replay
- Replay must handle parallel branches: re-execute the join after replacing one branch's output. The reducer model makes this clean — reducers don't care if input came from live LLM or replayed artifact.
- D109's named reducers will be cited as the contract replay relies on.

### Phase 14 — Multi-Project Concurrency
- Different problem (process-level parallelism vs node-level). But shares the principle: state writes from concurrent contexts need explicit merge semantics, not silent last-write-wins.
- Phase 14 will likely use OS-level isolation (separate processes per project) so reducers don't compose, but the lesson generalizes.

### Phase 15 — Self-Improvement Loop
- "Agents propose graph changes" — fan-out/join becomes one of the topologies they can propose. The proof here is the canonical example of "what a good graph change looks like."

## Stats

- **1 session**
- **$0.00 spent** (all stubs, no LLM calls)
- **0 new dependencies** (uses existing `@langchain/langgraph`)
- **4 files created**: `parallel/{proof, reducers, smoke-test}.js` (~250 lines total) + `parallel/README.md`
- **0 files modified**: all 5 graph files untouched
- **4 phase docs**: Plan (expanded from sketch), Status, Decisions, Lessons
- **4 Decisions**: D107-D110

## Phase 8-A exit criteria — met

- ✅ `parallel/proof.js` — 6-node fan-out/join graph with stub branches
- ✅ `parallel/reducers.js` — 7 parallel-safe state mergers, named + documented
- ✅ `parallel/smoke-test.js` — **verified end-to-end** (1061ms wall-clock vs 3000ms sequential, 14 assertions all pass)
- ✅ `parallel/README.md` — topology, reducers table, results, integration sketch
- ✅ `USE_PARALLEL_DEV_GRAPH` flag documented (no runtime effect yet)
- ✅ Zero changes to graph files → zero regression
- ⏳ 8-B graph integration deferred (needs OpenRouter credit for E2E validation)

Phase 8-A is **wired, tested, and ready**. The proof is the spec for 8-B.
