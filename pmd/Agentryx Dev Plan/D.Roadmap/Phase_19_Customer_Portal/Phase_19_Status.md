# Phase 19 — Status: 19-A COMPLETE ✅ + 19-B Tier B handler + HTTP surface + back-feed wrapper + SLA breach scanner shipped (React UI + Courier + password auth still deferred)

**Phase started**: 2026-04-24
**Phase 19-A closed**: 2026-04-24
**Phase 19-B Tier B handler closed**: 2026-05-18 (`project_intake` queue handler — walks submitted→accepted→in_progress + enqueues downstream pre_dev)
**Phase 19-B HTTP surface closed**: 2026-05-18 (6 endpoints at `/api/customer-portal/*` — admin register/list + customer submit/list/status/cancel; bearer auth + auto-enqueue project_intake)
**Phase 19-B back-feed wrapper closed**: 2026-05-18 (`wrapForCustomerBackfeed` — pre_dev completion transitions submission to `delivered`; closes the customer-side lifecycle for v0.0.1)
**Phase 19-B SLA breach scanner closed**: 2026-05-18 (`createSlaBreachScanner` — periodic background daemon emits `sla_breached` timeline events for non-terminal submissions past their target; idempotent via timeline dedup; D229 hotfix injects customer_id into index entries after live-test catch — same D226 lesson re-applied)
**Phase 19-B portal notifier (scanner wiring) closed**: 2026-05-18 (`createPortalNotifier` — translates portal lifecycle events to Courier `customer.*` event dispatches; scanner-first wiring delivers `customer.sla_breached` on every fresh breach; other 3 sources wire per follow-on D231-D233 ships)
**Phase 19-B portal notifier (HTTP /submit + /cancel wirings) closed**: 2026-05-18 (`onSubmitted` + `onCancelled` methods added to notifier; shared `getPortalNotifier()` getter hoisted to module scope; bonus: live HTTP test triggered first end-to-end production validation of D224+D225+D227+D231 chain on real LLM — submission delivered, $1.59 spend)
**Phase 19-B portal notifier (intake + back-feed + admin reject) closed**: 2026-05-19 (D232 `onAccepted` wired into project_intake handler after submitted→accepted; D232 `onDelivered` wired into back-feed wrapper after in_progress→delivered; D233 admin reject HTTP endpoint + `onRejected` notifier method + Reject button on Customer Portal tab. All 6 customer.* notification sources now wired end-to-end. Notifier smoke 130/130; live integration verify 13/13)
**Duration**: 19-A single session; 19-B handler ~30 min; HTTP surface ~45 min; back-feed wrapper ~30 min; SLA scanner ~30 min over the substrate

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 19-A.1 | `customer-portal/types.js` — CustomerAccount / CustomerTier (3) / ProjectSubmission / SubmissionStatus (6) / TimelineEvent (9 kinds) / SLAPolicy / SLAStatus / SubmissionReceipt + validators + DEFAULT_TIER_POLICIES | ✅ done |
| 19-A.2 | `customer-portal/accounts.js` — account store with SHA-256-hashed opaque tokens, per-customer sandbox dirs, email uniqueness, rotate/revoke/setTier | ✅ done |
| 19-A.3 | `customer-portal/submissions.js` — per-customer isolated submission store; state-machine-gated transitions; addCost accumulation; countActive + stats | ✅ done |
| 19-A.4 | `customer-portal/timeline.js` — append-only JSONL per submission; 9 event kinds; filter by kind/phase; latest + countByKind | ✅ done |
| 19-A.5 | `customer-portal/sla.js` — 3-tier SLA engine; computeTargetDelivery + computeStatus (4 bands) + findBreaches + checkQuota; policy overrides + test-clock injection | ✅ done |
| 19-A.6 | `customer-portal/portal.js` — high-level API composing all 4 stores; typed auth errors (UNAUTHORIZED/FORBIDDEN/QUOTA_EXCEEDED/VALIDATION); customer surface + platform-internal surface | ✅ done |
| 19-A.7 | Smoke test — 138 assertions across 12 test groups | ✅ done — all pass |
| 19-A.8 | `customer-portal/README.md` + `USE_CUSTOMER_PORTAL` flag registered in admin-substrate | ✅ done |
| 19-B Tier B | `project_intake` queue handler — submission state-machine walk + downstream pre_dev enqueue | ✅ done 2026-05-18 |
| 19-B HTTP surface | 6 endpoints at `/api/customer-portal/*` — admin register/list + customer submit/list/status/cancel; bearer auth + auto-enqueue project_intake | ✅ done 2026-05-18 |
| 19-B back-feed wrapper | `wrapForCustomerBackfeed` wraps pre_dev → on completion transitions submission `in_progress → delivered` + records timeline event; fail-isolated | ✅ done 2026-05-18 |
| 19-B SLA breach scanner | `createSlaBreachScanner` — periodic daemon scans non-terminal submissions, emits `sla_breached` timeline events past target; idempotent via timeline dedup; opt-out via `SLA_SCANNER_DISABLED=true` | ✅ done 2026-05-18 |
| 19-B portal notifier (scanner-first wiring) | `createPortalNotifier({courier}).onSlaBreached` — translates portal events → Courier `customer.*` dispatches; SLA scanner wired first; 6 new event types + 6 routing rules; default backend=fake (in-memory history); opt-out via `NOTIFIER_DISABLED=true` | ✅ done 2026-05-18 |
| 19-B portal notifier (HTTP /submit + /cancel) | `onSubmitted` + `onCancelled` methods added; HTTP routes wired through shared `getPortalNotifier()` getter; live integration verify 14/14 pass; **bonus: D224+D225+D227+D231 chain validated end-to-end on real LLM via the verify itself** | ✅ done 2026-05-18 |
| 19-B portal notifier (intake + back-feed + admin reject) | `onAccepted` (project_intake / D232) + `onDelivered` (back-feed / D232) + `onRejected` (admin / D233); new admin reject HTTP endpoint + Reject button on Customer Portal tab; notifier smoke 130/130; live verify 13/13 | ✅ done 2026-05-19 |
| 19-B full | React UI + Courier per-customer notification prefs (19-C) + budget gate + Verify linkage + password auth | ⏳ DEFERRED |

