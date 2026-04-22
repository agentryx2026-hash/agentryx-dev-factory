# Parallel Artifacts (Phase 8-A scaffolding)

LangGraph fan-out/join pattern for running code, tests, and docs branches concurrently after triage. Standalone proof — not yet wired into `dev_graph.js` (that's Phase 8-B).

## Status: Phase 8-A scaffolding

Built and proven in isolation. Phase 8-B will copy the topology into `dev_graph.js` behind `USE_PARALLEL_DEV_GRAPH`.

## Files

- `proof.js` — toy 6-node graph (spock → torres/tuvok/data → join → obrien) with stubbed branches
- `reducers.js` — state-merge helpers safe under concurrent writes (`concatArray`, `mergeObject`, `sumNumbers`, `dedupeBranchSet`, `firstWriteWins`, `lastWriteWins`)
- `smoke-test.js` — verified end-to-end (3 branches in ~1s vs 3s sequential, all state assertions pass)

## Topology proven

```
__start__ → spock ──┬──→ torres (code)  ──┐
                    ├──→ tuvok  (tests) ──┼──→ join → obrien → __end__
                    └──→ data   (docs)  ──┘
```

LangGraph runs all three branches **concurrently** when one source has multiple outgoing edges. The `join` node fires once all three predecessors complete.

## Why state reducers matter

The default LangGraph reducer is `(a, b) => b ?? a` — last-write-wins. Under sequential execution this is fine. **Under parallel execution it silently drops data**: if torres writes `{artifacts: {code: ...}}` and tuvok writes `{artifacts: {tests: ...}}` at the same time, the second write clobbers the first.

`reducers.js` provides safe alternatives:

| Reducer | When to use |
|---|---|
| `concatArray` | Lists that grow (log lines, error collections) |
| `mergeObject` | Keyed maps where each branch sets a different key (`artifacts.code` vs `artifacts.tests`) |
| `sumNumbers` | Cost / latency aggregation |
| `dedupeBranchSet` | "which branches finished?" tracking |
| `firstWriteWins` | First failure to report wins |
| `lastWriteWins` | Single-writer fields (kept for explicit choice) |

## Smoke test results

```
$ node parallel/smoke-test.js
[reducers]
  ✓ concatArray merges arrays
  ✓ mergeObject right wins on collision
  ✓ sumNumbers adds
  ... 7 reducer tests pass

[parallel] elapsed: 1061ms (vs 3000ms if sequential)
  ✓ wall-clock < 2000ms (proves concurrency)
  ✓ all 3 branches reported completion
  ✓ 3 distinct artifacts merged
  ✓ totalCostUsd summed correctly: $0.1000
  ✓ finalReport produced by obrien
```

## Phase 8-B integration sketch

When credit allows, 8-B will modify `dev_graph.js`:

1. Update `FactoryState` annotations to use parallel-safe reducers for `codeOutput`, `testOutput`, `docsOutput`, `cost_usd_total`, etc.
2. Replace sequential edges (`torres → tuvok → data`) with fan-out from spock + join node.
3. Add a `joinNode` (analogous to `proof.js:joinNode`) that verifies all branches reported.
4. Behind `USE_PARALLEL_DEV_GRAPH` flag — sequential path stays as default.
5. E2E LLM run to confirm latency improvement and state coherence.

## Feature flag

```
USE_PARALLEL_DEV_GRAPH=true   # Phase 8-B onwards: dev_graph runs torres/tuvok/data concurrently.
                              # Phase 8-A: flag has no runtime effect yet (proof is standalone).
BRANCH_DELAY_MS=1000          # smoke-test only: simulated branch latency in ms.
```

## Design decisions

- **Standalone proof, not v2 of dev_graph** — keeps `dev_graph.js` byte-identical until 8-B's actual integration. Zero regression risk now.
- **Reducers as a separate module** — reusable across pre_dev_graph, factory_graph, future graphs. Not coupled to the proof.
- **Real LangGraph in the proof** — not a hand-rolled mock, so 8-B's wiring is mostly copy/paste rather than re-implementation.
- **Fail-isolation policy deferred** — needs real LLM behavior data ("when torres errors, do tuvok+data still produce useful artifacts?") to design well. 8-B's call.

## Rollback

`USE_PARALLEL_DEV_GRAPH=false` (default). 8-A has no runtime effect regardless. 8-B will preserve the sequential path under flag.
