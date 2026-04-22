# Cost Tracker

Unified cost rollup library for Phase 11. Reads from artifact stores (Phase 6-A) and/or the `llm_calls` Postgres table (Phase 2) and returns a single typed shape.

## Status: Phase 11-A scaffolding

Rollup library + threshold config shape shipped. **No HTTP endpoint yet** and **no React UI** — those are Phase 11-B.

## Files

- `types.js` — `CostRollup`, `CostBucket`, `RollupFilter`, `Threshold` shapes + bucket helpers
- `artifact-source.js` — `rollupFromArtifacts(workspaceRoot, filter)` — filesystem-only, works today
- `db-source.js` — `rollupFromDb(pool, filter)` — SQL against `llm_calls`, matches Phase 2 schema
- `service.js` — `getRollup(filter, opts)` — unified entry point, chooses source by env
- `smoke-test.js` — 22 assertions across artifact rollup, filters, error cases
- `../configs/cost-thresholds.json` — threshold config (consumed by 11-B)

## `CostRollup` shape

```json
{
  "period": { "from": "2026-04-01T00:00:00Z", "to": "2026-04-22T23:59:59Z" },
  "totals": {
    "cost_usd": 4.18,
    "calls": 142,
    "tokens_in": 83100,
    "tokens_out": 41250
  },
  "by_project": {
    "2026-04-21_todo-app": { "cost_usd": 1.25, "calls": 31, "tokens_in": 22300, "tokens_out": 10900 }
  },
  "by_agent":  { "troi": {...}, "picard": {...} },
  "by_model":  { "openrouter:anthropic/claude-opus-4.7": {...} },
  "by_day":    { "2026-04-21": {...}, "2026-04-22": {...} },
  "source": "artifacts" | "db" | "merged"
}
```

All cost fields are rounded to 6 decimals. Token fields come from DB (artifact store doesn't currently capture tokens; artifact-source returns tokens_in/out = 0).

## Two sources, same shape

| Source | Data origin | Works today? | Captures tokens? | Captures errors? |
|---|---|---|---|---|
| `artifacts` | `_artifacts/index.jsonl` across projects | ✅ no DB required | ❌ (no token field in artifacts) | ❌ |
| `db` | `llm_calls` Postgres table | Needs live DB | ✅ | ✅ (filtered out of rollup) |
| `merged` | Both | Needs workspaceRoot + pool | DB values preferred | DB values preferred |

## API

```js
import { getRollup } from "./cost-tracker/service.js";

// Artifact-based (default, no DB needed):
const r = await getRollup(
  { from: "2026-04-01", to: "2026-04-22" },
  { workspaceRoot: "/home/user/Projects/agent-workspace", source: "artifacts" }
);

// DB-based:
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.LLM_ROUTER_DB_URL });
const rDb = await getRollup(
  { project_ids: ["2026-04-22_todo-app"] },
  { pool, source: "db" }
);

// Merged (DB wins where present):
const rMerged = await getRollup(
  { from: "2026-04-01" },
  { workspaceRoot: "...", pool, source: "merged" }
);
```

## Filters

`RollupFilter` fields (all optional):

- `from`, `to` — ISO 8601 date strings (inclusive)
- `project_ids[]` — string match on project dir names
- `agents[]` — string match on `produced_by.agent` (artifacts) or `agent` column (db)
- `models[]` — string match on `produced_by.model` (artifacts) or `model_succeeded` column (db)

## Threshold config (`configs/cost-thresholds.json`)

```json
{
  "schema_version": 1,
  "thresholds": [
    { "key": "global",      "window": "daily",   "warn_usd":  5.00, "hard_cap_usd": 20.00 },
    { "key": "agent:troi",  "window": "daily",   "warn_usd":  2.00, "hard_cap_usd":  8.00 },
    { "key": "agent:picard","window": "daily",   "warn_usd":  1.00, "hard_cap_usd":  4.00 }
  ]
}
```

Key formats match the `scope` convention from `memory-layer/types.js`: `global`, `agent:<id>`, `project:<id>`.

**Phase 11-A**: config shape defined, file shipped with reasonable defaults. No enforcement yet.
**Phase 11-B**: `warn_usd` triggers Courier notification; `hard_cap_usd` plugs into `llm-router` alongside Phase 2E's project/daily caps.

## Environment

```
USE_COST_TRACKER=true           # 11-B onwards: dashboard UI wired; 11-A: no runtime effect
COST_TRACKER_SOURCE=artifacts   # "artifacts" (default) | "db" | "merged"
LLM_ROUTER_DB_URL=postgres://...  # reused from llm-router if source=db|merged
```

## Smoke test

```
$ node cost-tracker/smoke-test.js
[setup] workspace: /tmp/cost-ws-XXXXXX
[rollup source=artifacts]
  ✓ totals.cost_usd = $1.0000 (expected $1.0000)
  ✓ totals.calls = 5 (expected 5)
  ✓ 2 projects rolled up
  ✓ 3 agents (troi, tuvok, picard)
  ✓ troi total = $0.2300
  ✓ picard total = $0.7500
[filters]
  ✓ project filter: blog has 2 calls
  ✓ agent filter: picard has 2 calls
  ✓ nonexistent agent returns zero
[error cases]
  ✓ artifact source requires workspaceRoot
  ✓ db source requires pool
  ✓ unknown source rejected
[smoke] OK
```

## Design decisions

- **`cost-tracker/` lives in `cognitive-engine/`**, not `llm-router/`. Reason: it crosses module boundaries (consumer of both router DB and artifact FS). Keeping it in cognitive-engine gives it a home without implying ownership by either.
- **Same shape across sources.** Artifact and DB rollups return identical `CostRollup` structure so the eventual UI (11-B) binds once.
- **DB queries filter out `error IS NOT NULL` rows.** Failed calls count in telemetry (via budget_refusals_today metric elsewhere) but shouldn't inflate cost rollups — they have `cost_usd = 0` but one call each.
- **Rounding at boundary.** Internal math stays in fp; `roundBucket` runs once per output bucket. Prevents accumulation of 0.1999999 artifacts in API responses.
- **No HTTP endpoint in 11-A.** Contract first, wiring in 11-B — avoids shipping an endpoint shape we'll likely revise once the React UI actually consumes it.

## Rollback

`USE_COST_TRACKER=false` (default). Phase 11-A is pure library code with no runtime hooks. Uninstalling = deleting the directory.
