# Phase 19 — Decisions Log

## D166 — Customer portal is its own substrate, not a wrapper over Genovi

**What**: The portal owns a full lifecycle: accounts, submissions, timeline, SLA, cancel, reject. Genovi (Phase 3 intake agent) is one downstream consumer — when a submission enters `in_progress`, the queue handler (19-B) invokes Genovi with the submission's `intake_payload` as a step in pre_dev.

**Why**:
- **Project-tracking concerns differ from intake concerns.** Genovi converts prose to structured requirements. The portal tracks SLA, budget, and customer-facing status across the entire factory run — that's a larger lifecycle.
- **Multi-tenant separation needs its own primitive.** Customers, tiers, and per-tenant isolation are cross-cutting; wiring them into Genovi would make Genovi multi-tenant too, which conflates responsibilities.
- **Portal works even without Genovi.** A customer can submit, cancel, track status, and see timeline events even if the intake agent isn't ready. Genovi becomes live in 19-B when the queue handler wires it.
- **Genovi is swappable.** With Phase 18-A marketplace, different projects could use different intake agents (Genovi vs. a future specialised intake). Portal doesn't care which.

**Tradeoff**: slight redundancy — both Genovi and portal handle the "initial intake" concept. Acceptable; they operate at different layers (portal = submission envelope; Genovi = requirement extraction).

## D167 — Per-customer sandbox directories; file paths ARE access control

**What**: Every customer gets `_customer-portal/customers/<customer_id>/` with their own `submissions/` and `timeline/` subdirs. All store methods require `customerId` as a mandatory argument; there is no global "get submission by id" that spans customers.

**Why**:
- **Cross-tenant data access is impossible by construction.** Without `customerId`, there's no path to read another customer's submissions. No ACL evaluation needed — path resolution IS the ACL.
- **Matches existing A-tier storage convention.** Phase 14-A `_jobs/work/<JOB>/`, Phase 16-A `_training/<project>/`, Phase 17-A `_videos/<project>/<VID>/` — every A-tier uses per-item directories. Portal is the same.
- **Debuggable with `ls`.** Ops can audit one customer's submissions by listing one directory. No database query needed.
- **Cheap deletion.** `rm -rf customers/CUST-0042/` fully deletes a customer. Used for GDPR / account-deletion flows in 19-B.
- **Per-tenant backup is trivial.** Tar one directory → one customer's full state.

**Tradeoff**: cross-customer queries (e.g., "all at_risk submissions across tenants" for admin dashboards) require scanning customer dirs. `sla.findBreaches(submissions, tiersByCustomer)` accepts a pre-flattened list — admin code walks the dirs once; engine doesn't need cross-customer knowledge.

## D168 — Opaque bearer tokens, SHA-256-hashed at rest

**What**: Tokens are 32-random-byte strings prefixed with `cpt_` (64 hex chars, ~128 bits entropy). Plaintext surfaced **once** at account creation or rotation; only SHA-256 hashes stored in `account.json::token_hashes[]` + a `token-index.json` lookup (hash → customer_id). Password auth is 19-B territory.

**Why**:
- **No hashing library dependency in 19-A.** Passwords need bcrypt/argon2id (native addons, ~20MB install). Tokens need SHA-256 (in `crypto` built-in). A-tier discipline = no new deps.
- **Token authentication is O(1).** Lookup `token-index.json`, find hash, load account. No linear scan of accounts.
- **Revocation granularity.** Each account holds N tokens; revoke one (keeps others) or revoke all. UI for managing API tokens (like GitHub personal access tokens) is natural.
- **Leak surface is small.** Token leak via log / chat = one account compromised. Hashed at rest means leaking the account.json also doesn't give attackers the live token.
- **Matches the factory's existing token style.** Phase 2.5 Key Console uses similar opaque-token + hashed-at-rest pattern for provider credentials.

**Tradeoff**: no password reset flow (no passwords), no email verification (no delivery infra). Both arrive in 19-B with real email + argon2id. For v0.0.1 this is fine — customers are invited by admins, tokens handed over out-of-band.

## D169 — SLA policies live in a Phase 12-A config (`customer_tiers`); engine reads overrides

**What**: `createSLAEngine({policies?})` accepts a partial `Record<tier, SLAPolicy>` that merges with `DEFAULT_TIER_POLICIES`. 19-B registers a `customer_tiers` config entry in Phase 12-A's registry; admin UI (12-B) edits it; on change, the engine is re-created with new policies.

**Why**:
- **Matches the factory's configurability-first principle (P1).** Tier economics are a business decision — tuning quotas and SLAs shouldn't need a deploy.
- **Test-clock + policy override are the two knobs tests need.** The smoke test uses both (mock clock + custom free-tier sla_hours) to verify the engine. Production leaves them at defaults.
- **Isolation from the store.** Store methods take tier as an argument — the engine computes policy at the point of use. Changing policy doesn't require migrating existing submissions; a pre-existing submission's `target_delivery_at` is immutable (snapshotted at submission time).
- **Admin UI convention parity.** Same pattern as `cost_thresholds` (Phase 11-A), `courier_routing` (Phase 10-A), etc. — config registered in 12-A; UI ships in 12-B.

