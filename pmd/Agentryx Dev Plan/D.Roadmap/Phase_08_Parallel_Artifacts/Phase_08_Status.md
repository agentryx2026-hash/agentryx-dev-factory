# Phase 8 — Status: 8-A COMPLETE ✅  (8-B DEFERRED)

**Phase started**: 2026-04-22
**Phase 8-A closed**: 2026-04-22
**Duration**: single session

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 8-A.1 | Pattern docs (Plan + parallel/README.md) | ✅ done |
| 8-A.2 | `parallel/proof.js` — 6-node fan-out/join graph with stub branches | ✅ done |
| 8-A.3 | `parallel/reducers.js` — 7 parallel-safe state mergers | ✅ done |
| 8-A.4 | `parallel/smoke-test.js` — concurrency + state assertions | ✅ done — passed |
| 8-A.5 | `USE_PARALLEL_DEV_GRAPH` flag documented | ✅ done |
| 8-B | Wire `dev_graph.js` to use parallel topology under flag | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/parallel/reducers.js` (new, ~70 lines)
- `concatArray(a, b)` — array concat, null-tolerant
- `mergeObject(a, b)` — shallow merge, right wins on collision
- `deepMergeOneLevel(a, b)` — one-level deep merge
- `lastWriteWins(a, b)` / `firstWriteWins(a, b)` — explicit choice helpers
- `sumNumbers(a, b)` — numeric aggregation
- `dedupeBranchSet(a, b)` — set-based concat for branch tracking

### `cognitive-engine/parallel/proof.js` (new, ~110 lines)
- 6 stub nodes: spock (planner), torres (code), tuvok (tests), data (docs), join, obrien
- Real `StateGraph` from `@langchain/langgraph` (not mocked)
- Each branch sleeps `BRANCH_DELAY_MS` (default 1000ms) to simulate LLM latency
- `Annotation.Root` with parallel-safe reducers wired in
- Exports `buildProofGraph()` for smoke-test consumption

### `cognitive-engine/parallel/smoke-test.js` (new)
- 7 reducer assertions (all pass)
- Parallel execution test: invokes the graph, measures wall-clock
- 7 state-coherence assertions (branchesCompleted, artifacts, cost sum, log)
- **Result: 1061ms wall-clock vs 3000ms sequential** — concurrency proven, well within tolerance

### `cognitive-engine/parallel/README.md` (new)
- Topology diagram, reducer table, smoke-test results, 8-B integration sketch, design decisions, rollback

### Unchanged
- `dev_graph.js`, `factory_graph.js`, `pre_dev_graph.js`, `post_dev_graph.js`, `graph.js` — all sequential, all untouched
- Zero regression risk

## Smoke test output

```
[reducers]
  ✓ concatArray merges arrays
  ✓ concatArray handles null left
  ✓ mergeObject shallow merges
  ✓ mergeObject right wins on collision
  ✓ sumNumbers adds
  ✓ sumNumbers tolerates undefined
  ✓ dedupeBranchSet dedupes

[parallel] BRANCH_DELAY_MS=1000, tolerance=1000ms
[parallel] elapsed: 1061ms (vs 3000ms if sequential)
  ✓ wall-clock < 2000ms (proves concurrency)
  ✓ definitely faster than sequential (< 2000ms)
  ✓ all 3 branches reported completion
  ✓ branchesCompleted contains all three
  ✓ 3 distinct artifacts merged
  ✓ artifacts has code+tests+docs
  ✓ totalCostUsd summed correctly: $0.1000
  ✓ log has ≥7 entries (got 8)
  ✓ finalReport produced by obrien
```

## Why 8-B deferred

8-B = modify `dev_graph.js` to use the parallel topology. Requires:
- Updating `FactoryState` reducers (`codeOutput`, `testOutput`, `docsOutput`) to use parallel-safe mergers
- Adding a join node and rewiring spock's outgoing edges
- Adding `docsOutput` field (currently no Data agent docs slot)
- E2E LLM validation — confirm latency improves AND state stays coherent under real concurrency

Same constraint as 5-B / 6-B / 7-E: needs OpenRouter credit for end-to-end validation. Defer 8-B until credit available.

## Feature-flag posture (P1 configurability-first)

| Flag | Default | Effect |
|---|---|---|
| `PRE_DEV_USE_GRAPH` | off | Phase 4 — template subst vs real LLM graph |
| `USE_MCP_TOOLS` | off | Phase 5 — no runtime effect until 5-B |
| `USE_ARTIFACT_STORE` | off | Phase 6 — no runtime effect until 6-B |
| `USE_MEMORY_LAYER` | off | Phase 7 — no runtime effect until 7-E |
| `USE_PARALLEL_DEV_GRAPH` | off | Phase 8 — no runtime effect until 8-B |

## Phase 8-A exit criteria — met

- ✅ `parallel/` scaffolded (proof, reducers, smoke-test, README)
- ✅ Standalone proof shows 3 branches running concurrently with merged state
- ✅ Latency proof: 3 branches with 1-second sleeps complete in ~1.06s, NOT 3s
- ✅ Reducer helpers documented and tested (7 assertions pass)
- ✅ State assertions pass (artifacts merged, cost summed, branches tracked, log concatenated)
- ✅ `USE_PARALLEL_DEV_GRAPH` flag documented (no runtime effect yet)
- ✅ Zero changes to graph files → zero regression
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 8-B graph integration deferred (needs OpenRouter credit for E2E validation)

Phase 8-A is **wired, tested, and ready**. 8-B opens when credit allows real LLM concurrency validation.