## Phase 19-B Tier B handler — what shipped (2026-05-18)

**`cognitive-engine/concurrency/handlers/project-intake-handler.js`** (new, ~120 lines):
- `registerProjectIntakeHandler(registry, { portal, queue, onLog? })` — registers `project_intake` kind on a Phase 14-A handler registry. Same DI pattern as D211 (factory) / D217 (architect) / D219 (training_gen) / D220 (training_video_render).
- Payload: `{ customer_id, submission_id }` — minimal; everything else is read from the portal.
- Lifecycle: lookup submission → `submitted→accepted` transition + timeline event → enqueue downstream `pre_dev` with `intake_payload` as `task` and `<CUST-id>_<SUB-id>` as `project_id` (so cost-tracker + quota gate scope per-customer) → `accepted→in_progress` transition + `phase_change → pre_dev` timeline event.
- Failure isolation: if downstream `pre_dev` enqueue fails, timeline records an `error` event and the submission stays in `accepted` (NOT advanced to `in_progress`) so the founder can re-fire after fixing the underlying issue.
- Returns `{submission_id, customer_id, accepted_at, downstream_pre_dev_job_id, downstream_project_id, status: "in_progress"}`.

**`bootQueueWorker` extension** in `factory-dashboard/server/telemetry.mjs`:
- Lazy-imports `project-intake-handler.js` + `customer-portal/portal.js` alongside the other handler modules (fail-tolerant via `.catch(() => null)`)
- Registers `project_intake` with a Live Trace `onLog` hook that surfaces lifecycle events to the Dev-Hub sidebar
- Portal instance shares the `QUEUE_WORKSPACE` root with the rest of the factory (so customer files live at `<workspace>/_customer-portal/`)

**Smoke test** — `cognitive-engine/concurrency/handlers/project-intake-handler.smoke.js`:
- **38 assertions** across 6 scenarios — registration; valid happy path (state-machine walk + downstream enqueue + timeline events + return shape + log markers); missing-field rejection; submission-not-found (fail fast, no transitions, no enqueue); downstream-enqueue-failure (stays in accepted + timeline `error`); dep validation
- All pass; no real filesystem or portal needed (every dep stubbed)

**What's now LIVE on telemetry boot** (post-deploy):
- Queue worker registers a 7th kind: `project_intake`
- Customer portal instance constructed once at boot (per-worker; same workspace root as queue + cost-tracker)

## Phase 19-B HTTP surface — what shipped (2026-05-18)

**Six endpoints** in `factory-dashboard/server/telemetry.mjs`:

| Method | Path | Auth | Body | Purpose |
|---|---|---|---|---|
| POST | `/api/customer-portal/admin/customers` | none (v0.0.1) | `{email, display_name, tier?}` | Register customer; returns `{account, token}` (token shown ONCE) |
| GET  | `/api/customer-portal/admin/customers` | none (v0.0.1) | — | List all customers (no secrets) |
| POST | `/api/customer-portal/submit` | **Bearer** | `{project_title, intake_payload, tags?, meta?}` | Submit project → `SubmissionReceipt` + **auto-enqueue project_intake job** |
| GET  | `/api/customer-portal/submissions` | **Bearer** | — | List the customer's own submissions |
| GET  | `/api/customer-portal/submissions/:id` | **Bearer** | — | Full status (submission + timeline + SLA) |
| POST | `/api/customer-portal/submissions/:id/cancel` | **Bearer** | `{note?}` | Cancel a non-terminal submission |

**Lazy-loaded shared portal instance**: `getCustomerPortal()` constructs `createCustomerPortal({rootDir: QUEUE_WORKSPACE})` on first call; same instance reused across HTTP routes + the project_intake queue handler. Single source of truth for accounts + submissions + timeline.

**Auth helpers** (`telemetry.mjs`, module-level functions):
- `extractBearerToken(req)` — pulls token from `Authorization: Bearer <token>` (case-insensitive, trimmed)
- `portalErrorToHttp(res, err)` — maps Phase 19-A typed error codes to HTTP status:
  - `UNAUTHORIZED` → 401, `FORBIDDEN` → 403, `NOT_FOUND` → 404, `QUOTA_EXCEEDED` → 429, `VALIDATION` → 400, unknown → 500

**Auto-enqueue behaviour on POST /submit**:
- After `portal.submitProject` succeeds, the route enqueues a `project_intake` job (D224 handler picks it up): `{kind: 'project_intake', project_id: '<CUST-id>_<SUB-id>', payload: {customer_id, submission_id}, priority: 40, max_attempts: 2}`.
- Priority 40 places intake **between** architect cycles (30) and pipeline work (50) — fair share without preempting customer work.
- Auto-enqueue failure is **logged but doesn't reject the submission** — the submission persists in `submitted` state; the founder can manually enqueue from Admin → Queue.

**Why no auth on admin endpoints**: same posture as Phase 14-B's `/api/factory-admin/queue/submit` (D211). v0.0.1 single-VM single-founder; nginx restricts external access; Phase 22 hardening replaces with proper auth.

**Smoke test** — `cognitive-engine/customer-portal/http-integration.smoke.js`:
- **46 assertions** across 8 scenarios using a **real portal + real queue** in a tmp dir (not stubs):
  - `extractBearerToken` (7 header-shape variants including case-insensitive scheme + trimming)
  - `portalErrorToHttp` (5 code mappings + unknown + plain Error)
  - Full register → submit → auto-enqueue chain — verifies queue job has customer-prefixed `project_id`, `{customer_id, submission_id}` payload, priority 40
  - List + status + timeline + SLA shape
  - Cancel + re-cancel-rejected
  - Auth errors (UNAUTHORIZED, VALIDATION) surface portal codes correctly
  - Quota enforcement (free tier max 1 active → 2nd submit hits QUOTA_EXCEEDED → 429)
- All pass; no HTTP server spin-up needed — the auto-enqueue logic is re-implemented in the test (mirrors webhook-integration.smoke.js pattern)

## Phase 19-B back-feed wrapper — what shipped (2026-05-18)

**`cognitive-engine/concurrency/handlers/customer-backfeed-wrapper.js`** (new, ~155 lines):
- `wrapForCustomerBackfeed(originalHandler, { portal, finalKind?, phaseKinds?, onLog? })` — takes any Phase 14-A handler and returns a wrapped handler (`(job, ctx) → result`). Inner handler runs unchanged; result always propagates.
- After successful inner-handler completion, if `job.payload.customer_id` + `job.payload.submission_id` are set, back-feeds the parent customer submission:
  - Job `kind === finalKind` (default `"pre_dev"` for v0.0.1): transition `in_progress → delivered` + record `delivered` timeline event + patch `delivered_by_job_id` onto the submission.
  - Job `kind ∈ phaseKinds` (default `["dev","post_dev"]`): record `phase_completed` timeline event only (no transition; the final transition lands when `finalKind` fires).
  - Anything else (no customer refs, unrecognised kind, already-terminal status): pass-through.