**Tradeoff**: changing a tier's SLA mid-flight doesn't retroactively shift existing submissions' deadlines (their `target_delivery_at` is frozen). This is correct behavior — customers shouldn't have their deadlines moved around — but it needs documenting when the admin UI lands in 12-B.

## D170 — Three tiers only in 19-A: free / starter / pro; Enterprise deferred to 19-C

**What**: Tiers are baked into the `CustomerTier` enum as `"free" | "starter" | "pro"`. Adding a 4th tier requires editing the enum + config + admin UI.

**Why**:
- **Three tiers prove the tiering primitive.** Enterprise tier needs features that don't exist yet: custom SLA policies per customer, dedicated support channels, white-glove intake, SSO. Those are 19-C scope.
- **Enum vs. free-form string.** Keeping `CustomerTier` as a typed enum catches typos at validation time. Trading enum-rigidity for validation safety is the right choice at R&D scale.
- **Pricing tiers change.** The three tiers we ship are rough guesses (free @ \$10/project, pro @ \$1000/project). Real pricing comes from R1 ops data. D169's config override lets values change; the tier shape (three tiers) is the code-level contract.

**Tradeoff**: admin can't yet create a custom "enterprise" customer with per-customer overrides. 19-C will add either (a) Enterprise tier enum entry or (b) per-customer policy overrides in addition to tier defaults. Both are additive changes.

## D171 — Timeline is append-only JSONL per submission; 9 event kinds covering the full lifecycle

**What**: `customers/<id>/timeline/<SUB>.jsonl` is the event log. 9 kinds: `submitted`, `accepted`, `phase_started`, `phase_completed`, `sla_breached`, `delivered`, `cancelled`, `rejected`, `note`. Each event carries `at` + optional `phase`, `note`, `cost_delta_usd`, `computed_eta_at`, `meta`.

**Why**:
- **Immutable audit trail.** Timeline is the source of truth for "what happened with this submission" — invoices, SLA breach reports, and dispute resolution all read from it.
- **Customer-visible UI is a direct render of the timeline.** React status page walks events in order; no transformation needed.
- **`note` is the escape hatch.** Free-form notes cover admin-customer support conversations, annotations, manual workflow triggers. Keeps the enum closed without blocking useful communication.
- **`computed_eta_at` enables ETA drift visualisation.** Each event can carry the engine's ETA snapshot at that moment. 19-B dashboards show "ETA was X at submission, Y after accepted, Z after pre_dev completed" — makes SLA behavior transparent.
- **Matches factory-wide JSONL audit convention.** Every Phase 5-A through 18-A module uses JSONL for audit-ish data. Portal follows.

**Tradeoff**: no complex queries across timelines without scanning. Admin code that wants "show me all sla_breached events across all customers" walks all customer dirs and unions their JSONL. Acceptable at R&D scale; B-tier can add a denormalised events table in Postgres if needed.

## D172 — Zero LLM calls in 19-A

**What**: The portal never calls an LLM. `raiseSLABreach` takes a `note` argument; it doesn't generate one. `rejectSubmission` takes a `reason`; no LLM summary. 19-B wires LLM-using paths through Genovi (intake) and Courier (notification templates) — but always behind the same portal API.

**Why**:
- **A-tier discipline (D165 precedent from Phase 18-A).** Every scaffold module must run offline, deterministic, \$0. Portal is no exception.
- **Smoke tests deterministic.** 138 assertions all pass in < 200ms offline. Enables future regression testing without credentials.
- **Portal is the control plane.** LLM calls live in the data plane (Genovi, training-gen, etc.). Mixing them complicates rollback — portal state (accounts, submissions, timeline) should always be consistent even if downstream LLM calls fail.
- **Clear 19-A / 19-B boundary.** 19-B adds HTTP routes + external integrations; 19-C might add LLM-generated status summaries or customer chat. Keeping 19-A zero-LLM makes the tier-boundary explicit.

**Tradeoff**: customer-facing status text is blunt ("submission received", "pre_dev phase started") instead of friendly ("Got your project! We're designing the blueprint now 🏗️"). 19-B's notification layer (Phase 10-A Courier templates) handles tone.

## D224 — 19-B Tier B: project_intake as its own handler module; transitions split if downstream enqueue fails (added 2026-05-18)

**What**: Phase 19-B Tier B registers `project_intake` as a Phase 14-A queue kind via a dedicated module (`cognitive-engine/concurrency/handlers/project-intake-handler.js`). The handler walks a submission through `submitted → accepted` BEFORE enqueueing downstream work, then `accepted → in_progress` AFTER the downstream enqueue succeeds. If the downstream enqueue fails, the submission stays in `accepted` (NOT advanced to `in_progress`), and an `error` event is appended to the timeline.

**Why a separate handler module** (mirrors D211 / D217 / D219 / D220):
- Customer-portal is a distinct domain. Mixing project_intake into factory-handlers.js would leak customer-state-machine semantics into the pipeline-graph file.
- Test ergonomics: 38 assertions stub the portal + queue cleanly; no filesystem touched.
- Phase 19-B full's back-feed (`pre_dev` done → submission `delivered`) will land in its own handler too, not by mutating this one.

