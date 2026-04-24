# Phase 20 — Lessons Learned

Phase 20-A closed: 2026-04-24. Duration: single session. **Final A-tier phase — closes 100% scaffold coverage across the 20-phase roadmap.**

## What surprised us

1. **The scaffolding pattern worked cleanly for a consolidation phase.** Going in, I wasn't sure the 7-artifact recipe + 8 conventions from `03_Scaffolding_Pattern.md` would fit a phase whose whole point is aggregating over prior phases. It did — same file count (types + 5 capabilities + orchestrator + smoke + README = 9 files), same decision document format (D173-D180), similar line budgets (~1000 LOC excluding smoke). The pattern is format-over-content in the best way: the shape enforces consistency even when the problem domain shifts.

2. **The "orchestrator composes stores" facade is a tiny but powerful piece.** `release.js` is 90 lines and exposes 10 methods, each a one-line delegate to the relevant store. Callers that want one-line access get it; callers that want low-level access get `orch.retention`, `orch.compliance`, etc. This pattern has appeared before (Phase 17-A's pipeline.js, Phase 19-A's portal.js) but only crystallised as a convention here. Worth adding to `03_Scaffolding_Pattern.md` §2 conventions as "9. Orchestrator facade when a phase has ≥3 composable stores."

3. **`tenantDirs` DI pattern made compliance future-proof in one line.** Adding a new per-tenant store in a future phase only requires registering a new `{data_class, rel_path}` entry. No compliance code changes. This is the same lesson Phase 18-A marketplace taught — make the thing that enumerates other things DI'd.

4. **Backup manifest body hash caught a subtle bug in my test.** First verify test accidentally included a file modification inside the expected-unchanged set. The `manifest_body_ok` assertion surfaced it immediately — the body hash didn't match the recomputed hash because the manifest field order differed. Fixed the serialiser to normalise (delete `manifest_sha256` field before rehashing). Caught by sharp assertions, not by luck.

## What to do differently

1. **Compliance audit trail needed one retrofit.** First version didn't include `tenant_id` / `kind` on `succeeded` / `failed` / `refused` audit entries — only on `received`. The filter-by-tenant test caught it; fix was 3 lines. Lesson for `03_Scaffolding_Pattern.md`: **every audit event in a multi-actor log must carry the identifying key set (tenant_id, kind, request_id) so filtered readback works across outcomes.**

2. **Retention's `dry_run_only` policy flag is present but unused.** I added it thinking "admin-locked policies should be uneditable" but then didn't write a test or a use case. Noting it here as dead-code-to-revisit in 20-B when admin UI concretely needs per-policy locking.

3. **Backup `verify()` doesn't re-hash files in parallel.** Sequential sha256 over N files is O(N * file_size). For large factories, this blocks. 20-B should use `Promise.all` with a concurrency limit (e.g., 4 at a time). Noted.

4. **No "restore" operation in 20-A.** Snapshot + verify are sufficient to prove the manifest is durable; restore is 20-B because it needs the tarball (or object store) that 20-A doesn't produce. Leaving this as a known gap rather than a soft-shipping.

## What feeds next phases

### Phase 20-B (deferred) — production ops + v1.0 release

- **Stripe billing** — `runDailyMetering` produces daily rollups per tenant; 20-B's Stripe reporter reads them, calls `stripe.usageRecords.create()`, stores the returned id for idempotency. Failure handling: transient → retry with backoff; permanent → admin queue.
- **`/healthz` + `/readyz` HTTP endpoints** — Fastify/Express routes in `factory-dashboard/server/`. `/healthz` = 200 always if process is up (liveness). `/readyz` = `assembleHealthReport()` → 200 if `healthy|degraded`, 503 if `unhealthy`. systemd / k8s probes bind to these.
- **Cron retention scheduler** — `cron:daily` scans all classes; flags candidates; admin review queue. Weekly auto-apply for non-destructive classes (jobs, temp logs). Manual apply for tenant data with explicit admin confirmation.
- **Nightly backup cron** — `cron:nightly` calls `snapshotBackup()` → tar of entries → upload to S3/R2 with server-side encryption → manifest stored alongside. Restore drill monthly; MTTR tracked.
- **Security review** — external pen test; STRIDE threat model per module; dependency audit via `npm audit` + Snyk; secrets rotation policy.
- **Load tests** — simulate 10 / 100 / 1000 concurrent customers; measure p50/p95/p99 latency per factory phase; capacity planning doc produced.
- **v1.0 release ceremony** — CHANGELOG.md generated from git log; migration guide; marketing site; support rotation calendar.