- **Fail-isolated**: a back-feed lookup or transition error does NOT propagate to the queue. Inner-handler result is still returned (queue marks job done); error is logged via `onLog` + `console.warn` so ops can recover the submission manually. Rationale: the customer's downstream work succeeded — failing the queue job over a bookkeeping issue would re-run expensive pre_dev.
- **Terminal-status short-circuit**: if submission is already `delivered` / `rejected` / `cancelled`, skip all back-feed action. Handles retry idempotency + parallel admin actions cleanly.
- Module-level exports: `wrapForCustomerBackfeed`, `DEFAULT_FINAL_KIND` (`"pre_dev"`), `DEFAULT_PHASE_KINDS` (`["dev","post_dev"]`).

**`bootQueueWorker` extension** in `factory-dashboard/server/telemetry.mjs`:
- Lazy-imports `customer-backfeed-wrapper.js` alongside other handler modules (fail-tolerant `.catch(() => null)`)
- Hoists `sharedCustomerPortal` creation up to the top of the registration block so the same instance is reused by both the back-feed wrapper AND the project_intake handler — single portal hook + single source of truth.
- After `registerFactoryHandlers`, retrieves the existing `pre_dev` handler from the registry, wraps it via `wrapForCustomerBackfeed(originalPreDev, { portal: sharedCustomerPortal, onLog })`, and re-registers under the same kind. For non-customer pre_dev jobs (regular factory pipeline), the wrapper is a no-op pass-through.
- New Live Trace log prefix: `[queue:pre_dev:backfeed:<jobId>]`

**Smoke test** — `cognitive-engine/concurrency/handlers/customer-backfeed-wrapper.smoke.js`:
- **78 assertions** across 15 scenarios using stubbed portal + stubbed inner handler:
  - Module exports + defaults (3)
  - Dep validation — 5 invalid-input variants throw (1)
  - Inner handler runs unchanged + result propagates (4)
  - Inner handler throws → propagates, no back-feed attempt (5)
  - Job without customer refs → pass through, portal untouched (4 + 1)
  - finalKind happy path — pre_dev on in_progress → delivered + delivered event (10)
  - Phase kind `dev` on in_progress → phase_completed event only (5)
  - Phase kind `post_dev` on in_progress → phase_completed event only (4)
  - Unrecognised kind (`architect_research`) → no transition, no event, log mentions skip (3)
  - Terminal-status short-circuit — verified for all 3 terminal states: delivered, rejected, cancelled (15)
  - Submission not found → log + pass through (4)
  - Submission lookup throws → fail-isolated; inner result returned (4)
  - transitionSubmission throws → fail-isolated; inner result returned (4)
  - recordTimelineEvent throws on phase kind → fail-isolated (3)
  - Custom finalKind override (`finalKind="post_dev"` makes pre_dev intermediate) (6)
  - Every recorded timeline event uses a valid TIMELINE_EVENT_KINDS entry (D226 guard) (2)
- All pass; stub `recordTimelineEvent` imports `TIMELINE_EVENT_KINDS` and rejects invalid kinds (D226 lesson applied).

**What's now LIVE on telemetry boot** (post-deploy):
- pre_dev handler is wrapped — customer-tagged pre_dev jobs auto-transition their parent submission to `delivered` on completion
- Regular factory pre_dev jobs (no customer refs in payload) are unaffected — wrapper is a no-op for them
- Shared `sharedCustomerPortal` instance used by 3 callers: project_intake handler, pre_dev wrapper, HTTP routes (via the existing `getCustomerPortal()` lazy getter, which constructs its own instance — both point at the same `_customer-portal/` filesystem root, so consistency is filesystem-guaranteed)

## Phase 19-B SLA breach scanner — what shipped (2026-05-18)

**`cognitive-engine/customer-portal/sla-breach-scanner.js`** (new, ~190 lines):
- `createSlaBreachScanner({ portal, intervalMs?, onLog?, now? })` — returns `{ runOnce, start, stop }`.
- On each tick (default 5 minutes), walks `portal.accounts.list()`, filters each customer's submissions to non-terminal, runs `portal.sla.findBreaches(subs, tiersByCustomer)`, and for each breach calls `portal.raiseSLABreach(customerId, submissionId, { note })` — but only if the submission's timeline does NOT already contain an `sla_breached` event (dedup).
- Returns a structured `ScanResult` (`{scanned, submissions_checked, breaches_found, raised, deduped, raised_ids, errors, computed_at}`) — exposed via `runOnce()` for tests + admin debug.
- **Fail-isolated at every level**: errors in `submissions.list`, `timeline.read`, `raiseSLABreach` are captured into `result.errors` and the scan continues. Only `accounts.list` failure is fail-fast (nothing else to scan).
- `start()` uses `setInterval` + `timer.unref()`; the first tick fires after `intervalMs`, not immediately (matches architect cadence daemon).
- `stop()` is idempotent + safe at any time.

