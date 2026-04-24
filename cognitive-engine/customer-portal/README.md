# Customer Portal (Phase 19-A)

Customer-facing substrate — the non-admin-user surface that accepts project submissions, tracks them through the factory lifecycle with tier-based SLA, and exposes per-customer history. Phase 19-B wires the HTTP surface, React UI, Phase 14 queue handler, and Phase 10 Courier notifications.

## Status: Phase 19-A scaffolding

**138 smoke-test assertions pass.** Full customer lifecycle proven (register → submit → transition → deliver), SLA engine verified across on_track / at_risk / breached / completed bands, per-customer isolation enforced at the API boundary, cancel and reject paths working, token auth + rotation + revoke green. **Zero external API calls; zero graph changes; \$0 cost.**

## Files

- `types.js` — CustomerAccount, CustomerTier (3), ProjectSubmission, SubmissionStatus (6), TimelineEvent (9 kinds), SLAPolicy, SLAStatus, SubmissionReceipt + `DEFAULT_TIER_POLICIES`
- `accounts.js` — `createAccountStore`: customer registration with opaque bearer tokens (SHA-256 hashed at rest); token rotate / revoke; tier change; email uniqueness enforced
- `submissions.js` — `createSubmissionStore`: per-customer isolated submission store; state-machine-gated transitions; cost accumulation; `countActive` / `stats`
- `timeline.js` — `createTimelineStore`: append-only JSONL per submission; 9 event kinds; filter by kind/phase; `latest` + `countByKind`
- `sla.js` — `createSLAEngine({policies?, now?})`: 3-tier policies (free/starter/pro) + `computeTargetDelivery` + `computeStatus` + `findBreaches` + `checkQuota`
- `portal.js` — `createCustomerPortal({rootDir, sla?})`: high-level API composing all four stores; auth-gated customer methods; platform-internal surface for queue handlers
- `smoke-test.js` — 138 assertions across 12 test groups

## Layout

```
<workspace_root>/_customer-portal/
  ├── _seq                                 customer id counter
  ├── index.jsonl                          newest-last account manifest (no secrets)
  ├── token-index.json                     {token_hash → customer_id}
  └── customers/
      └── CUST-0001/
          ├── account.json                 full record incl. token_hashes[]
          ├── submissions/
          │   ├── _seq                     per-customer submission counter
          │   ├── index.jsonl
          │   ├── SUB-0001.json            full submission record
          │   └── SUB-0002.json
          └── timeline/
              ├── SUB-0001.jsonl           append-only timeline for this submission
              └── SUB-0002.jsonl
```

**Isolation**: every store method takes a `customer_id`. Per-customer dirs make cross-tenant data access impossible by construction — no foreign-key lookup is needed because file paths are the access control.

## Tier policies (19-A defaults, D170)

| Tier | Max active | SLA (submit→delivery) | Budget cap | Priority |
|---|---|---|---|---|
| `free`    | 1  | 72h | \$10   | 100 (lowest) |
| `starter` | 5  | 48h | \$100  | 50 |
| `pro`     | 50 | 24h | \$1000 | 10 (highest) |

Policies live in memory; 19-B registers a `customer_tiers` config in Phase 12-A's registry, and `createSLAEngine({policies})` reads overrides. Priority values match Phase 14-A queue semantics (lower = higher priority).

## State machine

```
  submitted ──► accepted ──► in_progress ──► delivered
      │            │             │
      │            │             └──► rejected
      │            │
      ├────────────┴──► cancelled      (customer path: submitted/accepted only)
      │
      └────────────► rejected          (admin path: any non-terminal)
```

Three terminal states: `delivered`, `rejected`, `cancelled`. The portal enforces:
- **Customer** can cancel `submitted` / `accepted` (not `in_progress`).
- **Admin** can reject any non-terminal state.
- **Platform** (queue handler in 19-B) drives `submitted → accepted → in_progress → delivered`.

## Timeline event kinds (D171)

| Kind | Emitted when |
|---|---|
| `submitted`        | `portal.submitProject()` succeeds |
| `accepted`         | Queue handler (19-B) picks up the job |
| `phase_started`    | pre_dev / dev / post_dev phase begins |
| `phase_completed`  | phase finishes; carries `cost_delta_usd` |
| `sla_breached`     | Background scanner (19-B) finds elapsed > SLA |
| `delivered`        | Bundle published to Verify portal |
| `cancelled`        | Customer cancel |
| `rejected`         | Admin reject (quota / budget / validation / manual) |
| `note`             | Free-form annotation (admin or customer support) |

Each event can carry: `phase`, `note`, `cost_delta_usd`, `computed_eta_at`, free-form `meta`.

## API (high-level, via `portal.js`)

```js
import { createCustomerPortal } from "./customer-portal/portal.js";

const portal = createCustomerPortal({ rootDir: "/path/to/workspace" });

// ---- Platform ops surface (no token) ----
const { account, token } = await portal.registerCustomer({
  email: "alice@example.com", display_name: "Alice", tier: "starter",
});
// `token` is shown ONCE. Store it. Only SHA-256 hash retained.

await portal.setCustomerTier(account.id, "pro");

// ---- Customer surface (token required) ----
const receipt = await portal.submitProject(token, {
  project_title: "Todo app",
  intake_payload: "I want a todo list with offline sync and collaboration.",
  tags: ["react", "sync"],
});
// receipt = {
//   submission_id: "SUB-0001",
//   status: "submitted",
//   target_delivery_at: "...",
//   budget_cap_usd: 100,
//   tier: "starter",
//   priority: 50,
//   submitted_at: "...",
// }

const status = await portal.getStatus(token, receipt.submission_id);
// status = { submission, timeline: [TimelineEvent...], sla_status: SLAStatus }

const myList = await portal.listMyProjects(token);
const cancelled = await portal.cancelSubmission(token, "SUB-0001", { note: "changed my mind" });

// ---- Platform-internal surface (queue handler calls these; no token) ----
await portal.transitionSubmission(account.id, "SUB-0001", "accepted");
await portal.recordTimelineEvent(account.id, "SUB-0001", { kind: "phase_started", phase: "pre_dev" });
await portal.addCost(account.id, "SUB-0001", 2.30);
await portal.raiseSLABreach(account.id, "SUB-0001", { note: "past 72h window" });
await portal.rejectSubmission(account.id, "SUB-0001", { reason: "scope too large" });
```

