# Phase 11 — Lessons Learned

Phase 11-A closed: 2026-04-22. Duration: single session.

## What surprised us

1. **Most of Phase 11 was already built across Phases 2 and 6.** `llm-router/src/db.js` writes every call to `llm_calls` with full per-call granularity. Phase 6-A artifacts carry `cost_usd` alongside content. Phase 7-A walker already summarizes across projects. What remained was a couple hundred lines of aggregation logic. Third phase running where pre-phase code survey dramatically shrank the actual scope.

2. **Parallel SQL queries (one per group-by) beat one monster GROUP BY GROUPING SETS query.** Cleaner code, same round-trip time (all 5 queries fire via `Promise.all`), easier to extend (adding a `by_task_type` rollup is one more query, not a rewrite).

3. **Two sources returning the same shape is a tiny piece of code (~10 lines in `service.js`) that pays enormous downstream dividends.** 11-B UI, future admin endpoints, CLI tools — all bind once and get three backends for free.

4. **22 smoke-test assertions is the right density.** Not 5 (too shallow — wouldn't catch filter bugs), not 50 (test bureaucracy). Covered: totals math, per-dimension grouping, each filter in isolation, invalid-input error paths. Took 10 extra minutes to write; would've saved hours if a bug slipped through.

## What to do differently

1. **Artifact store should capture tokens.** Phase 6-A's artifact record has `cost_usd` and `latency_ms` but not `tokens_in` / `tokens_out`. DB rollups have them; artifact rollups don't. Two options: (a) add token fields to artifact records (schema bump), (b) when 6-B wires graphs to the store, write tokens from LLM router's response alongside cost. Prefer (b) — less migration noise.

2. **Threshold enforcement isn't just a cost-tracker concern — it's a router concern.** 11-B should consider hoisting hard-cap logic into `llm-router/src/router.js` right next to Phase 2E's existing project/daily caps. The cost-tracker evaluates thresholds; the router enforces them pre-call. Clean separation.

3. **Scope-key naming is good, but will need a linter.** `"agent:troi"` in thresholds, memory-layer scopes, and eventually dashboard filters. One typo (`"agent:trio"`) silently becomes a new unmatched key. A startup check that validates all config file keys against known agent IDs would catch this.

## What feeds next phases

### Phase 10 — Courier
- Cost thresholds want a notification pipe when warn_usd is crossed. Courier provides it.
- 11-B won't land until 10 ships the Courier pipe.

### Phase 11-B (deferred) — UI + alerts + endpoint
- HTTP endpoint in `factory-dashboard/server/telemetry.mjs` serving `CostRollup` JSON
- React dashboard page binding to the endpoint (chart-per-dimension)
- Threshold evaluator that runs on a timer + on-demand, emits Courier events when `warn_usd` crossed
- Hard-cap enforcement integrated into `llm-router/src/router.js` Phase 2E check

### Phase 12 — B7 Admin Module
- Edit `cost-thresholds.json` via UI (or promote to Postgres `thresholds` table)
- Per-project / per-agent cap CRUD
- D113's schema_version field makes this migration clean

### Phase 13 — Pipeline Replay
- Cost of a replayed run should NOT double-count against budgets. Either tag replayed `llm_calls` with a `replay_of` column or filter them in rollups. Decision for Phase 13.

### Phase 14 — Multi-Project Concurrency
- Per-project caps matter more when 5 projects can eat budget in parallel. 11's config is the substrate; 14's scheduler consumes it.

### Phase 18 — Pipeline Module Marketplace
- Marketplace modules can declare estimated cost ranges. A module declaring "$0.50 per run" lets the pre-install check block it on accounts with tight daily caps.

## Stats

- **1 session**
- **$0.00 spent** (no LLM calls)
- **0 new dependencies** (uses node built-ins, reuses `memory-layer/artifact-walker.js` and Phase 2 `llm_calls` schema)
- **6 files created**: `cost-tracker/{types,artifact-source,db-source,service,smoke-test,README}.js|.md`
- **1 config file**: `configs/cost-thresholds.json`
- **0 files modified**: no changes to `llm-router/`, `memory-layer/`, graph files, `telemetry.mjs`
- **4 phase docs**: Plan (expanded from sketch), Status, Decisions, Lessons
- **4 Decisions**: D111-D114

## Phase 11-A exit criteria — met

- ✅ `cost-tracker/types.js` — CostRollup shape
- ✅ `cost-tracker/artifact-source.js` — filesystem rollup works end-to-end
- ✅ `cost-tracker/db-source.js` — SQL skeleton matches Phase 2C schema
- ✅ `cost-tracker/service.js` — unified entry point, 3 source modes
- ✅ `cost-tracker/smoke-test.js` — **22 assertions all pass**
- ✅ `configs/cost-thresholds.json` — threshold config format + 4 sample entries
- ✅ `cost-tracker/README.md` — API, filters, design decisions, rollback
- ⏳ 11-B UI/endpoint/alerts deferred to follow Phase 10 Courier

Phase 11-A is **wired, tested, and ready**. The contract (CostRollup shape, threshold schema) is stable. 11-B consumes without renegotiation.