**`bootSlaBreachScanner` in `factory-dashboard/server/telemetry.mjs`** (new):
- Lazy-imports the scanner module on `server.listen` boot (alongside `bootCadenceDaemon` + `bootQueueWorker`).
- Reuses the module-level `getCustomerPortal()` lazy getter so the scanner shares the same portal instance with HTTP routes + queue handlers.
- Env vars: `SLA_SCANNER_DISABLED=true` skips boot; `SLA_SCANNER_INTERVAL_MS=<n>` overrides the cadence.
- Stops the scanner FIRST in the graceful-shutdown hook (before MCP disconnect) so the interval doesn't keep the event loop alive past `server.close()`.
- Live Trace log prefix: `🛎️  [sla.scanner]`

**Smoke test** — `cognitive-engine/customer-portal/sla-breach-scanner.smoke.js`:
- **86 assertions** across 16 scenarios using stubbed portal + injectable clock:
  - Dep validation — 5 invalid-input variants throw
  - Empty world → 0 scanned, no errors
  - Single breach happy path → raised: 1
  - Dedup: submission with prior `sla_breached` event → deduped: 1
  - Two-tick idempotency (raise → dedup) — proves D226 lesson applied
  - Terminal-status ignored for all 3 (delivered/rejected/cancelled)
  - on_track + at_risk submissions do not raise
  - Multi-customer mixed states (3 customers × varied statuses → 2 fresh + 1 dedup)
  - Fail-isolation: `submissions.list` throws for one customer → others still scanned + raised
  - Fail-isolation: `timeline.read` throws for one breach → skip + continue with others
  - Fail-isolation: `raiseSLABreach` throws for one submission → continue with others
  - Fail-fast: `accounts.list` throws → scan returns with `errors[0]`, no raises
  - `start()` / `stop()` lifecycle (idempotent both directions)
  - `intervalMs` default (5 min) + invalid handling (0, negative → default)
  - `onLog` hook fires for raised events
- Stub `raiseSLABreach` mirrors real portal by appending to in-memory timeline, so the two-tick test reflects production behaviour.

**What's now LIVE on telemetry boot** (post-deploy):
- Scanner ticks every 5 minutes (configurable) for the entire telemetry lifetime
- Customer-portal timelines accumulate `sla_breached` events as submissions actually breach — exactly once per breach (idempotent across restarts)
- Foundation for 10-B Courier integration: when notifications are wired, they consume the `sla_breached` timeline events from this scanner

## Phase 19-B portal notifier (scanner-first wiring) — what shipped (2026-05-18)

**`cognitive-engine/customer-portal/notifier.js`** (new, ~140 lines):
- `createPortalNotifier({ courier, onLog? })` — returns an object with method `onSlaBreached({ account, submission, note? })` (more methods land per follow-on ships).
- Each method translates portal lifecycle data into a Courier CourierEvent: type = `customer.<event>`, severity per-event (warn for breaches/rejections, info otherwise), title (short human-readable), body (markdown with submission + tier context), meta (`customer_id`, `submission_id`, `tier`, `target_delivery_at`, `submission_status`).
- Internal `dispatchSafely(event, label)` wraps `courier.dispatch` — catches throws, maps `ok:false`, recognises `dropped:true` as not-an-error, normalises return shape to `{ ok, event_id?, channels?, dropped?, error? }`.
- Validates input before dispatch: missing `account.id` / `account.email` / `submission.id` / `submission.target_delivery_at` → `{ok:false, error}` WITHOUT calling courier.
- Fail-isolated: notifier methods never throw — every failure becomes a `{ ok:false }` return that callers can record into telemetry.

**`cognitive-engine/courier/types.js` extended** — 6 new event types in `EVENT_TYPES`:
- `customer.submission_received`, `customer.submission_accepted`, `customer.submission_delivered`, `customer.sla_breached`, `customer.submission_cancelled`, `customer.submission_rejected`
- All routed in `configs/courier-routing.json` to `stdout` channel for v0.0.1 (founder log visibility). Severity-gated where appropriate (`customer.sla_breached` + `customer.submission_rejected` require min_severity=warn).
- Per-customer notification prefs (real email/Slack targets) is a 19-C ship.

