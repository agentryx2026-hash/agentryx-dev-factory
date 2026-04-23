# Phase 10 — Decisions Log

## D120 — Courier is the factory-side producer API; Hermes is the transport

**What**: `cognitive-engine/courier/` is a thin library that factory modules call when they have an event. It packages the event, resolves the route, and hands off to a backend. The actual Slack/GitHub/email integrations live inside Hermes (deployed in gateway mode, Phase 10-B).

**Why**:
- **Separation of concerns.** Factory code shouldn't touch Slack SDK, GitHub App auth, SMTP configuration. All of that's messy, credential-heavy, and evolves independently from factory logic.
- **Matches D74** (Phase 2.75 evaluation verdict). Hybrid adoption: Hermes for Courier, per our explicit "use Hermes where it adds value" decision.
- **Single integration surface.** Five modules (router, verify, cost-tracker, etc.) all call `courier.dispatch()`. None of them know or care about Slack tokens. If Hermes is ever swapped for a different transport (or replaced with custom code at R4), only `backends/http.js` changes — callers don't.

## D121 — Fake backend as default; HTTP opt-in via env

**What**: `getCourier()` returns a fake-backed instance unless `COURIER_BACKEND=http` is set. Fake stores events in memory and returns `{ok: true}` — no real delivery.

**Why**:
- **Dev environment doesn't have Hermes running** today (and won't until 10-B).
- **Tests become deterministic.** Smoke test doesn't need network, tokens, or a live gateway.
- **Same pattern as Verify-integration (D115)**. Both phases adopted "fake by default, http for real" because both depend on external services not yet deployed.
- **Null backend for compliance lockdown.** A third option (`COURIER_BACKEND=null`) exists specifically for deployments where outbound comms must stay off (air-gapped, regulated industries).

## D122 — Routing rules in JSON, not code

**What**: `configs/courier-routing.json` lists event-type → channels mapping. Admin UI (Phase 12) edits this file (or its Postgres successor).

**Why**:
- **Runtime edit without redeploy.** Operations team tunes "send cost alerts to #factory-ops-urgent instead of #factory-ops" without shipping code.
- **Schema-versioned.** `schema_version: 1` field lets 10-B and Phase 12 add fields cleanly.
- **Same substrate pattern** as `cost-thresholds.json` (Phase 11-A) and `pmd-registry.json` (Phase 4). Keep the admin-UI mental model consistent across subsystems.
- **Visible defaults.** The shipped config IS the documentation of what fires where by default. Reading `configs/courier-routing.json` answers "what happens on budget_exceeded?" without grepping code.

## D123 — Unknown event types are DROPPED, not ignored silently

**What**: If `courier.dispatch({type: "project.mystery_event", ...})` is called and no routing rule matches the type, the event is dropped with `{ok: true, dropped: true, reason: "no routing rule for event type 'project.mystery_event'"}`.

**Why**:
- **Silent swallow hides typos.** `cost.budget_exceded` (missing letter) would vanish without a trace.
- **Dropped != error.** `ok: true` because dispatch itself succeeded — the event just had nowhere to go. A typo doesn't crash the factory.
- **`reason` is inspectable.** Caller can log + alert on `dropped: true` if they want to catch regressions.
- **Also protects against new-type drift.** Someone adds `project.demo_video_rendered` to `EVENT_TYPES` in types.js but forgets the routing rule; dispatch returns dropped with a clear reason. Next PR adds the rule.

## D124 — No direct Slack/GitHub/email SDKs in `courier/`

**What**: Courier never imports `@slack/web-api`, `@octokit/rest`, `nodemailer`, etc. Only the http backend's `fetch()` to Hermes gateway.

**Why**:
- **Dependency minimalism.** Pulling in Slack's SDK alone adds ~50 transitive deps. If every module that wants to notify Slack adds its own SDK, the package tree balloons.
- **Hermes already has these integrations.** Rebuilding them in factory = duplicate work.
- **Simpler factory code.** When Slack API changes, we update Hermes once; not N different direct SDK calls across the codebase.
- **Consistent auth.** Hermes owns tokens. Factory just POSTs to gateway. If a credential leaks, rotation happens in one place.

**Tradeoff**: if Hermes is unavailable or slow, factory notifications are degraded. Accepted — notifications are observability, not correctness. Fail-open contract means factory pipeline continues even if nothing can be delivered (matches D119 from Phase 9-A).
