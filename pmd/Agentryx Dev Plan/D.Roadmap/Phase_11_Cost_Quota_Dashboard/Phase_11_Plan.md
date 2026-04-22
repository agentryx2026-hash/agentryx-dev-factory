# Phase 11 — Cost and Quota Dashboard

**One-liner**: Per-project, per-agent, per-model spend visualization. Alerts at threshold, hard caps trigger Courier notifications. Builds on the `llm_calls` table (Phase 2) and the artifact store (Phase 6-A).

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 ("read existing code before scoping"):

**Already captured — rollups just need to query it:**

- `llm-router/src/db.js` writes every LLM call to Postgres `llm_calls` with columns: `ts, project_id, phase, agent, task_type, router_backend, model_attempted, model_succeeded, input_tokens, output_tokens, cost_usd, latency_ms, request_id, langfuse_trace_id, error`
- Phase 2E budget caps (router.js:46-70): `max_project_budget_usd`, `max_daily_budget_usd`, `checkBudget()` pre-call refusal
- Artifact store (Phase 6-A): each artifact's `cost_usd` field captures per-LLM-call cost alongside content
- `memory-layer/artifact-walker.js:summarizeArtifacts(workspaceRoot)` already aggregates cost across projects — free cross-project view

**Gap to fill in Phase 11-A**:
- A rollup library that answers typed questions (per-project, per-agent, per-model, daily/weekly totals)
- HTTP endpoint shape so Phase 11-B React UI has a concrete contract
- Alert-threshold configuration format (not implementations — 11-B adds Courier wiring)

## Design

Two data sources, same interface:

```
                            ┌─ rollupFromDb(pool, filter) ───→ SQL queries on llm_calls
getRollup(filter) ──────────┤
                            └─ rollupFromArtifacts(root, fi) ─→ walker over _artifacts/index.jsonl
```

Same `CostRollup` return shape regardless of source:

```json
{
  "period": { "from": "2026-04-01T00:00:00Z", "to": "2026-04-22T23:59:59Z" },
  "totals": { "cost_usd": 4.18, "calls": 142, "tokens_in": 83100, "tokens_out": 41250 },
  "by_project": {
    "2026-04-21_todo-app": { "cost_usd": 1.25, "calls": 31, "tokens_in": 22300, "tokens_out": 10900 },
    ...
  },
  "by_agent":   { "troi": {...}, "picard": {...}, ... },
  "by_model":   { "openrouter:anthropic/claude-opus-4.7": {...}, ... },
  "by_day":     { "2026-04-21": {...}, "2026-04-22": {...} }
}
```

## Scope for this phase (11-A: rollup library + contract)

Mirrors 5-A / 6-A / 7-A / 8-A pattern — scaffolding alongside existing code, feature-flagged, wiring deferred.

| Sub | What | Deliverable |
|---|---|---|
| 11-A.1 | `cost-tracker/types.js` — `CostRollup`, `RollupFilter`, threshold shapes | ✅ |
| 11-A.2 | `cost-tracker/artifact-source.js` — read rollups from artifact stores via walker | ✅ |
| 11-A.3 | `cost-tracker/db-source.js` — SQL queries skeleton (no live DB needed for smoke) | ✅ |
| 11-A.4 | `cost-tracker/service.js` — unified entry point choosing source | ✅ |
| 11-A.5 | Threshold config format in `configs/cost-thresholds.json` | ✅ |
| 11-A.6 | Smoke test: synthetic workspace → rollup → assertions | ✅ |
| 11-A.7 | `cost-tracker/README.md` + flag docs | ✅ |

**Out of scope for 11-A** (deferred to 11-B):

- React dashboard UI page
- HTTP endpoint wiring in `factory-dashboard/server/telemetry.mjs`
- Live DB validation against real `llm_calls` rows
- Alert triggering (Courier PUSH when threshold crossed)
- Hard-cap enforcement (different from Phase 2E's pre-call cap — per-agent, per-project granular)
- Scheduled daily/weekly cost reports

## Why this scope is right

- **Contract-first**: 11-A nails the rollup JSON shape. 11-B React UI binds to that contract without further negotiation.
- **Two-source parity**: artifact-based rollups work without a DB (runs in any workspace), DB-based rollups are richer once wired. Same result type — no fork.
- **Configurability-first (P1)**: `COST_TRACKER_SOURCE=artifacts|db|both` env var.
- **Reuses Phase 7-A walker**: no new FS-scanning code.

## Phase close criteria

- ✅ `cost-tracker/` scaffolded
- ✅ Artifact-source rollup works end-to-end on a synthetic workspace
- ✅ DB-source skeleton compiles and uses the real schema (but can't smoke-test without DB)
- ✅ Rollup JSON shape documented in README
- ✅ Threshold config format documented (11-B implements enforcement)
- ✅ No changes to `llm-router/`, `memory-layer/`, graph files, or `telemetry.mjs`
- ✅ Phase docs: Plan (expanded), Status, Decisions (D111-Dxx), Lessons

## Decisions expected

- **D111**: `cost-tracker/` lives in `cognitive-engine/`, not `llm-router/` (crosses module boundaries — consumer of both)
- **D112**: Artifact source and DB source return the same shape — unified `CostRollup` interface
- **D113**: Thresholds configured in a JSON file, not hardcoded — Phase 12 admin UI will edit it
- **D114**: No HTTP endpoint in 11-A — contract first, wiring in 11-B (avoids coupling to dashboard's http layer before the contract is stable)