**`cognitive-engine/customer-portal/sla-breach-scanner.js` extended**:
- New optional `init.notifier` dep — when present and has `.onSlaBreached`, it's invoked after every successful `raiseSLABreach`.
- New `result.notified` counter — counts notifier calls that returned `ok:true`. Failures (returned `ok:false` OR threw) land in `result.errors` with scope `notifier.onSlaBreached(<customer>/<submission>)`.
- Notifier NOT called on deduped breaches (no re-notify) or raise failures (no event to notify about).
- Backwards-compatible: scanner without `init.notifier` behaves exactly as before; D228 contract preserved.

**`bootSlaBreachScanner` in `telemetry.mjs` extended**:
- Lazy-imports `notifier.js` + `courier/service.js` alongside the scanner module (fail-tolerant `.catch(() => null)`).
- Default `COURIER_BACKEND=fake` — in-memory event history, no external delivery.
- `NOTIFIER_DISABLED=true` env var skips notifier wiring entirely (scanner still emits timeline events).
- Boot log now shows `📨 Portal notifier wired (courier backend=fake)` + scanner status `(notifier=on|off)`.
- Live Trace prefix: `📨 [portal.notifier]`.

**Smoke tests**:
- `notifier.smoke.js` (new, **51 assertions** across 7 scenarios): dep validation, event type registration check, happy path (verifies full CourierEvent shape via real `validateEvent`), input validation (4 missing-field variants), 3 fail-isolation modes (throw / ok:false / dropped), only-onSlaBreached-exported surface guard.
- `sla-breach-scanner.smoke.js` extended (86 → **112 assertions**): 7 new scenarios for notifier integration — notifier-provided + fresh breach, no-notifier backwards-compat, deduped → no notify, notifier ok:false → errors recorded, notifier throws → scan continues, raise failure → no notify, notifier without onSlaBreached method → treated as null.
- D226 stub-strictness: stub `courier.dispatch` calls real `validateEvent` from `courier/types.js` so any malformed notifier event surfaces at test time.

