# Phase 13 — Pipeline Replay / Debug

**One-liner**: Time-travel through any past LangGraph run. Pick a `run_id`, replay from any node with frozen inputs (recorded artifacts from Phase 6-A), or with modified inputs to test fixes. Visualize state at each step.

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 ("read existing code before scoping"):

- **Phase 6-A artifact store** captures `produced_by.run_id` on every artifact. This is the join key for replay.
- **Phase 6-A `parent_ids`** field links artifacts to their predecessors — the dependency DAG for any run is reconstructable.
- **Phase 6-A artifact provenance** also captures `agent`, `node`, `model`, `iteration` — enough to rerun any step with the same agent/model.
- **Phase 7-A `walkArtifacts(workspaceRoot)`** already walks all projects' artifact stores — the data source for cross-project replay.
- **No graph-level replay infrastructure exists** in `cognitive-engine/*_graph.js`. Replay is greenfield.
- **LangGraph supports `interrupt`/resumable state** but doesn't speak our run_id model directly. Replay is a layer above LangGraph, not an extension of it.

## Design

A replay is "given a recorded run, execute a subset of its nodes again, optionally with substituted inputs."

```
Recorded run (in artifact store):
  ART-0042  produced_by: {agent: "troi", run_id: "run-abc", iteration: 1}
  ART-0043  produced_by: {agent: "tuvok", run_id: "run-abc"}, parent_ids: ["ART-0042"]
  ART-0044  produced_by: {agent: "data", run_id: "run-abc"}, parent_ids: ["ART-0042"]
  ART-0045  produced_by: {agent: "obrien", run_id: "run-abc"}, parent_ids: ["ART-0043", "ART-0044"]

Replay plan:
  - run_id_source = "run-abc"
  - replay_from = "tuvok"            ← rerun this node and its descendants
  - frozen_inputs = ART-0042         ← upstream stays frozen
  - replacement_artifact?: optional substitution for any artifact

Replay execution:
  - Build dependency graph from artifacts
  - Identify the subset to re-execute (replay_from + everything downstream)
  - Build a new run_id (e.g. "run-abc.replay.1")
  - For each upstream artifact: feed as frozen input
  - For each replay node: execute (or stub) the agent
  - Write new artifacts with run_id = "run-abc.replay.1", parent_ids tying back
```

## Scope for this phase (13-A: replay engine substrate)

Mirrors 5-A through 12-A pattern.

| Sub | What | Deliverable |
|---|---|---|
| 13-A.1 | `replay/types.js` — RunSnapshot, ReplayPlan, ReplayResult, NodeStub shapes | ✅ |
| 13-A.2 | `replay/run-collector.js` — gather artifacts for a run_id from a workspace | ✅ |
| 13-A.3 | `replay/planner.js` — build dependency graph, identify replay subset | ✅ |
| 13-A.4 | `replay/executor.js` — execute plan with stubbed nodes (no LLM in 13-A) | ✅ |
| 13-A.5 | Smoke test: synthetic recorded run → 3-node replay → new artifacts written | ✅ |
| 13-A.6 | `replay/README.md` + flag docs | ✅ |

**Out of scope for 13-A** (deferred to 13-B):

- Real LLM execution during replay (vs stubs) — needs OpenRouter credit
- Wiring replay into graph files (replay-mode flag on graph nodes)
- HTTP endpoint for "replay this run from this node"
- React UI: timeline view, node-by-node state visualization, side-by-side diff
- Cross-pipeline replay (pre_dev → dev → post_dev as one continuous timeline)

## Why this scope is right

- **Phase 6-A made replay possible.** Without typed artifacts + run_id + parent_ids, replay is just rerunning the whole graph from scratch. With them, surgical re-execution is straightforward.
- **Stubs prove the engine without LLM cost.** 13-A's smoke test runs entirely against synthetic artifacts; no real LLM calls needed.
- **Library-first matches Phases 5-A through 12-A.** UI + LLM integration in 13-B.
- **Direct precondition for Phase 15 (Self-Improvement).** Self-improvement proposes graph changes; the way to evaluate proposed changes is to replay past runs against them. Phase 15 cannot exist without 13.

## Phase close criteria

- ✅ `replay/` scaffolded
- ✅ Run collector reads artifact store, returns all artifacts for a run_id
- ✅ Planner builds dependency graph, identifies replay subset, computes new run_id
- ✅ Executor processes plan with stub nodes, writes new artifacts with parent links
- ✅ Smoke test: end-to-end on synthetic 4-artifact recorded run
- ✅ `USE_REPLAY` flag documented (no runtime effect in 13-A)
- ✅ No changes to graph files, artifact store, telemetry.mjs, or any other module
- ✅ Phase docs: Plan (expanded), Status, Decisions (D131-Dxx), Lessons

## Decisions expected

- **D131**: Replay is a separate library — does NOT modify graph files
- **D132**: New run_id format = `<original>.replay.<N>` — preserves lineage
- **D133**: Stubs in 13-A; real LLM execution deferred to 13-B (OpenRouter credit)
- **D134**: Frozen input mode + Modified input mode are both supported in 13-A — different replays of same plan
- **D135**: Replay writes NEW artifacts to the same `_artifacts/` store (not a separate replay store) — replays are first-class history
