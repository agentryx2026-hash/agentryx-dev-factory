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

## D222 — 8-B: tuvok ∥ data after torres; data drops qaReport when running parallel (added 2026-05-11)

**What**: Phase 8-B's parallel topology fan-outs from torres to tuvok AND data (both consume codeOutput, both write disjoint state fields — tuvok→qaReport, data→architectReview). Under `USE_PARALLEL_DEV_GRAPH=true`, data runs concurrently with tuvok and is no longer guaranteed to see qaReport when its prompt is constructed. Data's system message + user message dynamically drop the QA reference under that condition.

**Why fan out at torres (not spock)**:
- 8-A's `parallel/README.md` sketched spock → [torres, tuvok, data] in parallel. That doesn't work for real LLM behaviour: tuvok needs torres's code to test; data needs torres's code to review. Fanning out at spock would have tuvok writing tests against nothing.
- Fanning out at torres is the natural break: torres writes code → both reviewers consume it.

**Why drop qaReport from data's prompt under parallel mode (not wait for it)**:
- The whole point of parallel is to run them concurrently. If data waits for tuvok's qaReport, there's no parallelism — same as sequential.
- The architectural alternative (data reads qaReport, blocks on tuvok) defeats the speedup. The behavioural alternative (data reads code only; routing combines both verdicts) preserves the speedup.
- `routeAfterReview` was already the canonical combiner (reads both `architectReview` AND `qaReport`). The loop-or-deploy decision shape is unchanged — what changes is whether data's *intermediate review prose* references test results.
- Tradeoff: data's review is slightly weaker under parallel (no "test quality" criterion). Mitigation: 4 of 5 review criteria still apply; the router still consults Tuvok's QA verdict; full 8-B validation will measure whether the weaker review materially hurts loop quality.

**Why default OFF (zero behaviour change for existing users)**:
- The sequential path has weeks of clean runs. The parallel path is new and depends on LLM behaviour we haven't measured yet (does data's qa-free review produce equivalent verdicts?).
- Founder flips per-environment when ready to validate. Staging-on / production-off is a normal rollout pattern.
- Failure-isolation policy (D110) is still deferred — once real failures show up under parallel, we'll know what to design.

**Why the `branchesCompleted` reducer lives inline in dev_graph.js (not imported from parallel/reducers.js)**:
- The reducer is a one-liner (concat + Set dedupe). Importing from parallel/reducers.js would couple dev_graph.js to the 8-A scaffolding module purely for one function.
- Keeping it inline matches the rest of dev_graph.js's reducer style (all inline). Easier to read, easier to evolve independently.
- If 8-C ever needs richer reducers across multiple graphs, refactor at that point.

**Tradeoff acknowledged**: under the parallel path, if data finishes BEFORE tuvok, data's review prose references "(QA report not yet available)" verbatim. Founder reading the artifact may briefly wonder why. Worth a small UI affordance on the Replay page to note "this review was produced under parallel topology" — Phase 8-C concern.
