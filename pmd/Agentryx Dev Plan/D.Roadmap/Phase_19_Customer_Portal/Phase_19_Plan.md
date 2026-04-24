# Phase 19 — Customer Portal

**One-liner**: Customer-facing substrate where non-admin users submit project requests and track them through the factory lifecycle. Tier-based SLA tracking, per-customer sandboxing, timeline receipts, notification hooks. Phase 19-A ships the substrate (types + accounts + submissions + timeline + SLA engine + portal API) with filesystem-backed isolation and token-based auth; 19-B adds the HTTP surface, React UI, and wiring to Phase 14 queue + Phase 10 Courier notifications.

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 ("read existing code before scoping") and `03_Scaffolding_Pattern.md`:

- **Phase 14-A concurrency engine** is the dispatcher. Customer submissions enqueue as `project_intake` jobs → scheduler routes them through `pre_dev` → `dev` → `post_dev`. 19-A defines the intake envelope; 19-B wires it.
- **Phase 3 Genovi** is the LLM-backed intake agent. Customer submissions flow through Genovi when the customer's input needs structured extraction (SRS/FRS/PRD → structured requirements). 19-A's portal is a thin pre-Genovi layer — it normalises the customer's free-form submission into an intake envelope, Genovi consumes it downstream.
- **Phase 10-A Courier** delivers customer notifications (submission received / phase transition / SLA breach alert / delivery ready). 19-A declares the events; 19-B routes them through Courier.
- **Phase 11-A cost-tracker** enforces per-customer budget caps. 19-A records a `budget_usd` on each submission; Phase 11-B's gate reads it.
- **Phase 9-A Verify integration** is where the customer eventually reviews output. 19-B wires the customer's Verify account to their portal account.
- **Phase 12-A admin substrate** — a new `customer_tiers` config (free / starter / pro with SLA policies) registers into Phase 12's registry; admin UI (12-B) manages tier assignments.
- **Phase 18-A marketplace** — customer portal is itself a module with a manifest. Its factory reads `customer_tiers` config at install.

## Design

A **CustomerAccount** holds identity + tier. A **ProjectSubmission** is the submitted project-request envelope. Every submission gets a **Timeline** — append-only events tracking status transitions and ETA updates. **SLA policies** are per-tier and drive ETA calculation + breach detection.

```
customer submission (free-form prose + metadata)
        │
        ▼
  portal.submitProject(token, payload)
        │
        ├── account lookup (accounts store)
        ├── payload validation + per-tier quota check
        ├── tier SLA policy loaded (free / starter / pro)
        ├── submission stored (submissions store, per-customer sandbox)
        ├── timeline initialised with "submitted" event + computed ETA
        ├── receipt returned (submission_id + ETA + tier details)
        │
        ▼
  [async, outside 19-A]
  14-A queue handler "project_intake" (19-B wires this)
        │
        ├── invoke Genovi (Phase 3) with customer payload
        ├── each phase transition → portal.recordTimelineEvent(submission_id, event)
        ├── each SLA breach → portal.raiseSLABreach(submission_id, phase, note)
        │
        ▼
  portal.getStatus(token, submission_id) → { submission, timeline, sla_status, eta }
```

### Tiers (D170)

| Tier | Max active submissions | SLA (submit→delivery) | Budget cap | Priority |
|---|---|---|---|---|
| `free`    | 1  | 72h | \$10  | 100 (lowest) |
| `starter` | 5  | 48h | \$100 | 50  |
| `pro`     | 50 | 24h | \$1000 | 10 (highest) |

Values live in a registered config (`customer_tiers`) so 12-B admin UI can tune them without redeploy. 19-A ships the three-tier schema with above defaults.

## Scope for this phase (19-A: substrate)

Mirrors 5-A through 18-A pattern per `03_Scaffolding_Pattern.md`.

| Sub | What | Deliverable |
|---|---|---|
| 19-A.1 | `customer-portal/types.js` — CustomerAccount, CustomerTier (3), ProjectSubmission, SubmissionStatus (5), TimelineEvent (8 kinds), SLAPolicy, SLAStatus, SubmissionReceipt | ✅ |
| 19-A.2 | `customer-portal/accounts.js` — filesystem-backed account store with opaque-token auth, per-customer sandbox dir | ✅ |
| 19-A.3 | `customer-portal/submissions.js` — per-customer submission store with isolation + lifecycle (submitted → accepted → in_progress → delivered / rejected / cancelled) | ✅ |
| 19-A.4 | `customer-portal/timeline.js` — append-only TimelineEvent store per submission; emits structured events for `submitted`, `phase_started`, `phase_completed`, `sla_breached`, `delivered`, `cancelled`, `rejected`, `note` | ✅ |
| 19-A.5 | `customer-portal/sla.js` — 3-tier SLAPolicy schema + ETA calculator + breach detector + `computeSLAStatus(submission, timeline, policy)` | ✅ |
| 19-A.6 | `customer-portal/portal.js` — high-level API: `submitProject`, `getStatus`, `listMyProjects`, `cancelSubmission`, `recordTimelineEvent`, `raiseSLABreach` | ✅ |
| 19-A.7 | Smoke test — 80+ assertions covering full lifecycle + SLA breach + auth failure + tier quota enforcement + cancel path | ✅ |
| 19-A.8 | `customer-portal/README.md` + `USE_CUSTOMER_PORTAL` flag registered in admin-substrate | ✅ |
| 19-B | HTTP API + React customer UI + Phase 14 queue handler wiring + Phase 10 Courier notifications + Phase 11 budget gate + Phase 9 Verify link | ⏳ DEFERRED |

