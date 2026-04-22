# Phase 11 — Decisions Log

## D111 — `cost-tracker/` lives in `cognitive-engine/`, not `llm-router/`

**What**: The rollup library is placed at `cognitive-engine/cost-tracker/`. `llm-router/` owns write-side cost capture (`db.js`); `cost-tracker/` owns read-side rollups.

**Why**:
- **Cross-module consumer.** `cost-tracker` reads from both `llm-router`'s `llm_calls` DB and `cognitive-engine/memory-layer/artifact-walker.js`. Placing it inside either would imply unidirectional ownership that doesn't match reality.
- **Matches Phase 5-A / 6-A / 7-A / 8-A pattern.** Each scaffolding phase created a sibling directory under `cognitive-engine/`: `mcp/`, `artifacts/`, `memory-layer/`, `parallel/`, now `cost-tracker/`. Developer intuition stays consistent.
- **`llm-router/` stays focused.** Its remit is "route LLM calls efficiently with cost capture." Adding rollup analytics would blur that.

## D112 — Artifact source and DB source return identical `CostRollup` shape

**What**: `rollupFromArtifacts()` and `rollupFromDb()` both return `{period, totals, by_project, by_agent, by_model, by_day, source}`. Consumers bind once.

**Why**:
- **UI doesn't branch on source.** React chart components shouldn't care whether data came from disk or Postgres. Same props, same renderer.
- **`merged` source becomes trivial.** With parity, combining is just object spread + numeric preference rules.
- **Swap is reversible.** If DB goes offline, the dashboard can fall back to artifact source with no schema change — just flip `COST_TRACKER_SOURCE=artifacts`.

**Tradeoff**: artifact source can't populate `tokens_in` / `tokens_out` (artifacts don't store tokens today). Returns 0s. 11-B UI should handle "0 tokens + non-zero cost" as "token data unavailable," not "a zero-token call."

## D113 — Thresholds configured in a JSON file, not hardcoded

**What**: `configs/cost-thresholds.json` defines warn/hard-cap values per key × window. Schema: `{schema_version, thresholds: [{key, window, warn_usd, hard_cap_usd}]}`.

**Why**:
- **Admin UI substrate (Phase 12).** When Phase 12 ships the B7 admin module, editing thresholds = CRUD on this file (or its Postgres-backed successor). No code changes to adjust caps.
- **Versioned.** `schema_version: 1` lets 11-B add fields without breaking older configs.
- **Key convention reused.** `"global"`, `"agent:<id>"`, `"project:<id>"` matches `memory-layer/types.js` scope format — one mental model across subsystems.
- **No cap during R&D is a problem we've already hit.** Earlier session had an OpenRouter 402 from unbounded requests. Having a file to edit is safer than "fix it in code and redeploy."

## D114 — No HTTP endpoint in 11-A — contract first

**What**: 11-A ships library code only. The HTTP endpoint that serves rollups to the React UI lands in 11-B.

**Why**:
- **Contract stabilization.** The `CostRollup` JSON shape is defined in 11-A and smoke-tested. Shipping an endpoint in 11-A that serializes this shape means freezing the wire format prematurely; 11-B UI construction will inevitably reveal fields we wanted to reshape.
- **Scope discipline.** Adding a route to `telemetry.mjs` touches production code. 11-A stays pure-library (zero production-code risk), 11-B batches all "wire it up" changes.
- **Pattern consistency.** 5-A / 6-A / 7-A / 8-A all kept wiring out of the scaffolding subphase. This is rule, not exception.

**Consequence**: `COST_TRACKER_SOURCE` and `USE_COST_TRACKER` env vars are documented but have zero runtime effect until 11-B.
