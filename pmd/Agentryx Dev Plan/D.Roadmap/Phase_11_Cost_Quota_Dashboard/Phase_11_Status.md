# Phase 11 — Status: 11-A COMPLETE ✅  (11-B DEFERRED)

**Phase started**: 2026-04-22
**Phase 11-A closed**: 2026-04-22
**Duration**: single session

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 11-A.1 | `cost-tracker/types.js` — CostRollup / CostBucket / RollupFilter / Threshold shapes | ✅ done |
| 11-A.2 | `cost-tracker/artifact-source.js` — rollups from artifact walker | ✅ done |
| 11-A.3 | `cost-tracker/db-source.js` — SQL queries against `llm_calls` | ✅ done |
| 11-A.4 | `cost-tracker/service.js` — unified `getRollup()`, 3 sources | ✅ done |
| 11-A.5 | `configs/cost-thresholds.json` — threshold schema + 4 sample entries | ✅ done |
| 11-A.6 | Smoke test — 22 assertions across rollup / filters / error cases | ✅ done — all pass |
| 11-A.7 | `cost-tracker/README.md` + flag docs | ✅ done |
| 11-B | React dashboard UI + alert thresholds + HTTP endpoint | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/cost-tracker/types.js` (new, ~65 lines)
- JSDoc typedefs: `CostRollup`, `CostBucket`, `RollupFilter`, `Threshold`, `ThresholdConfig`
- `SCHEMA_VERSION = 1`
- Helpers: `emptyBucket()`, `addToBucket()`, `roundBucket()` — shared across sources

### `cognitive-engine/cost-tracker/artifact-source.js` (new, ~60 lines)
- `rollupFromArtifacts(workspaceRoot, filter)` — reads all `_artifacts/index.jsonl` via Phase 7-A walker
- Filters: `from`, `to`, `project_ids`, `agents`, `models`
- Aggregates: totals, by_project, by_agent, by_model, by_day
- `source: "artifacts"` tag on result

### `cognitive-engine/cost-tracker/db-source.js` (new, ~110 lines)
- `rollupFromDb(pool, filter)` — 5 parallel SQL queries (totals + 4 group-bys)
- Matches Phase 2C `llm_calls` schema exactly (15 columns)
- Filters `error IS NULL` to exclude failed calls from cost
- Returns same `CostRollup` shape as artifact source

### `cognitive-engine/cost-tracker/service.js` (new, ~50 lines)
- `getRollup(filter, opts)` — chooses source via `opts.source` or `COST_TRACKER_SOURCE` env
- Supports `artifacts`, `db`, `merged` — merged prefers DB values where present
- `isEnabled()` — reads `USE_COST_TRACKER`

### `configs/cost-thresholds.json` (new)
- Global daily ($5 warn / $20 cap) + monthly ($50 / $200)
- Per-agent daily caps for troi ($2 / $8) and picard ($1 / $4)
- Schema versioned for admin-UI migration (Phase 12)

### `cognitive-engine/cost-tracker/smoke-test.js` (new)
- Synthetic 2-project workspace, 5 artifacts across 3 agents × 3 models
- **22 assertions all pass**: totals, per-project, per-agent, per-model, filters, error cases
- Verified totals.cost_usd = $1.0000 (exact match), filter isolation works, error cases throw correctly

### `cognitive-engine/cost-tracker/README.md` (new)
- CostRollup shape, source comparison table, API examples, filter docs, threshold schema, design decisions, rollback

### Unchanged
- `llm-router/src/db.js` — untouched (cost-tracker is a consumer, not an extension)
- `memory-layer/artifact-walker.js` — reused as-is
- `factory-dashboard/server/telemetry.mjs` — no HTTP endpoint added in 11-A
- All graph files, `tools.js`, `memory.js` — untouched

## Smoke test highlight

```
[rollup source=artifacts]
  ✓ totals.cost_usd = $1.0000 (expected $1.0000)
  ✓ totals.calls = 5 (expected 5)
  ✓ 2 projects rolled up
  ✓ troi total = $0.2300  (0.15 + 0.08 across 2 projects)
  ✓ picard total = $0.7500 (0.50 + 0.25 across 2 projects)

[filters]
  ✓ project filter: blog has 2 calls
  ✓ agent filter: picard has 2 calls
  ✓ model filter: haiku has 1 call
  ✓ nonexistent agent returns zero

[error cases]
  ✓ artifact source requires workspaceRoot
  ✓ db source requires pool
  ✓ unknown source rejected
```

## Why 11-B deferred

11-B = React dashboard UI + HTTP endpoint in `telemetry.mjs` + alert thresholds wired into Courier. Requires:
- Courier itself (Phase 10) — not shipped yet
- Dashboard refactor to add a new route + a cost rollup page
- Real `llm_calls` data to validate DB queries beyond the skeleton
- Threshold evaluation logic (compare rollup to `cost-thresholds.json`, emit events)

Better to let Phase 10 ship first (Courier gives us the alert pipe), then Phase 11-B binds UI + alerts in one coherent subphase.

## Feature-flag posture (P1 configurability-first)

| Flag | Default | Effect |
|---|---|---|
| `PRE_DEV_USE_GRAPH` | off | Phase 4 |
| `USE_MCP_TOOLS` | off | Phase 5 — awaits 5-B |
| `USE_ARTIFACT_STORE` | off | Phase 6 — awaits 6-B |
| `USE_MEMORY_LAYER` | off | Phase 7 — awaits 7-E |
| `USE_PARALLEL_DEV_GRAPH` | off | Phase 8 — awaits 8-B |
| `USE_COST_TRACKER` | off | Phase 11 — awaits 11-B |
| `COST_TRACKER_SOURCE` | `artifacts` | swap to `db`/`merged` when DB validated |

## Phase 11-A exit criteria — met

- ✅ `cost-tracker/` scaffolded (types, two sources, service, smoke-test, README)
- ✅ Artifact rollup works end-to-end on synthetic workspace
- ✅ DB rollup uses real Phase 2C schema (compiles; live DB validation deferred to 11-B)
- ✅ Filters and error cases tested
- ✅ Threshold config shape documented + sample file shipped
- ✅ Zero changes to `llm-router/`, `memory-layer/`, graph files, telemetry.mjs
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 11-B UI/endpoint/alerts deferred until Phase 10 (Courier) ships

Phase 11-A is **wired, tested, and ready**. The contract is firm. 11-B binds UI + alerts when Courier's notification pipe exists.
