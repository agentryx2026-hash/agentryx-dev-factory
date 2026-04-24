# Phase 19 — Lessons Learned

Phase 19-A closed: 2026-04-24. Duration: single session. **First phase to apply the freshly codified `03_Scaffolding_Pattern.md`.**

## What surprised us

1. **The scaffolding pattern doc actually saved time.** Last four phases (15-A → 18-A) reinvented the sequence each session. This time I read `03_Scaffolding_Pattern.md` §3 once and executed it like a checklist — types first, store next, smoke test sharp, etc. No decisions were re-made. Estimated ~20% session-time reduction. The doc paid for itself in one phase.

2. **Per-customer sandbox dirs are simpler than I feared.** First instinct was a global `submissions.jsonl` with `customer_id` columns + linear filtering. The per-dir approach (D167) ended up with less code, clearer isolation guarantees, and sharper smoke assertions (`CUST-0001 list does not include CUST-0002's submissions` is a single-line check that would have been harder to prove with global storage).

3. **Error codes as typed `err.code` strings.** Adding `UNAUTHORIZED` / `FORBIDDEN` / `QUOTA_EXCEEDED` / `VALIDATION` as `err.code` fields (not just throwing generic errors) made the smoke test assertions dramatically cleaner — `assert(e.code === "FORBIDDEN")` instead of regex-matching error messages. HTTP layer in 19-B will map these directly to 401/403/429/400. Worth codifying as a convention in `03_Scaffolding_Pattern.md`.

4. **Mock clock pattern worked better than I thought.** `createSLAEngine({now: () => t})` with a closure-based mock let smoke tests fast-forward time to prove SLA breach behavior. This is cleaner than mocking `Date.now` globally. Worth reusing in any future time-sensitive scaffold (session tokens with expiry, rate limiters, etc.).

## What to do differently

1. **I injected a subtle bug in the smoke test** (the SLA breach `findBreaches` test was failing because I forgot to put `customer_id` on the test submission objects). Caught by the sharp assertion. Lesson: **always include all required fields in test fixtures**, even if the code path being tested doesn't read them — the next test that does will fail mysteriously.

2. **Token auth in 19-A is deliberately minimal — but email verification is a real gap for 19-B.** An attacker who knows the admin's provisioning flow could register `alice@victim.com` with arbitrary display name before the real Alice does. 19-B's email verification flow needs to lock email binding cryptographically. Noted in the README under "What 19-B adds".

3. **No rate limiting in 19-A.** A hostile customer could spam `submitProject` up to their quota limit. Quota gate stops them from exceeding N active submissions, but doesn't stop them from cycle-submitting+cancelling N*M times per minute. 19-B needs rate limiting at the HTTP layer. Not in A-tier scope but worth naming.