**Out of scope for 19-A** (deferred to 19-B/C):

- HTTP API surface (Express / Fastify routes)
- React customer UI (dashboard, submission form, status page)
- Password-based auth (19-A uses opaque bearer tokens only)
- Payment integration (that's Phase 20 Public Release territory)
- Phase 14-A queue wiring (`project_intake` handler registration)
- Phase 10-A Courier notification dispatch
- Phase 11-A pre-flight budget gate integration
- Phase 9-A Verify portal account linkage
- Multi-language customer experiences
- Customer-to-admin support tickets (19-C)

## Why this scope is right

- **The submission envelope is the durable artifact**. Once 19-A fixes the shape of `ProjectSubmission` + `TimelineEvent`, 19-B's HTTP layer, UI, and queue handler all compose against it without negotiation.
- **Per-customer sandboxing matches existing A-tier storage discipline**. Every module's store uses a per-item directory (`_jobs/work/<JOB>/`, `_videos/<project>/<VID>/`, `_training/<project>/`). Customer submissions get `_customer-portal/<customer_id>/<submission_id>/` — same rhythm.
- **Token-based auth in A-tier, passwords in B-tier**. Tokens are serialisable, deterministic, smoke-testable. Password hashing needs bcrypt/argon2 — real deps. Defer.
- **Filesystem-only substrate matches the 14×-proven pattern**. No Redis, no Postgres, no auth service. SHA-256-hashed tokens stored alongside accounts. `ls + cat + jq` remains the ops toolkit.
- **Zero LLM calls in 19-A**. Customer portal never directly calls an LLM — intake routing goes through Genovi (Phase 3) downstream. `raiseSLABreach` takes a note, doesn't generate one.

## Phase close criteria

- ✅ `customer-portal/` scaffolded (types, accounts, submissions, timeline, sla, portal, smoke-test, README)
- ✅ All seven sub-modules compose cleanly via `portal.js` high-level API
- ✅ Three tiers (free / starter / pro) with SLA + budget + quota policies; defaults match D170 table
- ✅ SLA ETA calculator produces sane estimates from tier policy + timeline
- ✅ SLA breach detector flags submissions that cross the tier deadline
- ✅ Per-customer quota enforcement rejects new submissions when tier's `max_active_submissions` is reached
- ✅ Token auth: opaque bearer tokens, SHA-256-hashed at rest; all portal methods enforce token → account lookup
- ✅ Timeline append-only; 8 event kinds covered; every status transition emits a typed event
- ✅ Cancel path: customer can cancel `submitted` / `accepted` submissions; later states reject cancel
- ✅ Smoke test: full lifecycle + SLA breach + quota rejection + cancel + invalid token + forbidden cross-customer access, ≥80 assertions
- ✅ `USE_CUSTOMER_PORTAL` flag registered (no runtime effect in 19-A)
- ✅ No changes to graph files, other A-tier modules, memory layer, or admin substrate core
- ✅ Phase docs: Plan (expanded), Status, Decisions (D166-D172), Lessons

## Decisions expected

- **D166**: Customer portal is its own substrate — not a wrapper over Genovi. Portal tracks projects from submission through delivery; Genovi is one downstream handler that processes the intake envelope.
- **D167**: Per-customer sandboxing — `_customer-portal/<customer_id>/` with hashed account file + submissions subdir. Matches per-item asset directory convention across other A-tier stores.
- **D168**: Token-based opaque bearer auth in 19-A. Tokens stored SHA-256 hashed at rest; plaintext only returned once on account creation. Password auth deferred to 19-B.
- **D169**: SLA policies live in a Phase 12-A config (`customer_tiers`); 19-A registers the config with 3-tier defaults (free/starter/pro); 12-B admin UI will manage overrides per project or per customer.
- **D170**: Three tiers only in 19-A: free / starter / pro. Enterprise tier (with custom SLA + dedicated support) deferred to 19-C.
- **D171**: Timeline is append-only JSONL per submission. 8 event kinds cover the full lifecycle. Events include `computed_eta_at` so dashboards can show timeline + ETA drift.
- **D172**: Zero LLM calls in 19-A. All intake routing and notifications are stub functions — real wiring ships in 19-B through Phase 14 queue + Phase 10 Courier.