**What's now LIVE on telemetry boot**:
- Notifier is wired; every fresh SLA breach the scanner raises also dispatches a `customer.sla_breached` Courier event (currently to fake backend's in-memory history; observable via `courier.getHistory()`).
- 6 `customer.*` event types are now registered + routable.
- Foundation for D231-D233 (HTTP /submit + cancel + intake + back-feed wiring) is in place; each is a 3-5 line call to the same notifier.

## What stays for full 19-B

- **React customer dashboard** — sign-up, submission form, per-submission status page with timeline + SLA visualizer; consumes the 6 HTTP endpoints above
- **Notifier wiring for the other 3 sources (D231-D233)** — HTTP /submit (`onSubmitted`), HTTP /cancel (`onCancelled`), project_intake handler (`onAccepted`), back-feed wrapper (`onDelivered`), admin reject (`onRejected`). Substrate ready; each is a 1-source ship.
- **Per-customer notification prefs (19-C)** — `account.notification_prefs` schema + notifier reads it before dispatch + per-channel target overrides. Routes `customer.*` events to the customer's real email/Slack instead of founder's stdout.
- **Real Courier backends** (10-B follow-on) — set `COURIER_BACKEND=http` + provide Hermes gateway creds + Slack/email tokens.
- **Budget gate** (11-B follow-on) — pre-flight check against the customer's tier `budget_cap_usd` before enqueueing downstream work
- **Verify linkage** (9-B full) — on a Verify reviewer rejection, route a fix-cycle for the customer's submission
- **Password auth + email verification** — current 19-A/B uses opaque bearer tokens; full 19-B adds the user-friendly login layer on top
- **Admin auth** — current admin endpoints (`/admin/customers`) are open; needs proper auth before any external exposure (Phase 22)

## What shipped

### `cognitive-engine/customer-portal/types.js` (new, ~115 lines)
- `CustomerAccount`, `CustomerTier` (3: free/starter/pro), `ProjectSubmission`, `SubmissionStatus` (6), `TimelineEventKind` (9), `SLAPolicy`, `SLAStatus`, `SubmissionReceipt`
- State machine transition table + `canTransition` guard
- Validators: `isValidTier`, `isValidStatus`, `isValidEventKind`, `isValidSLAStatus`, `isValidEmail`, `isValidCustomerId`, `isValidSubmissionId`, `isTerminal`
- `DEFAULT_TIER_POLICIES` — D170 tier defaults

### `cognitive-engine/customer-portal/accounts.js` (new, ~180 lines)
- `createAccountStore(rootDir)` — returns `{createAccount, authenticate, getById, list, rotateToken, revokeToken, setTier, customerDir}`
- Layout under `_customer-portal/`: `index.jsonl` (public manifest) + `token-index.json` (hash→id) + `customers/<id>/account.json` (full record with `token_hashes[]`)
- Opaque tokens (`cpt_` + 32 random bytes); plaintext surfaced ONCE at creation or rotation; only SHA-256 hashes stored (D168)
- Email uniqueness enforced
- `stripSecrets()` removes `token_hashes` from returned account objects

### `cognitive-engine/customer-portal/submissions.js` (new, ~190 lines)
- `createSubmissionStore(rootDir)` — returns `{create, get, list, countActive, transition, addCost, stats}`
- Per-customer subdir isolation (`customers/<customer_id>/submissions/`); all methods require `customerId` (D167)
- State-machine transitions via `canTransition`; auto-stamps `accepted_at` / `completed_at` at the right transitions
- `addCost` accumulates `consumed_cost_usd` with 6-decimal precision

### `cognitive-engine/customer-portal/timeline.js` (new, ~115 lines)
- `createTimelineStore(rootDir)` — returns `{append, read, latest, countByKind}`
- Per-submission JSONL file (`customers/<id>/timeline/<SUB>.jsonl`)
- 9 event kinds all validated; each event carries `at` + optional `phase`, `note`, `cost_delta_usd`, `computed_eta_at`, `meta`
- Chronological (oldest-first) reads; filter by kind and/or phase

### `cognitive-engine/customer-portal/sla.js` (new, ~130 lines)
- `createSLAEngine({policies?, now?})` — `{getPolicy, computeTargetDelivery, computeStatus, findBreaches, checkQuota, listPolicies}`
- Four SLA status bands: `on_track` (<80% elapsed), `at_risk` (≥80%), `breached` (≥100% non-terminal), `completed` (terminal with `missed_sla` flag)
- Policy override: `createSLAEngine({policies: { free: { sla_hours: 24 } }})` merges with DEFAULT_TIER_POLICIES
- Test-clock injection: `createSLAEngine({now: () => 1234567890})` for deterministic breach tests

### `cognitive-engine/customer-portal/portal.js` (new, ~175 lines)
- `createCustomerPortal({rootDir, sla?})` — composes all 4 stores
- Customer surface (token required): `submitProject`, `getStatus`, `listMyProjects`, `cancelSubmission`
- Platform-internal surface (no token; trusted callers): `recordTimelineEvent`, `transitionSubmission`, `addCost`, `raiseSLABreach`, `rejectSubmission`
- Admin ops surface (no token): `registerCustomer`, `setCustomerTier`, `listCustomers`
- Typed error codes: `UNAUTHORIZED`, `FORBIDDEN`, `QUOTA_EXCEEDED`, `VALIDATION`

### `cognitive-engine/customer-portal/smoke-test.js` (new, ~480 lines)
- **138 assertions across 12 test groups**:
  - types (27) — schema / 3 tiers / 6 statuses / 9 event kinds / 4 SLA statuses / terminals / state-machine transitions / id regex / email regex / tier policy defaults
  - accounts basics (15) — create, auth, list, duplicate email, invalid inputs (email/name/tier)
  - accounts token rotation (10) — additive rotate, revoking rotate, explicit revoke, double-revoke, tier change
  - submissions lifecycle (17) — per-customer ID sequence isolation, cross-customer list blocked, transitions ok, illegal transitions rejected, accepted_at/completed_at stamped, addCost accumulates, stats
  - submissions validation (4) — missing customer_id / invalid customer_id / missing title / negative budget
  - timeline (11) — 5 events appended + chronological order + kind filter + phase filter + latest + countByKind + bogus kind rejected + isolation
  - sla engine (17) — 4 status bands verified against mock clock; findBreaches; checkQuota at 3 tiers; policy override merge
  - portal lifecycle (12) — register → submit → transition chain → delivered → timeline has 5 events → sla completed
  - portal auth enforcement (4) — null/bogus token → UNAUTHORIZED; cross-customer access → FORBIDDEN
  - portal quota enforcement (4) — free tier blocks 2nd submission; after delivery quota frees up
  - portal cancel + reject (7) — submitted/accepted cancellable; in_progress → VALIDATION; admin reject any non-terminal; nonexistent → FORBIDDEN
  - portal SLA breach (3) — clock advance → breached status; raiseSLABreach appends sla_breached event

### `cognitive-engine/customer-portal/README.md` (new)
- Status, layout diagram with per-customer dirs, tier table, state-machine diagram, event kinds table, API examples (platform + customer + platform-internal), error code table, smoke summary, decisions, 19-B/C preview

### `cognitive-engine/admin-substrate/registry.js` (modified)
- Added `USE_CUSTOMER_PORTAL` feature flag (13 total now)
- Admin smoke test updated (12 → 13) — 41 assertions still pass

### Unchanged
- Graph files, `tools.js`, `telemetry.mjs`
- All prior A-tier modules: marketplace (18-A), training-videos (17-A), training-gen (16-A), self-improvement (15-A), concurrency (14-A), replay (13-A), admin-substrate core (12-A), cost-tracker (11-A), courier (10-A), verify-integration (9-A), parallel (8-A), memory-layer (7-A), artifacts (6-A), mcp (5-A)
- Zero regression risk

## Smoke test highlight

```
[portal — SLA breach detection + event]
  ✓ at 80h elapsed, status=breached
  ✓ 1 sla_breached event recorded
  ✓ breach note captured

[portal — auth enforcement]
  ✓ null token → UNAUTHORIZED
  ✓ invalid token → UNAUTHORIZED
  ✓ Bob cannot see Alice's SUB-0001 (got FORBIDDEN)
  ✓ cancel with bad token → UNAUTHORIZED

[smoke] OK  — 138 assertions
```

## Why 19-B deferred

19-B = **customer-visible surface + production wiring**. Requires:
- **HTTP API** (Fastify/Express routes; token middleware; CORS + rate limiting)
- **React customer UI** (submission form, dashboard, status page with timeline, account settings)
- **Phase 14-A queue handler** — `register("project_intake", ...)` that drives `submitted → accepted → in_progress` via pre_dev → dev → post_dev
- **Phase 10-A Courier integration** — customer notifications on every major transition
- **Phase 11-A budget gate** — pre-flight cost estimate; hard-cap enforcement
- **Phase 9-A Verify linkage** — customer review account paired with portal account
- **SLA breach scanner** — cron/interval invoking `sla.findBreaches()` and emitting events
- **Password-based auth** — argon2id hashing; email verification flow

Ship 19-A as the firm substrate; 19-B layers the HTTP/UI on a tested contract.

## Feature-flag posture

| Flag | Default | Effect |
|---|---|---|
| (existing 12 flags ...) | off | Phases 4-18 |
| `USE_CUSTOMER_PORTAL` | off | Phase 19-B onwards: HTTP + UI + queue handler + Courier + budget gate active; 19-A library only |

## Phase 19-A exit criteria — met

- ✅ `customer-portal/` scaffolded (types, accounts, submissions, timeline, sla, portal, smoke-test, README)
- ✅ Seven sub-modules compose cleanly via `portal.js` high-level API
- ✅ Three tiers (free/starter/pro) with SLA + budget + quota policies per D170
- ✅ SLA ETA calculator produces sane estimates from submission + tier
- ✅ SLA breach detector flags past-target non-terminal submissions
- ✅ Per-customer quota enforcement rejects new submissions at `max_active_submissions`
- ✅ Token auth: opaque bearer tokens, SHA-256-hashed at rest, revokable
- ✅ Timeline append-only; 9 event kinds; isolation across customers verified
- ✅ Cancel path: `submitted` / `accepted` customer-cancellable; `in_progress` → VALIDATION
- ✅ **138 smoke-test assertions all pass**
- ✅ Admin-substrate smoke still green at 41 assertions after flag add
- ✅ `USE_CUSTOMER_PORTAL` flag registered with correct owning phase
- ✅ No changes to graph files, other A-tier modules, or admin substrate core
- ✅ Phase docs: Plan (expanded), Status, Decisions (D166-D172), Lessons
- ⏳ 19-B HTTP + UI + queue handler + notifications + budget gate + SLA scanner + password auth deferred

Phase 19-A is **wired, tested, and ready**. Substrate is firm — 19-B brings the customer-visible surface.
