# Courier — External Comms

Factory-side library for dispatching events to external channels (Slack, GitHub, email, Discord, Telegram). Per D74 (Phase 2.75 evaluation), **Courier IS Hermes in gateway mode** — Courier is the producer API; Hermes is the transport.

## Status: Phase 10-A scaffolding

Library + fake/http/null backends + routing config shipped. **Hermes container not yet deployed in gateway mode** (that's 10-B). Fake backend is default.

## Files

- `types.js` — `CourierEvent`, `CourierChannel`, `RoutingRule`, validators, severity comparison
- `router.js` — loads routing config, resolves `event → channels[]`
- `service.js` — `getCourier({backend, ...})` factory + `dispatch(event)` entry point
- `backends/fake.js` — default. In-memory sink, inspectable.
- `backends/http.js` — POSTs to `${HERMES_GATEWAY_URL}/channels/<ch>/send`. Fail-open.
- `backends/null.js` — silent discard. For deployments where comms must stay off.
- `smoke-test.js` — 33 assertions: validation, routing, dispatch, 3 backends, config load
- `../../configs/courier-routing.json` — 8 default routing rules covering the Phase 10 plan taxonomy

## Event flow

```
factory code:
  await courier.dispatch({ type: "cost.budget_exceeded", title: "over cap", severity: "error", ... });
                                       │
                                       ▼
                        router.resolveRoute(event, config)
                                       │
                                       ├─ severity filter?           (drop if below rule min_severity)
                                       ├─ targets applied            ($project_id → event.project_id)
                                       │
                                       ▼
                        backend.send(channel, event, target) × N
                                       │
                                       ├─ fake  → in-memory store
                                       ├─ http  → POST ${HERMES}/channels/<ch>/send
                                       └─ null  → discard
                                       │
                                       ▼
                        { ok, event_id, channels_used, deliveries, dropped? }
```

## Event taxonomy (8 types)

| Event | Channels (default) | Typical severity |
|---|---|---|
| `project.pr_opened` | github | info |
| `project.deployment_ready` | slack | info |
| `project.delivery_ready` | email + slack | info |
| `verify.feedback_received` | slack | info/warn |
| `cost.budget_exceeded` | slack + email | error |
| `cost.threshold_warn` | slack | warn |
| `agent.error_rate_spike` | slack | warn/error |
| `factory.smoke_test` | stdout | info |

Adding a new event type = adding `EVENT_TYPES` entry in `types.js` + routing rule in `configs/courier-routing.json`. No rule = event dropped at dispatch (D123, loud).

## Routing config shape (`configs/courier-routing.json`)

```json
{
  "schema_version": 1,
  "default_targets": {
    "slack": "#factory-ops",
    "email": "ops@agentryx.dev"
  },
  "rules": [
    {
      "event_type": "cost.budget_exceeded",
      "channels": ["slack", "email"],
      "min_severity": "error"
    },
    {
      "event_type": "project.pr_opened",
      "channels": ["github"],
      "targets": { "github": "$project_id" }
    }
  ]
}
```

`$project_id` in a target is substituted with `event.project_id` at dispatch time (simple literal replacement; nothing fancy).

## API

```js
import { getCourier } from "./courier/service.js";

const courier = await getCourier();           // reads COURIER_BACKEND env (default "fake")

const result = await courier.dispatch({
  type: "cost.budget_exceeded",
  title: "Project todo-app exceeded daily cap",
  body: "Daily budget $5.00 exceeded at 23:47Z. Pipeline paused.",
  severity: "error",
  project_id: "2026-04-22_todo-app",
  meta: { amount_usd: 5.32, cap_usd: 5.00 },
});

// result = {
//   ok: true,
//   event_id: "EVT-0007",
//   channels_used: ["slack", "email"],
//   deliveries: [{channel: "slack", target: "#factory-ops", ok: true}, {...}]
// }

courier.getHistory();    // [{event, result}, ...]
```

## Feature flags

```
USE_COURIER=true                         # Phase 10-B onwards: factory events actually dispatch
                                         # Phase 10-A: flag has no runtime effect yet (callers not wired)
COURIER_BACKEND=fake                     # "fake" (default) | "http" | "null"
HERMES_GATEWAY_URL=https://hermes...     # required when COURIER_BACKEND=http (10-B)
HERMES_GATEWAY_TOKEN=<bearer>            # optional auth for http backend
COURIER_ROUTING_CONFIG=/path/to/json     # override default configs/courier-routing.json
```

## Smoke test

```
$ node courier/smoke-test.js
[validation]             ✓ 7 assertions
[routing]                ✓ 10 assertions (severity filter, $project_id substitution, default_targets, unknown-type drop)
[fake backend dispatch]  ✓ 12 assertions (event_id assignment, fan-out, drop semantics, history)
[null backend]           ✓ 2 assertions
[invalid backend]        ✓ 1 assertion
[real config file]       ✓ 4 assertions (8 rules loaded, verify.feedback_received dispatches correctly)

[smoke] OK  — 33 assertions across 6 test groups
```

## Design decisions

- **Courier is the producer API; Hermes is the transport** (D120). Factory code calls `courier.dispatch()`, never touches Slack/GitHub/email directly. Hermes container (10-B) handles channel integrations.
- **Fake backend as default** (D121). Matches Verify-integration (D115) pattern: dev + tests work without live external services.
- **Routing in JSON, not code** (D122). Phase 12 admin UI edits this file. Same substrate plan as `cost-thresholds.json`.
- **Unknown event types are dropped loudly** (D123). Silent swallow would hide typos; drop with reason logged.
- **No direct Slack/GitHub/email SDKs in this module** (D124). All integrations go through Hermes. Single integration surface = simpler factory code.

## Rollback

`USE_COURIER=false` (default). Phase 10-A has no runtime hooks in graph files, telemetry.mjs, cost-tracker, verify-integration, or llm-router. The library exists but nothing calls it.

## What 10-B adds

- Start Hermes docker container in gateway mode
- Configure Slack / GitHub / email channel bindings in Hermes config files
- Wire `llm-router`'s `budget_exceeded` error → Courier `cost.budget_exceeded` event
- Wire Phase 9-A feedback receiver → Courier `verify.feedback_received` event
- Wire Phase 11-A threshold evaluator → Courier `cost.threshold_warn` events
- Real channel delivery testing with live tokens
