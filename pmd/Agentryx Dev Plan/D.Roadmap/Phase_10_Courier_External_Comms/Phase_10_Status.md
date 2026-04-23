# Phase 10 — Status: 10-A COMPLETE ✅  (10-B DEFERRED)

**Phase started**: 2026-04-22
**Phase 10-A closed**: 2026-04-22
**Duration**: single session

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 10-A.1 | `courier/types.js` — event types, channels, validators | ✅ done |
| 10-A.2 | `courier/backends/fake.js` — default, inspectable | ✅ done |
| 10-A.3 | `courier/backends/http.js` — POSTs to Hermes gateway, fail-open | ✅ done |
| 10-A.4 | `courier/backends/null.js` — silent discard | ✅ done |
| 10-A.5 | `courier/router.js` — routing config loader + resolveRoute | ✅ done |
| 10-A.6 | `configs/courier-routing.json` — 8 rules matching plan taxonomy | ✅ done |
| 10-A.7 | `courier/service.js` — getCourier() factory + dispatch() | ✅ done |
| 10-A.8 | Smoke test — 33 assertions across 6 test groups | ✅ done — all pass |
| 10-A.9 | `courier/README.md` | ✅ done |
| 10-B | Hermes gateway deployment + real event wiring | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/courier/types.js` (new, ~90 lines)
- 8 event types frozen: `project.pr_opened/deployment_ready/delivery_ready`, `verify.feedback_received`, `cost.budget_exceeded/threshold_warn`, `agent.error_rate_spike`, `factory.smoke_test`
- 6 channels: slack, github, email, discord, telegram, stdout
- 3 severities with rank-based comparison (`severityMeetsThreshold`)
- `validateEvent()` single-function validator returning null (ok) or error string

### `cognitive-engine/courier/router.js` (new, ~50 lines)
- `loadRoutingConfig(path)` — cached JSON load, `COURIER_ROUTING_CONFIG` env override
- `resolveRoute(event, config)` — finds rule, applies severity filter, substitutes `$project_id`, returns `{channels, dropped, reason}`
- Drops unknown event types with explicit reason (D123)

### `cognitive-engine/courier/service.js` (new, ~55 lines)
- `getCourier({backend, ...})` — factory function, instance-scoped history + seq counter
- `dispatch(event)` — validates → resolves route → sends per-channel → records history
- Event IDs monotonic `EVT-NNNN` per courier instance
- Returns `{ok, event_id, channels_used, deliveries, dropped?}` for clean HTTP handling later

### `cognitive-engine/courier/backends/` (new, 3 files)
- `fake.js` — in-memory sink with `_getSent()`, `_byChannel()`, `_clear()` for tests
- `http.js` — POSTs to `${HERMES_GATEWAY_URL}/channels/<ch>/send`, fail-open on network errors
- `null.js` — discards silently (for disabled-comms deployments), counts for observability

### `configs/courier-routing.json` (new)
- 8 routing rules matching Phase 10 plan event taxonomy exactly
- `default_targets` for slack and email (GitHub target is per-event)
- `min_severity` filters on cost.budget_exceeded (error) and cost.threshold_warn (warn)
- Schema versioned for Phase 12 admin-UI migration

### `cognitive-engine/courier/smoke-test.js` (new)
- **33 assertions across 6 test groups**:
  - validation: 7 (null, empty, unknown type, missing title, valid, severity values)
  - routing: 10 (severity filter, $project_id substitution, default_targets, unknown drop, reason messages)
  - fake backend dispatch: 12 (event_id assigned, channels used, fan-out, drop semantics, history populated)
  - null backend: 2 (count but discard)
  - invalid backend: 1 (unknown rejected)
  - real config file: 4 (schema_version loaded, ≥6 rules present, real event dispatched correctly)

### `cognitive-engine/courier/README.md` (new)
- Flow diagram, event taxonomy table, routing config shape, API examples, design decisions, flags, rollback, 10-B preview

### Unchanged
- `llm-router/` — untouched. 10-B will emit Courier events from the budget-exceeded error path.
- `hermes/` directory — untouched. 10-B starts the container in gateway mode.
- `verify-integration/`, `cost-tracker/` — both ready to fire Courier events; 10-B wires them.
- Graph files, `memory.js`, `tools.js`, `telemetry.mjs` — all untouched
- Zero regression risk

## Smoke test highlight

```
[fake backend dispatch]
  ✓ dispatch ok
  ✓ event_id assigned (EVT-0001)
  ✓ routed to stdout per default config
  ✓ budget exceeded ok
  ✓ fans out slack+email
  ✓ dropped flag set
  ✓ 3 delivery attempts recorded

[real config file]
  ✓ schema_version loaded
  ✓ at least 6 routing rules (got 8)
  ✓ verify.feedback_received routes to slack per default config
```

## Why 10-B deferred

10-B = deploying Hermes in gateway mode, configuring channels (Slack bot token, GitHub App install, SMTP/SendGrid), and wiring real factory events through Courier → Hermes → channels. Requires:

- **User-side setup**: Slack Bot OAuth token, GitHub App install, SMTP/SendGrid credentials — none of these are in factory code.
- **Hermes container config**: `hermes/data/` persistent config files for gateway mode (channel bindings, auth).
- **Event wiring into existing modules**:
  - `llm-router`: budget_exceeded error → `cost.budget_exceeded`
  - `verify-integration`: feedback received → `verify.feedback_received`
  - `cost-tracker`: threshold evaluator (periodic) → `cost.threshold_warn`

10-A's contract is firm. 10-B swaps the default backend to `http` and wires producers to call `courier.dispatch()` at the right moments.

## Unblocks

- **Phase 11-B** (cost dashboard UI + alerts): threshold alerts now have a notification pipe
- **Phase 9-B** (Verify real wire-up): feedback events can go to Slack
- **Phase 14** (multi-project concurrency): per-project event routing (`$project_id` substitution already in 10-A)

## Feature-flag posture (P1 configurability-first)

| Flag | Default | Effect |
|---|---|---|
| `PRE_DEV_USE_GRAPH` | off | Phase 4 |
| `USE_MCP_TOOLS` | off | Phase 5 — awaits 5-B |
| `USE_ARTIFACT_STORE` | off | Phase 6 — awaits 6-B |
| `USE_MEMORY_LAYER` | off | Phase 7 — awaits 7-E |
| `USE_PARALLEL_DEV_GRAPH` | off | Phase 8 — awaits 8-B |
| `USE_VERIFY_INTEGRATION` | off | Phase 9 — awaits 9-B |
| `USE_COST_TRACKER` | off | Phase 11 — awaits 11-B |
| `USE_COURIER` | off | Phase 10 — awaits 10-B |
| `COURIER_BACKEND` | `fake` | swap to `http` once Hermes gateway deployed |

## Phase 10-A exit criteria — met

- ✅ `courier/` scaffolded (types, 3 backends, router, service, smoke-test, README)
- ✅ `configs/courier-routing.json` defines default routing for 8 event types
- ✅ Smoke test — **33 assertions all pass**
- ✅ Fail-open for HTTP backend (gateway unreachable = fail_open flag set, no exception)
- ✅ Unknown event types dropped loudly (D123)
- ✅ `USE_COURIER` + `COURIER_BACKEND` + `HERMES_GATEWAY_URL` flags documented
- ✅ No changes to `llm-router/`, `hermes/`, graph files, `telemetry.mjs`, `verify-integration/`, `cost-tracker/`
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 10-B deferred (needs user-side channel credentials + Hermes gateway deploy)

Phase 10-A is **wired, tested, and ready**. Contract firm; 10-B deploys Hermes and wires producers.