**Why split the two transitions around the enqueue**:
- If we did both transitions BEFORE enqueueing, a downstream enqueue failure would leave the submission in `in_progress` with no actual downstream work happening. Customer sees "in progress" forever; founder has to manually fish it out.
- If we did both transitions AFTER enqueueing, the customer sees no progress signal until after the downstream work is queued — fine for happy path, but defeats the purpose of having an `accepted` state.
- Splitting around enqueue gives the right semantics: `accepted` is the durable acknowledgment ("we got it, we're working on it"); `in_progress` is the commitment ("pipeline work is scheduled"). If the second commitment fails, the first stays valid and recoverable.

**Why the timeline gets an `error` event on enqueue failure** (not just the job-level error):
- The portal's customer-facing API reads the timeline. Customer-visible state should reflect what they'd see in a status page. A queue-internal job error is invisible to them; a timeline error is the right surface.
- Founder can scan timeline events to find submissions that need re-firing.

**Why customer-prefixed `project_id` on downstream pre_dev**:
- Format: `<CUST-NNNN>_<SUB-NNNN>`. This makes Phase 11-A cost-tracker rollups and Phase 14-B per-project quota gates work per-customer-submission naturally.
- Adding `customer:CUST-NNNN` thresholds in `configs/cost-thresholds.json` will cap a customer's total spend across all their submissions.
- The `_` separator (not `:` or `/`) keeps the project_id filesystem-safe (per the 14-A `project_id` regex requirement).

**Tradeoff acknowledged**: the back-feed (pre_dev success → submission `delivered`) doesn't exist yet. Today, after the handler runs, the submission sits in `in_progress` until the founder (or full-19-B's back-feed handler) explicitly transitions it. Acceptable: substrate-now, behaviour-completion-later, same posture as D211 / D217 / D219 / D220.

## D225 — 19-B HTTP surface: lazy shared portal + auto-enqueue project_intake on submit + no-auth admin (R&D posture) (added 2026-05-18)

**What**: Phase 19-B HTTP surface adds 6 endpoints under `/api/customer-portal/*` in `factory-dashboard/server/telemetry.mjs`:
- 2 admin (no auth in v0.0.1, same posture as the queue submit endpoint)
- 4 customer-facing (Bearer-token auth via the Phase 19-A account store)

Three substantive design decisions captured here, beyond "just wire portal methods to URLs":

