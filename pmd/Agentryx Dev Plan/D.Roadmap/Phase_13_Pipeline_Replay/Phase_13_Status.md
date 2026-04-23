# Phase 13 — Status: 13-A COMPLETE ✅  (13-B DEFERRED)

**Phase started**: 2026-04-23
**Phase 13-A closed**: 2026-04-23
**Duration**: single session

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 13-A.1 | `replay/types.js` — RunSnapshot, ReplayPlan, NodeStub, ReplayResult shapes + id helpers | ✅ done |
| 13-A.2 | `replay/run-collector.js` — gather artifacts for a run_id from workspace | ✅ done |
| 13-A.3 | `replay/planner.js` — build dependency graph, identify replay subset, derive new run_id | ✅ done |
| 13-A.4 | `replay/executor.js` — execute plan with stubbed nodes, write new artifacts with proper lineage | ✅ done |
| 13-A.5 | Smoke test — 36 assertions across collector, planner (2 modes), executor (3 cases) | ✅ done — all pass |
| 13-A.6 | `replay/README.md` + flag docs | ✅ done |
| 13-B | Default LLM stub + HTTP endpoint + React UI + cross-pipeline replay | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/replay/types.js` (new, ~75 lines)
- `RunArtifact`, `RunSnapshot`, `ReplayPlan`, `NodeStubInput`, `NodeStubOutput`, `ReplayResult` JSDoc shapes
- `deriveReplayRunId(sourceRunId, seq)` — builds `<source>.replay.<N>` format
- `nextReplaySequence(existingRunIds, sourceRunId)` — finds next unused number
- `SCHEMA_VERSION = 1`

### `cognitive-engine/replay/run-collector.js` (new, ~55 lines)
- `collectRun(workspaceRoot, runId)` — uses Phase 7-A `walkArtifacts()`, filters by `produced_by.run_id`
- Returns ordered `RunSnapshot` (sorted by `produced_at`)
- Validates single-project assumption (throws if a run spans multiple projects)
- `listRunIds(workspaceRoot)` — distinct run_ids visible across all projects

### `cognitive-engine/replay/planner.js` (new, ~60 lines)
- `buildReplayPlan(snapshot, params)` — walks `parent_ids` edges, computes:
  - `replay_artifact_ids`: pivot + all descendants (in temporal order)
  - `frozen_artifact_ids`: parents of replay set that are NOT themselves in replay set
  - `new_run_id`: derived via `deriveReplayRunId` + `nextReplaySequence`
- Supports `substitutions` map (artifact_id → replacement_id)

### `cognitive-engine/replay/executor.js` (new, ~95 lines)
- `executeReplay(plan, ctx)` — runs through `replay_artifact_ids` in temporal order
- For each: resolves parents (frozen / substituted / freshly-replayed), invokes registered stub, writes new artifact via Phase 6-A `writeArtifact()`
- Stubs receive original artifact + resolved parents + new_run_id + project_id
- New artifacts tagged `["replay", "source:<source_run_id>"]` and meta `replays_artifact_id` back-pointer
- Substituted parents from outside snapshot are resolved via `getArtifact()` from disk
- Errors return `{ok: false, error}` — never throws

### `cognitive-engine/replay/smoke-test.js` (new, ~165 lines)
- Builds synthetic 4-artifact recorded run (spock → troi/tuvok → obrien) + 1 noise artifact in different run
- Tests 7 scenarios:
  - run-collector: matched filter, agent ordering, missing run, distinct run_ids
  - id helpers: format + sequence calculation
  - planner from mid-graph: 2 replay + 2 frozen, including sibling-as-frozen-parent case
  - planner from root: all replay, nothing frozen, sequence picks next available
  - executor frozen-input replay: 13 assertions including parent-rewrite (new troi → frozen spock; new obrien → frozen tuvok + new troi)
  - executor substitution mode: external artifact resolved correctly via getArtifact
  - executor missing stub: graceful failure with descriptive error

### `cognitive-engine/replay/README.md` (new)
- Replay model diagram, substitution mode example, API, stub contract, design decisions, 13-B preview

### Unchanged
- Graph files, artifact store, memory layer, courier, verify integration, cost tracker, admin substrate, telemetry.mjs — all untouched
- Zero regression risk

## Smoke test highlight

```
[executor — frozen-input replay from troi]
  ✓ executor ok
  ✓ 2 new artifacts written
  ✓ troi has 1 parent (spock, frozen)
  ✓ obrien has 2 parents (troi-new + tuvok-frozen)
  ✓ new troi parent = original spock (frozen)
  ✓ new obrien parent includes original tuvok (frozen)
  ✓ new obrien parent includes NEW troi (replayed)
  ✓ new artifact tagged replay
  ✓ meta tracks original

[executor — substitution mode]
  ✓ troi saw substituted spock id (ART-0008)
```

## Bug caught + fixed during smoke test

First implementation of `executor.js` only resolved parents from `ctx.snapshot`. When substitution pointed at an artifact from a DIFFERENT run (not in snapshot), the parent resolved to a placeholder `{agent: "?"}` and the stub couldn't find it by agent name. Fixed by adding fallback `getArtifact(projectDir, resolvedId)` lookup. Lesson noted.

## Why 13-B deferred

13-B = default LLM stub + HTTP endpoint + React UI + cross-pipeline replay. Requires:
- **OpenRouter credit** for default stub to re-invoke real agents
- **Server changes** in `factory-dashboard/server/telemetry.mjs` to expose replay endpoints
- **React UI work** for timeline + side-by-side diff views
- **Cross-pipeline coordination** — pre_dev → dev → post_dev replay across 3 separate graph runners

Ship 13-A as the firm engine; 13-B layers UI + LLM atop a tested substrate.

## Feature-flag posture

| Flag | Default | Effect |
|---|---|---|
| (existing 8 flags ...) | off | Phases 4-12 |
| `USE_REPLAY` | off | Phase 13 — no runtime effect in 13-A; 13-B exposes HTTP endpoint |

## Phase 13-A exit criteria — met

- ✅ `replay/types.js` — full type system + id helpers
- ✅ `replay/run-collector.js` — workspace walker + run filter
- ✅ `replay/planner.js` — descendant identification + frozen-set computation + new run_id
- ✅ `replay/executor.js` — stub invocation + lineage rewrite + substitution support
- ✅ Smoke test — **36 assertions all pass**
- ✅ Substitution mode works against artifacts outside the original snapshot
- ✅ Missing-stub case fails gracefully (returns `{ok: false}`, no throw)
- ✅ Zero changes to graph files, artifact store, memory layer, or any other module
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 13-B (LLM stub + UI + HTTP) deferred

Phase 13-A is **wired, tested, and ready**. Engine substrate firm; 13-B builds the operator-facing layer.
