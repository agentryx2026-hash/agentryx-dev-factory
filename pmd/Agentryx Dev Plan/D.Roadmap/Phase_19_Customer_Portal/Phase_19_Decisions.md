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
