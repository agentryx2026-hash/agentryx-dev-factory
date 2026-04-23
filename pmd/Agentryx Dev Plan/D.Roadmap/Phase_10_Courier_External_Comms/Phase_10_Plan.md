# Phase 10 — Courier (External Comms Agent)

**One-liner**: External communications layer — GitHub PR open/comment, Slack / Discord / Email notifications, status pings. Decouples agent reasoning from external API plumbing.

**Previously named "Hermes"** — renamed 2026-04-21 to avoid collision with the external Hermes Agent framework (Nous Research) evaluated in Phase 2.75. **Courier IS Hermes in gateway mode** per D74.

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 ("read existing code before scoping"):

- `hermes/` directory already exists (Phase 2.75). Contains `docker-compose.yml` + `start-with-live-keys.sh` + `README.md`. `data/` is empty — Hermes container not started in this session.
- No existing `CommsService` interface or dispatcher in `cognitive-engine/`.
- Phase 11-A (`cost-tracker`) expects Courier for `cost.budget_exceeded` events — this is the primary blocker for 11-B.
- Phase 9-A (`verify-integration`) expects Courier for `project.pr_opened` / `verify.feedback_received` — blocker for 9-B full wire-up.
- `llm-router/src/router.js:65` already emits `budget_exceeded` error when thresholds trip — ready consumer.

## Design

Three pieces, matching prior phases' scaffolding discipline:

1. **Event contract** — typed `CourierEvent` with known event types matching the Phase 10 plan taxonomy.
2. **Pluggable `CommsService`** — fake (default, in-memory), http (Hermes gateway), null (disabled). Same shape.
3. **Routing config** — event-type → channels map in `configs/courier-routing.json`. Admin UI (Phase 12) edits.

```
factory emits event
     │
     ├─ courier.dispatch(event)
     │      │
     │      ├─ routing.resolveChannels(event.type) → [slack, email]
     │      │
     │      ├─ backend.send(channel, formattedMessage)  ─→ fake / http / null
     │      │
     │      └─ history append (for debugging / audit)
```

## Scope for this phase (10-A: contract + fake backend + routing)

Mirrors 5-A / 6-A / 7-A / 8-A / 9-A / 11-A pattern — library alongside existing code, feature-flagged, no Hermes container work, no dashboard wiring.

| Sub | What | Deliverable |
|---|---|---|
| 10-A.1 | `courier/types.js` — CourierEvent kinds, Channel enum, RoutingRule shapes | ✅ |
| 10-A.2 | `courier/backends/fake.js` — in-memory event sink, inspectable | ✅ |
| 10-A.3 | `courier/backends/http.js` — POSTs to `${HERMES_GATEWAY_URL}`, fail-open | ✅ |
| 10-A.4 | `courier/backends/null.js` — silent sink (for disabling comms) | ✅ |
| 10-A.5 | `courier/router.js` — event-type → channels resolver | ✅ |
| 10-A.6 | `configs/courier-routing.json` — default routing matching Phase 10 plan taxonomy | ✅ |
| 10-A.7 | `courier/service.js` — `getCourier()` factory + `dispatch()` entry point | ✅ |
| 10-A.8 | Smoke test: 6 event types, 3 backends, routing resolution, history audit | ✅ |
| 10-A.9 | `courier/README.md` + flag docs | ✅ |

**Out of scope for 10-A** (deferred to 10-B):

- Starting Hermes docker container in gateway mode
- Configuring Slack / GitHub / email channel bindings in Hermes
- Wiring `llm-router`'s `budget_exceeded` error to fire `cost.budget_exceeded` Courier event
- Wiring Phase 9-A `verify-integration` feedback to fire `verify.feedback_received`
- Wiring Phase 11-A threshold evaluator to fire `cost.budget_exceeded` before hard cap
- Actual Slack / GitHub / email delivery testing (needs real tokens + live Hermes)

## Why this scope is right

- **Contract-first.** 10-A nails the `CourierEvent` JSON and `RoutingRule` config shape. 10-B wires against stable schema.
- **Fake backend makes 10-A fully testable.** No Hermes container, no Slack tokens, no real POSTs. Record events in memory, assert on dispatch.
- **Unblocks two deferred phases.** Once 10-B ships real Hermes gateway, 11-B (cost UI + alerts) and 9-B (Verify feedback wiring) can both light up.
- **Matches P1 (configurability)**: 4 backend options (fake / http / null / future custom) behind one flag. Admin UI at Phase 12 swaps.
- **Matches D74**: Phase 2.75 verdict was hybrid adoption — Hermes for Courier. 10-A builds the factory-side API; 10-B deploys the Hermes-backed reality.

## Phase close criteria

- ✅ `courier/` scaffolded (types, 3 backends, router, service, smoke-test, README)
- ✅ `configs/courier-routing.json` defines default routing for 6 event types
- ✅ Smoke test end-to-end: event dispatched → routing resolves → backend receives → history recorded
- ✅ Fail-open for HTTP backend (gateway unreachable = logged no-op, no exception)
- ✅ `USE_COURIER` + `COURIER_BACKEND` + `HERMES_GATEWAY_URL` flags documented
- ✅ No changes to `llm-router/`, `hermes/`, graph files, `telemetry.mjs`, `verify-integration/`, `cost-tracker/`
- ✅ Phase docs: Plan (expanded), Status, Decisions (D120-Dxx), Lessons

## Decisions expected

- **D120**: Courier as a factory-side library, not a separate service — Hermes container is the *transport*, `courier/` is the producer API
- **D121**: Fake backend as default; HTTP backend (Hermes gateway) opt-in via env — same pattern as Verify integration (D115)
- **D122**: Routing config as JSON (not code) — admin UI edits, Phase 12 substrate
- **D123**: Event types are strings with a fixed taxonomy — adding a new event requires a routing entry (fails loud if missing)
- **D124**: No direct Slack/GitHub/email APIs in `courier/` — all go through Hermes gateway. Simpler factory code, one integration surface.
