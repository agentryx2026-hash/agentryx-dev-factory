# Phase 10 — Lessons Learned

Phase 10-A closed: 2026-04-22. Duration: single session.

## What surprised us

1. **Severity as a rank-based filter is tiny but powerful.** `SEVERITY_RANK = {info: 0, warn: 1, error: 2}` + `min_severity` on rules means operators can silence noise without editing code — just set `min_severity: "error"` on any rule. Three lines of logic; durable UX.

2. **`$project_id` substitution in routing targets was cheaper than expected.** Literal string replace, no template engine, no regex-of-doom. One `.replace()` call. Makes per-project routing trivial without pulling in a templating library.

3. **Routing rules being append-only JSON is a feature, not a limitation.** 10-A ships 8 rules. 10-B and onwards will add more. Rules map 1-to-1 with event types. Reading the config file gives a complete inventory of "what fires where." Grep-friendly documentation.

4. **Phase 11-A and 9-A were deferring on the same dependency.** Both wanted to alert/notify on specific events — cost thresholds + verify feedback — and both deferred because no Courier existed. Phase 10-A unblocks BOTH in one phase. Dependency graph discovery pays off.

## What to do differently

1. **Dropped events should surface in a dashboard eventually.** `{dropped: true, reason: "..."}` is fine in logs but easy to miss. Phase 12 admin UI should include a "recent dropped events" panel — helps catch routing-rule gaps early.

2. **`getCourier()` returns a new instance each call.** Smoke test exercises this, but in production calling `getCourier()` in 10 different modules = 10 copies of history. For 10-B, consider a singleton at telemetry.mjs boot that all modules import. Instance-scoped history is fine for tests; production wants unified timeline.

3. **Event body formatting is still ad-hoc.** Each caller writes `title` + `body` as plain strings. Different callers will format inconsistently. Consider a `formatEvent(type, data)` helper library in 10-B that standardizes rendering per event type (consistent Slack message layout, consistent GitHub comment headers).

## What feeds next phases

### Phase 10-B — Hermes gateway + producer wiring
- Start `hermes/` container in gateway mode
- Configure channels: Slack bot, GitHub App, SMTP
- Wire `llm-router/src/router.js:65` `budget_exceeded` error → `cost.budget_exceeded` event
- Wire `verify-integration/feedback-receiver.js` → `verify.feedback_received`
- Wire Phase 11-A threshold evaluator (new code in 10-B) → `cost.threshold_warn` (periodic)
- Singleton courier instance at telemetry.mjs startup
- Credential management via Phase 2.5 Key Console

### Phase 11-B — Cost Dashboard
- No longer blocked. Threshold evaluator fires `cost.threshold_warn` via Courier.
- UI can display recent dispatched events ("last 10 notifications").

### Phase 9-B — Verify integration real wire-up
- No longer blocked. Verify feedback webhook → memory observation → `verify.feedback_received` Courier event.

### Phase 12 — B7 Admin Module
- `configs/courier-routing.json` is the substrate for admin UI CRUD. Users edit "who gets what" via UI; no deploys.
- Postgres successor likely mirrors current JSON shape 1:1.

### Phase 14 — Multi-Project Concurrency
- Per-project routing via `$project_id` substitution already works. 14 just consumes it.
- Per-tenant routing (once admin model supports multi-tenant) = same pattern, different substitution variable.

### Phase 19 — Customer Portal
- `project.delivery_ready` event fires to customer email.
- Routing is already configured in default JSON — just needs real customer email per project at 19 time.

## Stats

- **1 session**
- **$0.00 spent** (no LLM calls)
- **0 new dependencies** (uses node built-ins only)
- **7 files created**: `courier/{types,router,service,smoke-test,README}.js|.md` + `courier/backends/{fake,http,null}.js`
- **1 config file created**: `configs/courier-routing.json`
- **0 files modified**: no changes to `llm-router/`, `hermes/`, graph files, `telemetry.mjs`, `verify-integration/`, `cost-tracker/`, `memory-layer/`
- **4 phase docs**: Plan (expanded from sketch), Status, Decisions, Lessons
- **5 Decisions**: D120-D124

## Phase 10-A exit criteria — met

- ✅ `courier/types.js` — 8 event types, 6 channels, severity + validators
- ✅ `courier/backends/` — fake (default), http (Hermes gateway), null (disabled)
- ✅ `courier/router.js` — resolves events to channels with severity filter + `$project_id` substitution
- ✅ `courier/service.js` — `getCourier()` + `dispatch()` with event_id + history
- ✅ `configs/courier-routing.json` — 8 rules covering plan taxonomy
- ✅ Smoke test — **33 assertions all pass**
- ✅ Real config file loaded by smoke test confirms routing config is parseable end-to-end
- ✅ Zero changes to existing modules
- ⏳ 10-B deferred (needs user-side Slack/GitHub/email credentials + Hermes deploy)

Phase 10-A is **wired, tested, and ready**. Unblocks 9-B and 11-B.