### Phase 11 (cost tracker) — gains a second axis

- 11-A's CostRollup attributes cost by `{project, phase, agent, task_type, model}`. 20-A's metering attributes by `{tenant_id, period}`. 20-B can join them in the admin dashboard: "Show me Alice's (CUST-0001) cost breakdown by agent over April."

### Phase 12 (admin substrate) — gains two new configs

- `retention_policies` — operators tune `max_age_days` per class at runtime
- `customer_tiers` — Phase 19-A defaults augmented with Phase 20-A retention overrides per tier (pro customers keep data longer)

### Phase 19 (customer portal) — gains real billing

- 19-B's `submitProject` currently accepts a project unconditionally (subject to tier quota). 20-B's Stripe integration adds a pre-submit check: "does customer have a valid payment method?" or "is account in good standing?" before accepting.

### Phase 15 (self-improvement) — gains compliance-aware proposals

- Proposals that involve deleting data (retention tuning, memory purges) gain automatic GDPR-audit-log entries. Self-improvement applier must record compliance audit events for any action that affects tenant data.

### R1 cutover

- With 20-A closed, all 20 phase slots have A-tier substrate. R1 cutover becomes a **B-tier marathon** — the ~16 deferred B-tier subphases in 3 cohorts (C1: OpenRouter/TTS credentials, C2: UI + user creds, C3: scale-dependent). No more greenfield scaffolding. The work shifts from "design the interface" to "wire the real thing behind the interface."

## Stats

- **1 session**
- **\$0.00 spent** (D180; and cumulative A-tier spend across 15 modules remains **\$0.00**)
- **0 new dependencies** (node built-ins only: `fs`, `path`, `crypto`, `os` in tests)
- **9 files created** in `cognitive-engine/release/`: `types.js`, `metering.js`, `retention.js`, `compliance.js`, `readiness.js`, `backup.js`, `release.js`, `smoke-test.js`, `README.md`
- **2 files modified**: `admin-substrate/registry.js` (+1 flag = **14 total**, final), `admin-substrate/smoke-test.js` (13 → 14 counts)
- **0 files modified** in: graph files, `tools.js`, `telemetry.mjs`, customer-portal (19-A), marketplace (18-A), training-videos (17-A), training-gen (16-A), self-improvement (15-A), concurrency, replay, artifacts, memory-layer, cost-tracker, courier, verify-integration, parallel, mcp
- **4 phase docs**: Plan (expanded), Status, Decisions, Lessons
- **8 Decisions**: D173-D180

## Cumulative A-tier stats (15 modules across Phases 5-A → 20-A)

- **947 smoke-test assertions** across 16 scaffolded modules (including admin-substrate's 41)
- **0 LLM calls**, **0 external API calls**, **\$0.00 cumulative LLM spend**
- **14 feature flags** registered in admin-substrate, all default OFF
- **24 phase tags** on origin/main (0, 1, 1.5, 2, 2.5, 2.75, 3, 4 + 5a-20a + baseline)
- **100% A-tier coverage** across the 20-phase roadmap

## Phase 20-A exit criteria — met

- ✅ `release/` scaffolded (types + 5 capabilities + orchestrator + smoke-test + README)
- ✅ `metering` records per-tenant usage with day/week/month rollups
- ✅ `retention` dryRun + apply with confirmation gate + audit trail
- ✅ `compliance` handles 3 request kinds (export/delete/audit); cross-tenant isolation preserved
- ✅ `readiness` aggregates probes via DI registry with worst-case status fold
- ✅ `backup` produces sha256-verified manifests with tamper detection
- ✅ `release.js` orchestrator exposes all 5 capabilities via one entry point
- ✅ **126 smoke-test assertions all pass**
- ✅ Admin-substrate smoke green at 41 assertions after flag add
- ✅ `USE_PUBLIC_RELEASE` flag registered (**14 flags total** — final)
- ✅ Zero changes outside `release/` + admin-substrate flag registration
- ✅ Phase docs: Plan (expanded), Status, Decisions (D173-D180), Lessons
- ⏳ 20-B Stripe + health endpoints + cron + backup automation + security + load + v1.0 deferred

**Phase 20-A closes the v0.0.1 A-tier bundle. 100% scaffold coverage achieved. The factory is ready for the B-tier marathon toward R1.**
