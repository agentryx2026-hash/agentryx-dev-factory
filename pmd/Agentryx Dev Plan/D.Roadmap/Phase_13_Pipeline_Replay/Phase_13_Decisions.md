# Phase 13 — Decisions Log

## D131 — Replay is a separate library; graph files unchanged

**What**: `cognitive-engine/replay/` is a parallel module. Graph files (`pre_dev_graph.js`, `dev_graph.js`, etc.) are not modified.

**Why**:
- **Same scaffolding discipline** as Phases 5-A through 12-A. Library substrate alongside production code; wiring deferred.
- **Replay is read-mostly**: collector + planner are pure-functional over recorded artifacts. Executor writes new artifacts but uses Phase 6-A's existing `writeArtifact()` — no graph code involved.
- **Unblocks Phase 15** (Self-Improvement Loop) without coupling to graph internals. Phase 15 will replay proposed graph changes against past runs to evaluate; that evaluation happens through this library, not by grafting into existing graphs.

## D132 — New run_id format = `<source>.replay.<N>`

**What**: A replay of `run-2026-04-23-abc` produces `run-2026-04-23-abc.replay.1`, `run-2026-04-23-abc.replay.2`, etc.

**Why**:
- **Lineage is in the run_id itself** — no separate join table needed to know "this is a replay of X."
- **Greppable**: `grep "replay" _artifacts/*/index.jsonl` enumerates all replay artifacts.
- **Sortable**: `replay.1`, `replay.2`, `replay.10` need natural-sort care, but `nextReplaySequence` parses ints and handles correctly.
- **Stable across runs**: deriving from source means two operators replaying the same source independently get distinct sequence numbers as long as `existingRunIds` is passed.

**Tradeoff**: replays of replays (`run-abc.replay.1.replay.1`) get awkward names. Acceptable; in practice you replay the original or its first replay, not nested chains.

## D133 — Stubs in 13-A; real LLM execution deferred to 13-B

**What**: `executor.js` invokes user-supplied `nodeStubs[agent]` functions. No default LLM stub.

**Why**:
- **No LLM cost in 13-A.** Smoke tests run free.
- **Stubs make the contract explicit.** `NodeStubInput`/`NodeStubOutput` types document what a node receives and produces. 13-B's default LLM stub is one implementation of this contract; users can register their own for testing.
- **Deterministic tests**: assertions can verify exact lineage and content.
- **Same pattern as Phase 9-A `fixRouter`** dependency injection — caller controls real-vs-stub via parameter, not flag.

**Consequence**: 13-A is unusable for real replays today (no recorded LLM agents to call). 13-B's default stub fixes that with a router-backed re-invocation.

## D134 — Frozen + substitution modes both supported in 13-A

**What**: `buildReplayPlan(snapshot, {replayFromArtifactId, substitutions})` — substitutions optional. Same engine handles both pure replay (frozen-only) and what-if (one or more substitutions).

**Why**:
- **Same dependency walk applies.** Substitution just changes which artifact a parent reference resolves to; the topology is identical.
- **Two modes from one code path** = less code to maintain, fewer surprises across mode boundaries.
- **What-if testing is the highest-value use case** — "what if Spock's spec were better?" answers a real question. Pure replay is mostly for debugging.
- **Substitution targets can come from any project / run** — executor falls back to `getArtifact()` when not in snapshot. (Caught a bug in initial implementation; fixed mid-test.)

## D135 — Replay artifacts written to the same `_artifacts/` store

**What**: Replays produce normal artifacts in the project's existing `_artifacts/` directory. They're tagged `["replay", "source:<run_id>"]` and have `meta.replays_artifact_id` back-pointers, but they're stored alongside originals.

**Why**:
- **Replays are first-class history**, not shadow data. Cost rollups (Phase 11-A), audit views, memory observations should all see them.
- **Tagging is sufficient discrimination.** `listArtifacts(projectDir, {kind: "code_output"})` returns originals + replays; consumers filter by tag if they need to.
- **Avoids two stores to maintain.** Phase 6-A artifact store is mature; building a parallel "replay store" doubles complexity.
- **Cross-replay analysis is easy.** Comparing original to replay is just: load original via `getArtifact(p, ART-0042)`, find descendants tagged `replay` with `meta.replays_artifact_id === ART-0042`.

**Tradeoff**: a workspace's artifact count grows with replays. Cost dashboards (Phase 11-A) should add a "show only original / show all" toggle in 11-B. Track in Phase 11-B's plan.