**Why a lazy shared portal instance** (`getCustomerPortal()`):
- Both the HTTP routes AND the queue worker (D224's `project_intake` handler) need a portal instance. Two instances would risk write-write races against the same `_customer-portal/` filesystem store.
- Lazy init on first call avoids forcing a module-load-time dependency on the customer-portal module (matches the rest of telemetry.mjs's lazy-import discipline — see D211 / D217 / D219 / D220 / D223 / D224).
- Memoized in `_customerPortalInstance` after first construction; cleared on telemetry restart (acceptable — `_customer-portal/` is durable on disk).

**Why auto-enqueue `project_intake` on successful POST /submit**:
- Without auto-enqueue, the submission would land in `submitted` state and just sit there until the founder manually enqueued from Admin → Queue. That defeats the point of having a customer portal — customers expect submissions to be acted on without operator intervention.
- Failure-isolated: if the auto-enqueue throws (queue unavailable, FS error), the submission persists (the customer's request isn't dropped) and the error is logged for the founder to recover. Better than rejecting a paid submission because of an internal queue hiccup.
- Priority 40 chosen deliberately: between architect cycles (30) and pipeline work (50). Customer intake gets higher priority than background research, lower than active pipeline progress — fair share without preempting.

**Why typed error codes (UNAUTHORIZED / FORBIDDEN / NOT_FOUND / QUOTA_EXCEEDED / VALIDATION) → HTTP status mapping in a single helper**:
- Phase 19-A's portal.js already throws errors with `.code` fields. Per D167 ("typed auth errors"), the codes are the contract; HTTP layer just maps them.
- `portalErrorToHttp(res, err)` collapses 5 error categories to 4 HTTP status codes (UNAUTHORIZED+FORBIDDEN+NOT_FOUND+QUOTA+VALIDATION → 401/403/404/429/400). Unknown codes fall to 500.
- Keeps HTTP route bodies simple: every try/catch ends with `return portalErrorToHttp(res, err)` — no per-route status logic.

**Why admin endpoints have no auth in v0.0.1**:
- Same posture as Phase 14-B's queue submit endpoint (D211 implicit). v0.0.1 single-VM single-founder; nginx restricts external access; only the founder can hit `/api/factory-admin/*` and `/api/customer-portal/admin/*`.
- Phase 22 (Action Boundary Enforcement, v2→v3) replaces with proper admin-token auth + role checks.
- Tradeoff acknowledged: external pen-test pre-v3 must include this surface.

**Why no React UI yet**: full 19-B is multi-session. The HTTP surface lets the founder + integration tests + any external client (curl) exercise the substrate today, and decouples backend completion from frontend completion. The React UI is the natural next visible-factory ship once the substrate has accumulated real customer submissions to render.

## D226 — 19-B handler hotfix: idempotency guard + valid event kinds + strict smoke (added 2026-05-18)

**What**: A live HTTP integration test (founder ran `curl -X POST /api/customer-portal/submit` after merging D225 / PR #67) exposed two real bugs in the project_intake handler:

1. **Invalid timeline event kind**: handler used `kind: "phase_change"` and `kind: "error"` — neither is in Phase 19-A's `TIMELINE_EVENT_KINDS` enum (`submitted, accepted, phase_started, phase_completed, sla_breached, delivered, cancelled, rejected, note`). The portal's `recordTimelineEvent` validates kind + throws. First attempt failed at the final timeline event (after all transitions + downstream enqueue had succeeded).

2. **Not idempotent on retry**: when attempt 1 succeeded partway (advanced submission to `in_progress` + enqueued downstream pre_dev) then died, attempt 2 fired and tried `submitted → accepted` again — which the state machine rejected (`illegal transition in_progress → accepted`). Job hit max_attempts, landed in `failed/`. Downstream pre_dev STILL ran fine (it was already enqueued by attempt 1), so the submission was actually progressing — but the project_intake job log showed permanent failure.

**Fix** (this hotfix):
- Replace `kind: "phase_change"` → `"phase_started"`; replace `kind: "error"` → `"note"`.
- Add an **idempotency guard** at the top of the handler:
  - If `submission.status === "in_progress"` AND `submission.downstream_pre_dev_job_id` is set → short-circuit; return the prior result tagged `idempotent_replay: true`.
  - If `submission.status === "accepted"` (prior attempt died mid-way) → skip the first transition + accepted-event but do everything from the downstream enqueue onward. Resume semantics.
  - Other non-`submitted` states (rejected/cancelled/delivered) fall through and let the state machine throw — those are intentional terminal states, not transient failures.

**Tighten smoke test** (this hotfix):
- Import `TIMELINE_EVENT_KINDS` from `customer-portal/types.js` and make the stub `recordTimelineEvent` validate event kind. **This would have caught the original bug** — it wasn't caught because the stub was permissive.
- Add 2 new test groups (12 assertions) for idempotency:
  - Already in_progress with downstream → 0 transitions, 0 events, 0 enqueues, returns `idempotent_replay: true`
  - Already accepted (prior partial attempt) → skip submitted→accepted, do everything else, reach in_progress
- Smoke now 50 assertions (was 38).

**Lesson captured**:
- Stubs MUST enforce the same validation as production code, or live integration becomes the first place bugs surface. Specifically: any enum / state-machine / kind validation that the real implementation does, the stub must do too.
- Handler idempotency is a queue-substrate requirement, not a nice-to-have. Phase 14-A's lease-then-fail-then-retry semantics means EVERY handler must tolerate "I've run partway before; the state reflects that; what do I do?"

**Pattern to extend**: the other 6 handlers (factory pre_dev/dev/post_dev, architect_research, training_gen, training_video_render) should be audited for the same retry-idempotency property. They're mostly safe by accident (spawning a subprocess is mostly idempotent; LLM calls are stateless), but the rule is now explicit: handlers MUST be safe to re-fire from any partial-completion state. Future handlers should structure work as `(check current state) → (advance from there)`, not `(assume initial state) → (advance through fixed sequence)`.

## D227 — Back-feed wrapper closes the customer lifecycle without touching pipeline handlers (added 2026-05-18)

**What**: A new module `cognitive-engine/concurrency/handlers/customer-backfeed-wrapper.js` exports `wrapForCustomerBackfeed(originalHandler, deps)`. It takes any Phase 14-A handler (signature `(job, ctx) → result`) and returns a wrapped handler that runs the inner handler unchanged, then — if the job's payload carries `customer_id` + `submission_id` — back-feeds the parent customer submission state:

- For `finalKind` (default `"pre_dev"` for v0.0.1): transitions submission `in_progress → delivered` + records a `delivered` timeline event + patches `delivered_by_job_id` onto the submission.
- For `phaseKinds` (default `["dev","post_dev"]`): records a `phase_completed` timeline event only, no transition (the final transition lands when `finalKind` fires).
- Anything else (no customer refs, unrecognised kind, already-terminal status): pass-through, no portal action.

Telemetry wires it in `bootQueueWorker`: after `registerFactoryHandlers`, it retrieves the existing `pre_dev` handler from the registry, wraps it, and re-registers under the same kind. A shared `sharedCustomerPortal` instance is now created once at the top of the registration block (hoisted up from inside the project_intake block) and reused by both the wrapper and the intake handler — keeps a single portal hook + simplifies future ops.

**Why a wrapper instead of editing `factory-handlers.js`**:
- `factory-handlers.js` belongs to the **pipeline-graph domain** (D211). Mixing customer-portal state-machine knowledge into it would couple two unrelated subsystems. The wrapper composes them externally so neither domain leaks into the other — same separation principle as D224 (project_intake as its own module).
- A separate module is independently testable (in this ship: 78-assertion smoke with stubbed portal — no filesystem, no real handlers).
- Future-proof: when `dev` and `post_dev` get customer refs threaded through (next phase), the same wrapper can wrap them too — change the registration to `wrapForCustomerBackfeed(originalDev, { ..., phaseKinds: ["dev"], finalKind: "post_dev" })` and so on. No code change in the wrapper itself.

**Why `finalKind = "pre_dev"` for v0.0.1 (not `"post_dev"`)**:
- The v0.0.1 customer flow currently stops at pre_dev. `project_intake` (D224) enqueues only a single downstream pre_dev job, not the full pre_dev → dev → post_dev chain. So for v0.0.1, **a customer submission is "delivered" when pre_dev completes**.
- When the full chain gets wired in a later phase, change `finalKind` to `"post_dev"` at registration time + add `phaseKinds: ["dev"]` (or use the defaults). The wrapper code doesn't change.
- This keeps the wrapper config a deployment-time concern, not a code-time one. Solo-founder v0.0.1 ergonomics.

**Why fail-isolated back-feed (transition error doesn't propagate to queue)**:
- The customer's downstream work succeeded (pre_dev produced artifacts). Failing the QUEUE job because of a back-feed bookkeeping issue would:
  1. Put the job in `failed/` even though the actual work succeeded.
  2. Trigger a retry that re-runs the expensive pre_dev (LLM tokens, time).
  3. Either succeed on retry (after the bookkeeping issue self-resolves) or hit max_attempts and be permanently `failed/` despite the work having succeeded.
- All three outcomes are wasteful. Better: the inner handler's result is always returned (queue marks job done), the back-feed error is logged via `onLog` + `console.warn` so ops can recover the submission manually.
- The lesson here is "bookkeeping failures shouldn't fail the work they're bookkeeping for" — same shape as D211's choice not to fail a graph run when telemetry write fails.

**Why the idempotent terminal-status short-circuit**:
- D226 idempotency lesson applied: if the same wrapped pre_dev job retries (e.g., transient FS error after the back-feed already fired), the second attempt sees the submission in `delivered` state. We must NOT attempt `delivered → delivered` (would throw `illegal transition`). Short-circuit instead.
- Also handles parallel admin actions: if the founder manually `rejected` or `cancelled` a submission while pre_dev was running, we don't override their decision.
- `TERMINAL = new Set(["delivered", "rejected", "cancelled"])` — the canonical terminal set from `customer-portal/types.js`.

**Why duplicate timeline events are tolerated, but duplicate state transitions aren't**:
- Timeline is append-only JSONL with `at` timestamps. A duplicate `delivered` event is harmless (and even useful for forensics — "back-feed retried at T1 and T2"). No dedupe needed.
- Submission state transitions are strict — the state machine in `submissions.js` refuses illegal moves. Dedupe via the terminal-status check, not via event-log scanning.

**Why a fresh smoke (not stub-reuse from project_intake)**:
- The wrapper is a different shape from the intake handler — it composes another handler, not just stubs. The smoke needs to verify (1) inner handler always runs, (2) inner result always propagates, (3) inner errors propagate (no back-feed attempt), (4) back-feed runs only when customer refs are present, (5) back-feed errors do NOT propagate. That's its own contract.
- 78 assertions covering: module exports + defaults, dep validation, inner-handler-always-runs, inner-error-propagates, no-customer-refs pass-through, partial-customer-refs (only customer_id) pass-through, finalKind happy path, both phase-kind variants (dev / post_dev), unrecognised kind, terminal short-circuit (all 3 terminal states), missing submission, lookup throw, transition throw, timeline-record throw, custom finalKind override.
- D226 stub-validation lesson applied: the stub `recordTimelineEvent` imports `TIMELINE_EVENT_KINDS` and rejects invalid kinds — would catch any future regression where the wrapper drifts to an invalid event kind.

**Tradeoff acknowledged**: the wrapper config is per-handler (pre_dev gets one wrapper, dev would get another). If we wanted, we could wrap all 3 pipeline kinds in one go via a tiny helper. Not worth it for v0.0.1 — explicit per-kind registration reads cleaner and matches the existing per-handler pattern in `bootQueueWorker`.

## D228 — SLA breach scanner is a periodic background daemon, not an on-demand path (added 2026-05-18)

**What**: A new module `cognitive-engine/customer-portal/sla-breach-scanner.js` exports `createSlaBreachScanner({ portal, intervalMs?, onLog? })` returning `{ runOnce, start, stop }`. On each tick (default 5 minutes), the scanner walks every customer's non-terminal submissions and emits an `sla_breached` timeline event via `portal.raiseSLABreach()` for any submission whose `target_delivery_at` is in the past. Idempotency: before emitting, the scanner reads the submission's timeline and skips if a prior `sla_breached` event already exists.

Telemetry wires it in a new `bootSlaBreachScanner()` invoked from `server.listen`, alongside `bootCadenceDaemon` and `bootQueueWorker`. Stops cleanly in the graceful-shutdown hook (before MCP disconnect, since the interval would otherwise keep the event loop alive past `server.close()`). Env vars: `SLA_SCANNER_DISABLED=true` opts out, `SLA_SCANNER_INTERVAL_MS=<n>` overrides the cadence.

**Why a background daemon (not on-demand)**:
- SLA breaches are **time-driven**, not event-driven. Nothing in the pipeline naturally fires when a submission "ages past target" — the only signal is wall-clock time advancing past a precomputed ISO timestamp. So either we scan periodically, or we schedule a per-submission timer indexed by `target_delivery_at` (the v1+ shape).
- The GET /submissions/:id route already returns a fresh `sla_status` computed on-the-fly, so on-demand breach detection works for **reads**. But **push notifications** (10-B Courier follow-on: email/Slack the customer when their SLA misses) need a *trigger* — a one-shot event per actual breach. That's the scanner's job.
- The HTTP path is cheap; the notification path is expensive (rate-limited SMTP, third-party APIs). Doing the trigger here keeps the read-path latency stable.

**Why per-tick scan (not per-submission setTimeout)**:
- O(N customers + M submissions) per tick. For v0.0.1 scale (single founder, <100 submissions) this is trivial — even 1000 submissions × 5-minute cadence is well under a second of work per tick.
- Per-submission `setTimeout` indexed by `target_delivery_at` would be more elegant at scale, but adds complexity: scheduling on submission create, rescheduling on transition, cleanup on terminal state, recovery after restart. None of that is worth it before the scan cost actually shows up.
- Idempotency keeps the scanner restart-safe at any cadence: dedup is filesystem-durable (timeline scan), not in-memory state. A telemetry restart between scans does NOT re-fire breaches.

**Why dedup via timeline read (not in-memory raised-set)**:
- The simplest correct answer: the timeline IS the truth of "has this breach been notified?" Anything we cache in memory is a lossy duplicate of that.
- One extra `timeline.read` per breached submission per tick is negligible for v0.0.1. When scan cost actually shows up, we'll cache a per-process "already-notified" set keyed by submission_id, refreshed on boot from disk. Not yet.
- Bonus: if an admin manually appends an `sla_breached` event via some other path (debug tool, manual fix), the scanner respects it. There's no second source of truth to drift.

**Why fail-isolation at every level**:
- One bad customer (corrupted submission file, tier set to an unknown value) must not halt the scan for everyone else. Each customer's `submissions.list` is wrapped in try/catch; errors counted into `result.errors`, scan continues.
- One bad submission (timeline read or raiseSLABreach throws) must not halt the rest of that customer's breaches. Same per-emit try/catch.
- Only `accounts.list` failure is fail-fast: if we can't enumerate customers, there's nothing else to scan, so we return with `errors[0]={ scope: "accounts.list", error }` and skip the rest.
- Rationale: the scanner is a notification trigger. A single missed notification on retry is better than dropping all notifications because one customer's data is malformed.

**Why opt-out env var, not opt-in feature flag**:
- For v0.0.1, the scanner is part of the customer-portal substrate — if you're running the portal, you want the scanner. Opt-in would mean every fresh install has to enable a flag to get the expected behaviour.
- Opt-out (`SLA_SCANNER_DISABLED=true`) covers the cases we care about: tests + local dev where there's no customer-portal data, and operators who want to run the scanner via a separate cron/script instead of inside telemetry.
- Matches the architect cadence daemon's posture (always on; configurable via env).

**Why stop the scanner FIRST in the graceful-shutdown hook**:
- `setInterval` keeps the event loop alive. If we let `server.close()` finish first, the process would hang for up to `intervalMs` waiting for the timer to fire one more time, breaking the systemd `TimeoutStopSec` budget.
- We use `timer.unref()` as a safety net (so the process can exit even if `stop()` is missed), but the explicit stop is cleaner and the unref alone wouldn't be enough if shutdown were waiting on `server.close()` for in-flight requests.

**Why a new module rather than extending `sla.js`**:
- `sla.js` is a pure computation engine (in/out, no I/O). Adding the daemon there would bring storage + timeline I/O + setInterval into a module whose unit tests currently need no fixtures.
- The scanner composes the SLA engine + the portal — that's a different layer. Same separation as D211 (factory-handlers.js stays pure; the queue wires it up at boot).

**Test coverage** (86 assertions across 16 scenarios):
- Dep validation; empty world; single breach happy path; dedup on prior event; two-tick idempotency (raise → dedup); terminal statuses ignored for all three terminal states; on_track / at_risk do not raise; multi-customer mixed states with correct counts; submissions.list failure isolated; timeline.read failure isolated; raiseSLABreach failure isolated; accounts.list fail-fast; start/stop lifecycle; intervalMs default + invalid handling; onLog hook fires.
- D226 stub-validation guard applied: the stub `raiseSLABreach` mirrors the real portal by appending the event back into the in-memory timeline, so the two-tick idempotency test reflects what production does.

**Tradeoff acknowledged**: at the scale where per-tick scan cost shows up (~10k+ active submissions, or sub-minute SLAs), the per-submission timer indexed by `target_delivery_at` becomes worth the complexity. v1+ work. For v0.0.1 the per-tick scan is dramatically simpler and the cost is invisible.

## D229 — Scanner hotfix: inject customer_id into index entries (added 2026-05-18)

**What**: Live integration verification of D228 against the real portal API surfaced a bug: the scanner detected 0 breaches even when a submission was demonstrably past `target_delivery_at` (verified via direct `portal.sla.computeStatus()` call). Root cause: `submissions.list(customerId)` returns *index* entries (not full submission records), and the index entries omit `customer_id` by design — the per-customer subdirectory (`_customer-portal/customers/<CUST-id>/submissions/`) makes the customer_id implicit in the file path, so storing it again in the index would be redundant. But `sla.findBreaches(subs, tiersByCustomer)` reads `sub.customer_id` to look up the tier; with `customer_id === undefined`, every submission failed the `if (!tier) continue` guard, so breaches were always 0.

**Fix** (one-line scanner change):
```js
activeSubs = all
  .filter(s => s.status !== "delivered" && s.status !== "rejected" && s.status !== "cancelled")
  .map(s => ({ ...s, customer_id: customer.id }));   // ← inject from iteration scope
```

The customer_id is already in scope (we're iterating per-customer), so injecting it onto each submission is free.

**Tighten smoke stub** (D226 lesson re-applied):
- The stub `submissions.list` previously included `customer_id: customerId` in each entry — permissive, didn't mirror production.
- The smoke now omits `customer_id` from `submissions.list` output. **This would have caught the bug**: without the scanner's injection, the breach test cases would all report `breaches_found: 0` and the smoke would fail.
- All 86 assertions still pass post-fix (proves the scanner's customer_id injection works against a production-mirroring stub).

**Why this kept happening (D226 + D229 = same shape)**:
- D226 (project_intake handler): stub `recordTimelineEvent` was permissive on event kind → live test caught invalid `phase_change` / `error` kinds. Fix: stub validates against `TIMELINE_EVENT_KINDS`.
- D229 (sla-breach-scanner): stub `submissions.list` was permissive on field shape → live test caught missing `customer_id`. Fix: stub returns the production schema.
- **Rule, now explicit**: every stub method MUST return EXACTLY what production returns — same fields, same types, same omissions. A stub that returns a richer object than production is worse than no stub at all because it hides drift.
- Codifying this in the test pattern: when writing a smoke for a new module, look up the real producer's return shape first (read the source, not just the JSDoc) and write the stub to match.

**Why scanner injection over portal-API change (e.g. force `customer_id` into the index)**:
- Adding `customer_id` to every index entry would be a pure regression: redundant data, every submission write costs more bytes, every read returns more bytes, no caller (other than the scanner) needs it. The per-customer-subdir design intentionally normalises it out.
- The scanner is the *only* caller that aggregates submissions across customers without a per-customer scope. So the scanner is the right layer to materialise the customer_id for downstream consumers (here, `findBreaches`).
- Localised fix; no other callers affected; documents the asymmetry where it actually matters.

**Live verification result** (post-fix):
- Real portal in tmpdir, customer registered, submission walked to in_progress, scanner ran with injected clock 80h ahead (free-tier sla_hours = 72): `breaches_found: 1, raised: 1`. The actual JSONL on disk gained a `sla_breached` event with the correct note.
- Second tick: `deduped: 1, raised: 0`. Only one breach event on disk. Idempotency works against real I/O.

## D230 — Customer-portal → Courier notifier (scanner-first wiring) (added 2026-05-18)

**What**: A new module `cognitive-engine/customer-portal/notifier.js` exports `createPortalNotifier({ courier, onLog? })`. The notifier owns the translation from a customer-portal lifecycle event (e.g. an SLA breach raised by D228) into a Courier `dispatch` call with a new `customer.*` event type. This ship wires the FIRST source — the SLA breach scanner — to the notifier; subsequent ships (D231+) wire the other three sources (HTTP /submit, project_intake, back-feed wrapper) by importing the same module and calling its other methods.

Six new Courier event types added to `EVENT_TYPES` in `cognitive-engine/courier/types.js`:
- `customer.submission_received` — fires on HTTP POST /submit (D231)
- `customer.submission_accepted` — fires when project_intake walks submitted→accepted (D232)
- `customer.submission_delivered` — fires when back-feed transitions to delivered (D232)
- `customer.sla_breached` — fires when SLA scanner detects breach **(WIRED THIS SHIP)**
- `customer.submission_cancelled` — fires when customer cancels (D231)
- `customer.submission_rejected` — fires when admin rejects (D233)

All six types get matching routing rules in `configs/courier-routing.json` — for v0.0.1 they route to the `stdout` channel only (founder log visibility). Per-customer channel prefs (so a real email/Slack channel goes to the customer instead of the founder) is a 19-C ship that lands when `account.notification_prefs` is added.

**Why a separate notifier module (not inlined into each event source)**:
- Three different subsystems emit portal events: HTTP routes (submit/cancel), queue handlers (project_intake + back-feed wrapper), and the SLA scanner. Each lives in its own file. Inlining Courier formatting in each would duplicate the template logic — when copy needs to change (e.g. switching from markdown to plain text for email), we'd touch 4+ files.
- Customer-facing copy belongs in one place. Same separation as D211 (factory-handlers stays pure; the wrapper composes).
- Tests can stub one dep (`courier.dispatch`) and exercise every notification path without spinning up the real factory.

**Why scanner-first wiring (not all 4 sources in one ship)**:
- The notifier module itself owns the dispatch + formatting for every `customer.*` event type. Adding more methods is cheap (each is a `dispatchSafely(event, label)` call with templated title/body/meta).
- But each WIRING (callsite) lives in a different module. Wiring all four in one ship would touch 4 modules + their smokes + need 4 different live verifications — review-hostile.
- Scanner is the smallest delta: it already has a tight `runOnce` contract with deps injection. Adding a `notifier?` dep is one line; the per-breach raise loop adds 4 lines (call after raise, count success, capture failure).
- Subsequent ships (D231: HTTP /submit + cancel; D232: project_intake + back-feed; D233: admin reject) each touch only their own module + reuse this notifier with NO further changes here.

**Why fail-isolated notification (notifier never throws; failures recorded into result.errors)**:
- Same rationale as D227 back-feed + D228 scanner: a notification failure must not roll back the underlying state change. The submission *did* breach; if Courier is down, the breach still happened — we just can't notify right now. Better: log + record into errors + move on.
- The scanner's timeline dedup means we don't re-fire on next tick either (the timeline already has `sla_breached`). So the notification is "best-effort, one-shot" by construction. That's intentional for v0.0.1 — at-most-once delivery semantics. If the founder needs guaranteed delivery, that's a Courier-layer retry concern (10-B http backend).
- Notifier's own `dispatchSafely` wrapper catches throws + ok:false + dropped routing, returns a unified `NotifyResult`, never raises.

**Why notifier doesn't fire when the breach was deduped or the raise failed**:
- Dedup: the breach was already notified on a prior tick (by us or by an admin manually adding the event). Re-notifying would spam.
- Raise failure: if `portal.raiseSLABreach` threw, the timeline event never landed. Notifying for a "breach" that doesn't exist in the source-of-truth is misleading. So the scanner skips both raise-fail and dedup paths.
- Encoded as `continue;` after raise failure + the `if (notifier)` block only inside the per-breach raise-success path.

**Why fake Courier backend is the v0.0.1 default**:
- The `fake` backend records every send in memory (`backend._getSent()` returns the list). Notifications are observable for tests + founder inspection without external dependencies.
- `COURIER_BACKEND=http` switches to real Hermes-gateway delivery (10-B work; needs Hermes creds + Slack/email tokens). Until those land, fake is correct.
- `NOTIFIER_DISABLED=true` env var skips notifier wiring entirely — scanner still emits timeline events, just no Courier dispatch. Used by tests + ops who want a quiet scanner.

**Why a new Courier event-type namespace (`customer.*`) instead of reusing existing types**:
- Existing types (`project.*`, `cost.*`, `agent.*`, `verify.*`, `factory.*`) are *factory-ops* events — meant for the founder/ops team watching factory health. Reusing them for customer notifications would conflate two audiences and one routing rule couldn't serve both (different channels, different severity thresholds, different targets).
- `customer.*` is a fresh namespace with its own routing rules. When per-customer prefs land, the rules will reference `account.notification_prefs.<channel>` as the target — that's a notifier-level change, not a Courier-router-level change.
- Tradeoff: 6 new types means 6 new routing rules. Acceptable — explicit, greppable, individually severity-tunable.

**Test coverage**:
- `notifier.smoke.js` (51 assertions): dep validation; event type registered in EVENT_TYPES whitelist (catches forgotten registration); happy path with full event shape verification (type, severity, title, body, meta — and real `validateEvent` from Courier types catches drift); input validation (4 missing-field variants → ok:false without dispatch); fail-isolation × 3 (dispatch throws, dispatch returns ok:false, event dropped by routing); only `onSlaBreached` exported in this ship (other methods will land per follow-on PRs).
- `sla-breach-scanner.smoke.js` extended (86 → 112 assertions): notifier provided + fresh breach → onSlaBreached fires + `result.notified` increments; backwards-compat (no notifier → notified=0); deduped breach → notifier NOT called; notifier returns ok:false → errors recorded but raise still counted; notifier throws → errors recorded, scan continues; raise failure → notifier NOT called; notifier object without onSlaBreached method → treated as null (no crash).
- D226 stub-strictness applied: stub `courier.dispatch` calls real `validateEvent` from `courier/types.js`, so any malformed event from the notifier (wrong type, missing title, bad severity) surfaces at test time — not in live.

**Tradeoff acknowledged**: per-customer routing (so customer A gets emails, customer B gets Slack) is NOT in this ship. v0.0.1 routes everything to stdout = founder log. When `account.notification_prefs` lands (19-C), the notifier will read it before dispatch and override the target per-channel. The CourierEvent shape already supports this via `meta` — no Courier-side change needed.