## Error codes

Portal methods throw typed errors (`err.code`):

| Code | Meaning |
|---|---|
| `UNAUTHORIZED` | Missing or invalid token |
| `FORBIDDEN`    | Valid token but resource belongs to another customer (or doesn't exist — indistinguishable for anti-enumeration) |
| `QUOTA_EXCEEDED` | Tier's `max_active_submissions` reached |
| `VALIDATION`   | Payload shape / illegal transition / missing fields |

## Smoke test summary

```
$ node cognitive-engine/customer-portal/smoke-test.js
[types]                          ✓ 27
[accounts — basics]              ✓ 15   (create, auth, list, dup email, invalid inputs)
[accounts — token rotation]      ✓ 10   (rotate additive + revoking; revoke; tier change)
[submissions — lifecycle]        ✓ 17   (per-customer isolation; state machine; addCost; stats)
[submissions — validation]       ✓ 4
[timeline]                       ✓ 11   (append + read + filter + latest + countByKind; isolation)
[sla engine]                     ✓ 17   (all 4 status bands; findBreaches; quota; policy overrides)
[portal — lifecycle]             ✓ 12   (register → submit → transition × N → delivered; timeline; SLA)
[portal — auth enforcement]      ✓ 4    (null/bogus token; cross-customer access rejected)
[portal — quota enforcement]     ✓ 4    (blocks at quota; frees after delivery)
[portal — cancel + reject]       ✓ 7    (submitted/accepted cancellable; in_progress → VALIDATION; admin reject)
[portal — SLA breach]            ✓ 3    (clock advance → breached; raiseSLABreach records event)

[smoke] OK  — 138 assertions
```

## Feature flag

```
USE_CUSTOMER_PORTAL=true     Phase 19-B onwards: HTTP surface + React UI + queue handler live
                             Phase 19-A: no runtime effect; library only
```

## Design decisions

- **D166** — Customer portal is its own substrate, not a wrapper over Genovi. Portal tracks **projects** (submission → delivery); Genovi is one downstream consumer that receives the intake envelope during `pre_dev`.
- **D167** — Per-customer sandbox dirs (`_customer-portal/customers/<customer_id>/…`). File paths ARE access control; cross-tenant reads are impossible by construction.
- **D168** — Opaque bearer tokens, SHA-256-hashed at rest. Plaintext returned once at account creation or rotation; never recoverable. Password auth is 19-B (needs bcrypt/argon2 dependency).
- **D169** — SLA policies live in a Phase 12-A config (`customer_tiers`). 19-A ships `DEFAULT_TIER_POLICIES`; engine's `createSLAEngine({policies})` accepts overrides. 12-B admin UI will edit them at runtime.
- **D170** — Three tiers only: `free` / `starter` / `pro`. Enterprise tier (custom SLA, dedicated support, white-glove intake) deferred to 19-C.
- **D171** — Timeline is append-only JSONL per submission. 9 event kinds cover the full lifecycle; every kind is typed in `TIMELINE_EVENT_KINDS`. Events carry `computed_eta_at` so dashboards can render ETA drift.
- **D172** — Zero LLM calls in 19-A. Intake routing, notifications, breach scanning are all stub APIs — 19-B wires them to Phase 14 queue, Phase 10 Courier, and Phase 3 Genovi respectively.

## Rollback

19-A has no runtime hooks. The portal library exists but nothing wires it to an HTTP surface yet. Flag defaults OFF. Removal = `rm -rf cognitive-engine/customer-portal/` + unregister flag. Phase tag `phase-19a-closed` is the rollback anchor.

## What 19-B adds

- **HTTP API layer** — Fastify or Express routes wrapping the portal methods; token middleware; CORS + rate limiting
- **React customer UI** — dashboard (active submissions + SLA pills), submission form, status page with timeline viewer, account/tier info
- **Phase 14-A queue handler** — `register("project_intake", handleIntake)` — invokes Genovi → pre_dev → dev → post_dev, records TimelineEvents at each transition
- **Phase 10-A Courier integration** — customer notifications: submitted, phase transitions, delivered, SLA breaches, rejected
- **Phase 11-A budget gate** — pre-flight check; running cost compared against `budget_cap_usd`; soft/hard alerts
- **Phase 9-A Verify link** — customer's Verify review account linked to portal account; approval flows trigger delivery
- **SLA breach scanner** — cron/interval that calls `sla.findBreaches()` and emits events + notifications
- **Password-based auth** — argon2id hashing; email verification flow; password reset

## What 19-C (or later) may add

- **Enterprise tier** — custom SLA policies per customer, dedicated support channel, white-glove onboarding
- **Customer → admin support tickets** — threaded conversations scoped to a submission
- **Customer-side feedback hooks** — customer rates delivered work; feedback flows into Phase 15 self-improvement as an observation kind
- **Multi-language customer experience** — Phase 16 training artifacts delivered in customer-preferred locale
- **Team accounts** — multiple users under one customer; per-user roles (owner/member/viewer)
- **OAuth / SAML / OIDC** — external IdP integration for enterprise customers
