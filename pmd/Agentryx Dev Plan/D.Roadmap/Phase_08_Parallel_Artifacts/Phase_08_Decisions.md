# Phase 8 — Decisions Log

## D107 — Parallel module lives at `cognitive-engine/parallel/`, not as `dev_graph_v2.js`

**What**: Phase 8-A scaffolds in `cognitive-engine/parallel/`. Existing graph files (`dev_graph.js`, etc.) untouched.

**Why**:
- **Same pattern as 5-A / 6-A / 7-A.** New subsystem alongside, feature-flagged. Proven template across 4 phases now.
- **`dev_graph_v2.js` would force a choice between two files.** Maintenance burden, divergence risk, harder to roll back from.
- **`parallel/` is reusable across graphs.** `pre_dev_graph.js`, `factory_graph.js`, future graphs may also adopt fan-out/join. A `dev_graph_v2.js` would need duplication.

**Consequence**: 8-B's job is "rewire `dev_graph.js` to use the proven parallel topology." The proof is the spec.

## D108 — Standalone proof uses real LangGraph, not a mock

**What**: `parallel/proof.js` imports `StateGraph` and `Annotation` from `@langchain/langgraph` — same as production graphs. Stub nodes are plain async functions with `setTimeout`, not mocked LangGraph internals.

**Why**:
- **Honest concurrency proof.** A mock would prove "my code runs three things in parallel," not "LangGraph runs three nodes in parallel." Only the latter matters.
- **8-B becomes a copy-paste exercise.** Topology, reducers, node signatures all transfer directly.
- **Latency measurement is real.** 1061ms vs 3000ms is wall-clock on the actual runtime. Predictive of real LLM behavior (modulo network variance).

**Cost**: proof depends on `@langchain/langgraph` being installed (it is, since cognitive-engine uses it). No new deps.

## D109 — State reducer convention

**What**: `parallel/reducers.js` ships 7 named reducers. Each has a one-line "when to use" rule:

| Reducer | Use case |
|---|---|
| `concatArray` | Lists that grow (logs, errors, branches-completed) |
| `mergeObject` | Keyed maps where each branch sets a different key |
| `deepMergeOneLevel` | Sparingly — when nested merging is genuinely needed |
| `sumNumbers` | Cost / latency aggregation |
| `dedupeBranchSet` | "which branches reported in?" tracking |
| `firstWriteWins` | Capture the first error, ignore subsequent |
| `lastWriteWins` | Single-writer fields (LangGraph default — exported for explicit choice) |

**Why**:
- **Default last-write-wins is silently wrong under parallelism.** Naming it `lastWriteWins` and re-exporting forces call sites to make an explicit choice rather than inheriting bad defaults.
- **Names beat lambdas.** `Annotation({ reducer: concatArray })` is self-documenting. `Annotation({ reducer: (a, b) => [...(a||[]), ...(b||[])] })` requires reading.
- **Composable later.** A reducer like `firstNonNull` or `maxNumber` joins this set without API churn.

## D110 — Failure-isolation policy deferred to 8-B

**What**: 8-A does NOT define what happens when one branch errors. The proof has zero error handling.

**Why**:
- **Designing failure policy without real LLM behavior data is guessing.** Questions only data answers: "How often does Tuvok fail when Torres has succeeded? How useful is a partial result (code+docs but no tests)? Should we retry the failed branch or proceed?"
- **8-B will gather that data.** First real run with `USE_PARALLEL_DEV_GRAPH=true` will surface real failure modes — then we design the policy that fits, not the policy we imagined.
- **8-A's job is mechanism, not policy.** Mechanism: "branches can run in parallel and merge state safely." Policy: "what to do when one fails." Separating them keeps each decision crisp.

**Consequence**: 8-B PR will explicitly include failure-policy as a deliverable, not an afterthought.
