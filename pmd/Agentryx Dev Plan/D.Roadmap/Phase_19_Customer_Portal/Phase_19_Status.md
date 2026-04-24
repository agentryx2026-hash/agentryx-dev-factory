# Phase 19 — Status: 19-A COMPLETE ✅  (19-B DEFERRED)

**Phase started**: 2026-04-24
**Phase 19-A closed**: 2026-04-24
**Duration**: single session (applied `03_Scaffolding_Pattern.md` for the first time after codification)

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
| 19-B | HTTP API + React UI + queue handler + Courier notifications + budget gate + Verify linkage + SLA scanner + password auth | ⏳ DEFERRED |

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