4. **The `authenticate → resolveAuth → throw UNAUTHORIZED` pattern is inconsistent in a subtle way.** Currently `portal.getStatus` returns FORBIDDEN for "submission doesn't exist for this customer" — which is correct for anti-enumeration (can't distinguish "not yours" from "doesn't exist"). But `portal.cancelSubmission(token, "SUB-9999")` also returns FORBIDDEN. A malicious customer could probe the id space to find real submission IDs (though since they're per-customer-isolated, the utility of enumeration is limited). Fine for now; revisit in 19-B hardening.

## What feeds next phases

### Phase 19-B (deferred) — production wiring
- **Fastify/Express HTTP API** — map portal methods to HTTP verbs; token middleware; CORS + rate limiting; schema validation (zod/ajv)
- **React customer UI** — dashboard with SLA pills (green/yellow/red/grey), submission form, timeline viewer, account settings
- **Phase 14-A queue handler** — `register("project_intake", async (job) => { ...invoke Genovi → pre_dev → dev → post_dev, record TimelineEvents... })`
- **Phase 10-A Courier notifications** — templated messages for each transition; per-customer channel preferences
- **Phase 11-A budget gate** — pre-flight cost estimate; consumed_cost_usd ≥ budget_cap_usd → auto-reject in_progress submissions with RejectedReason="budget_exceeded"
- **Phase 9-A Verify linkage** — customer's Verify account paired with portal account; approvals trigger `delivered` transition
- **SLA breach scanner** — setInterval 60s; calls `sla.findBreaches(listAllActiveSubmissions(), tiersByCustomer)` and emits `sla_breached` events + Courier notifications
- **Password auth** — argon2id hashing; email verification flow; password reset

### Phase 18 (marketplace) — customer portal is a module
- 18-A catalogue currently lacks a portal manifest — add in 18-B's catalogue refresh alongside Phase 3/4 intake/pmd_producer entries
- Category: could be a new `customer_surface` category, or folded under `handler` with `capabilities: ["customer-portal"]`

### Phase 20 (Public Release) — payment integration
- `budget_cap_usd` is currently a soft cap enforced by Phase 11. Phase 20 adds Stripe integration; submission budget becomes a hold on the customer's payment method.

### Phase 15 (self-improvement) — customer feedback proposals
- Once customers submit feedback via Verify (9-B), the observations flow into memory-layer; 15-B's LLM proposer can propose tier policy tweaks ("starter tier SLA is breached 40% of the time; propose raising to 60h").

### Phase 12 (admin) — customer management UI
- 12-B admin panel gains a "Customers" tab: list accounts, view active submissions, change tier, rotate tokens, view audit log of portal actions.

## Stats

- **1 session** (the first A-tier shipped after codifying `03_Scaffolding_Pattern.md`)
- **\$0.00 spent** (D172 — no LLM, no external calls)
- **0 new dependencies** (node built-ins only: `fs`, `path`, `crypto`)
- **8 files created** in `cognitive-engine/customer-portal/`: `types.js`, `accounts.js`, `submissions.js`, `timeline.js`, `sla.js`, `portal.js`, `smoke-test.js`, `README.md`
- **2 files modified**: `admin-substrate/registry.js` (+1 flag = 13 total), `admin-substrate/smoke-test.js` (12 → 13 counts)
- **0 files modified** in: graph files, `tools.js`, `telemetry.mjs`, marketplace (18-A), training-videos (17-A), training-gen (16-A), self-improvement (15-A), concurrency, replay, artifacts, memory-layer, cost-tracker, courier, verify-integration, parallel, mcp
- **4 phase docs**: Plan (expanded), Status, Decisions, Lessons
- **7 Decisions**: D166-D172

## Phase 19-A exit criteria — met

- ✅ `customer-portal/` scaffolded (types, accounts, submissions, timeline, sla, portal, smoke-test, README)
- ✅ Seven sub-modules compose cleanly via `portal.js` high-level API
- ✅ Three tiers (free/starter/pro) with policies matching D170 defaults
- ✅ SLA engine handles all 4 status bands (on_track / at_risk / breached / completed) with sharp test-clock assertions
- ✅ Per-customer quota enforcement rejects new submissions at `max_active_submissions`
- ✅ Token auth with rotate + revoke + SHA-256-hashed-at-rest
- ✅ Timeline append-only across 9 event kinds; cross-customer isolation verified
- ✅ Cancel path: `submitted` / `accepted` → cancelled; `in_progress` → VALIDATION; admin reject any non-terminal
- ✅ **138 smoke-test assertions all pass**
- ✅ Admin-substrate smoke green at 41 assertions after flag add
- ✅ `USE_CUSTOMER_PORTAL` flag registered with correct owning phase
- ✅ Zero changes outside `customer-portal/` + admin-substrate flag registration
- ✅ Phase docs: Plan (expanded), Status, Decisions (D166-D172), Lessons
- ⏳ 19-B HTTP + UI + queue handler + Courier + budget gate + SLA scanner + password auth deferred

Phase 19-A is **wired, tested, and ready**. Substrate is firm — 19-B brings the customer-visible surface.
