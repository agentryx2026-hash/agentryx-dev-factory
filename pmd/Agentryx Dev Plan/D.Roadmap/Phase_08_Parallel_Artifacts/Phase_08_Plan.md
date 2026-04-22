# Phase 8 — Parallel Artifacts

**One-liner**: Restructure the LangGraph so code, tests, and docs are concurrent branches under a fan-out / join, not sequential stages. Artifacts ship together at phase completion, not as afterthoughts.

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 ("read existing code before scoping"):

`cognitive-engine/dev_graph.js` (line 456-473) currently chains nodes strictly sequentially:

```
__start__ → jane → spock → torres → tuvok → data → crusher → obrien → __end__
```

Each node waits for the previous to fully complete and update state. Three problems:
1. **Wall-clock time** = sum of all node latencies. With LLM calls at 5-30s each, that's a 1-3 min critical path even when nodes don't depend on each other.
2. **Artifact coupling** — tests (Tuvok) and docs (currently implicit) wait until code (Torres) is done. They could run in parallel from the same triage spec.
3. **Failure isolation** — if Torres fails, Tuvok and Data never run, even if their inputs were ready.

LangGraph supports fan-out/join via:
- Multiple `addEdge(source, targetA)` + `addEdge(source, targetB)` from one source — automatic concurrency
- A join node that all parallel branches converge to
- `Annotation` reducers (already in use) merge parallel state writes safely

## Design

**Target topology** (Phase 8-B scope):

```
                    ┌──→ torres (code) ──┐
__start__ → ... → spock ──┼──→ tuvok  (tests) ─┼──→ join → crusher → obrien → __end__
                    └──→ data   (docs)  ─┘
```

The `join` node receives state from all three branches. Reducers on `codeOutput`, `testOutput`, and a new `docsOutput` field merge non-destructively.

## Scope for this phase (8-A: scaffolding + isolated proof-of-concept)

Mirrors 5-A / 6-A / 7-A pattern — parallel module, feature-flagged, no changes to existing graph files.

| Sub | What | Deliverable |
|---|---|---|
| 8-A.1 | Pattern docs + diagrams | this Plan + `parallel/README.md` |
| 8-A.2 | Standalone fan-out/join proof | `parallel/proof.js` — toy 3-branch graph with stub nodes |
| 8-A.3 | State reducer helpers — merge non-destructively | `parallel/reducers.js` |
| 8-A.4 | Smoke test — verify 3 branches run concurrently, state merges, latency < sequential | `parallel/smoke-test.js` |
| 8-A.5 | `USE_PARALLEL_DEV_GRAPH` flag documented (no runtime effect in 8-A) | `parallel/README.md` |

**Out of scope for 8-A** (deferred to 8-B):

- Modifying `dev_graph.js` to use the parallel topology
- Adding `docsOutput` state field (currently no Data agent docs output is in state schema)
- Threading provenance + run_id (overlaps with Phase 6-B)
- Failure-isolation policy ("if torres fails, do tuvok+data still publish their artifacts?")
- Performance benchmarks against real LLM latency

## Why this scope is right

- **Configurability-first (P1)**: feature flag means current sequential graph keeps working byte-for-byte.
- **Earn replacement rights**: the parallel pattern is unproven against our graphs. Build the proof in isolation, validate it, THEN rewire.
- **Mirrors successful pattern**: 5-A / 6-A / 7-A all shipped this way. No reason to break the formula.
- **8-B costs OpenRouter credit**: real validation needs an actual 3-branch LLM run. Deferring 8-B aligns with same constraint blocking 5-B / 6-B / 7-E.

## Phase close criteria

- ✅ `parallel/` directory scaffolded
- ✅ Standalone proof shows 3 branches running concurrently with merged state
- ✅ Latency proof: 3 branches with 1-second sleeps complete in ~1s, not 3s
- ✅ Reducer helpers documented and tested
- ✅ `USE_PARALLEL_DEV_GRAPH` flag documented (no runtime effect yet)
- ✅ No changes to `dev_graph.js`, `factory_graph.js`, `pre_dev_graph.js`, `post_dev_graph.js`, `graph.js`
- ✅ Phase docs: Plan (expanded), Status, Decisions (D107-Dxx), Lessons

## Decisions expected

- **D107**: parallel module lives at `cognitive-engine/parallel/`, not as a `dev_graph_v2.js`
- **D108**: standalone proof uses real LangGraph (not a mock) so 8-B's wiring is a near-trivial copy
- **D109**: state reducer convention — concat-arrays for lists, last-write-wins for scalars, deep-merge for objects
- **D110**: failure isolation policy deferred to 8-B (needs real LLM behavior to design well)
