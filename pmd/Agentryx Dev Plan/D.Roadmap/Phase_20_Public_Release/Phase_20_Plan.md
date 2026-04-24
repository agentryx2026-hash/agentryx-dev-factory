# Phase 20 — Public Release (v1.0 substrate)

**One-liner**: Consolidation phase. Not new functionality — the "go-public" hardening that every prior A-tier module needs before customers depend on it. 20-A ships substrate for usage metering, data retention, compliance (GDPR export/delete + audit reports), readiness/health aggregation, and backup manifests. 20-B wires Stripe billing, production ops (systemd health probes, cron-based retention apply, nightly backup), and the v1.0 release cutover.

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 + `03_Scaffolding_Pattern.md`:

- **Phase 19-A customer portal** already owns tenant identity (`customer_id`). 20-A's metering keys off it — no new tenant primitive invented.
- **Phase 11-A cost-tracker** aggregates `cost_usd` across artifacts + llm_calls. 20-A's metering extends that with `duration_ms`, `request_count`, and per-tenant + per-day rollups. 20-A does NOT replace cost-tracker; it complements it.
- **Phase 14-A concurrency + Phase 16-A training-gen + Phase 17-A training-videos** all produce per-item asset directories (`_jobs/work/<JOB>/`, `_training/<project>/`, `_videos/<project>/<VID>/`). 20-A retention walks these dirs with per-class TTL policies.
- **Phase 15-A self-improvement + Phase 12-A admin-substrate audit** already keep append-only logs. 20-A compliance reports read from those logs + emit their own audit entries (every compliance request is itself auditable).
- **Phase 18-A marketplace** provides the module catalog. 20-A's readiness aggregator queries each installed module for a health probe.
- **Phase 10-A Courier** will dispatch compliance request confirmations to customers (wired in 20-B).

## Design

Five substrate pieces, each thin and composable via `release.js`:

```
┌──────────────────── 20-A: Public Release substrate ────────────────────┐
│                                                                        │
│   metering.js  ──── UsageRecord per (tenant, day) with                 │
│                     request_count + cost_usd + duration_ms + tokens    │
│                     Rollups: day → week → month                        │
│                                                                        │
│   retention.js ──── RetentionPolicy per data_class (artifacts /        │
│                     memory / timelines / jobs / videos / proposals)    │
│                     dryRun() lists candidates; apply() purges with     │
│                     audit trail                                        │
│                                                                        │
│   compliance.js ─── ComplianceRequest flow:                            │
│                     export → tar-manifest of all tenant data           │
│                     delete → confirmed purge across all stores         │
│                     audit  → dated compliance report                   │
│                                                                        │
│   readiness.js ──── HealthReport aggregator; DI registry of probes     │
│                     per module; overall status = worst-case            │
│                                                                        │
│   backup.js    ──── BackupManifest: walks `_*` workspace dirs,         │
│                     computes sha256, emits restore-friendly manifest   │
│                                                                        │
│   release.js   ──── Thin orchestrator: runDailyMetering,               │
│                     applyRetention, handleComplianceRequest,           │
│                     assembleHealthReport, snapshotBackup               │
└────────────────────────────────────────────────────────────────────────┘
```

## Scope for this phase (20-A: substrate)

Follows `03_Scaffolding_Pattern.md` §1-3.

| Sub | What | Deliverable |
|---|---|---|
| 20-A.1 | `release/types.js` — UsageRecord, UsageRollup, RetentionPolicy, RetentionResult, ComplianceRequest (3 kinds: export/delete/audit), ComplianceReport, HealthReport, HealthProbe, BackupManifest, BackupEntry + validators | ✅ |
| 20-A.2 | `release/metering.js` — `createUsageMeter(rootDir)`: record(tenant_id, {request_count, cost_usd, duration_ms, tokens}); rollup by day/week/month; per-tenant + global queries | ✅ |
| 20-A.3 | `release/retention.js` — `createRetentionEngine({policies})`: `dryRun(rootDir)` → candidates[]; `apply(rootDir, {confirmed:true})` → purge + audit | ✅ |
| 20-A.4 | `release/compliance.js` — `createComplianceService(rootDir)`: handleRequest({kind, tenant_id, requested_by}) → export manifest / delete confirmation / audit report | ✅ |
| 20-A.5 | `release/readiness.js` — `createReadinessAggregator()`: DI registry of probes; `assemble()` returns HealthReport with overall status + per-probe details | ✅ |
| 20-A.6 | `release/backup.js` — `createBackupService(rootDir)`: `snapshot()` walks `_*` dirs; `verify(manifest)` re-checks sha256; `list()` shows prior snapshots | ✅ |
| 20-A.7 | `release/release.js` — thin orchestrator exposing all 5 capabilities via one entry point | ✅ |
| 20-A.8 | Smoke test — ≥80 assertions covering all 5 capabilities + orchestrator + error paths | ✅ |
| 20-A.9 | `release/README.md` + `USE_PUBLIC_RELEASE` flag registered in admin-substrate | ✅ |
| 20-B | Stripe billing + systemd health probes + cron retention apply + nightly backup + v1.0 release cutover + load tests + security review | ⏳ DEFERRED |

**Out of scope for 20-A** (deferred to 20-B):

- Stripe / payment integration
- systemd / k8s health probe HTTP routes
- cron / scheduled retention jobs
- nightly backup automation + offsite copy
- Security review (pen test, threat modeling)
- Load tests / capacity planning
- v1.0 release ceremony (changelog, announcement, marketing site)
- Multi-tenant infrastructure (per-tenant VM / namespace / db schema)

## Why this scope is right

- **100% A-tier coverage reached with this phase.** After 20-A, all 20 phase slots in the roadmap have at least substrate shipped. R1 cutover becomes a B-tier marathon, not a scaffolding marathon.
- **Consolidation, not invention.** 20-A reads from stores built by 15 prior phases. No new storage primitives. Every capability (metering / retention / compliance / readiness / backup) is an *aggregate* over existing data.
- **Each of the 5 substrate pieces is 100-180 lines.** Comparable to prior A-tiers (accounts.js was 180 lines, sla.js was 130). Total code footprint is tight because the work is composition, not greenfield.
- **Zero external API calls (D180)**. Stripe comes in 20-B. Every smoke assertion runs offline and deterministic.
- **Applies `03_Scaffolding_Pattern.md` cleanly.** Same 7-artifact bundle + 4 phase docs + flag registration. This phase tests whether the pattern generalises to consolidation work, not just greenfield work.

## Phase close criteria

- ✅ `release/` scaffolded (types + 5 capabilities + orchestrator + smoke-test + README)
- ✅ `metering.js` records + rolls up per-tenant usage across day/week/month windows
- ✅ `retention.js` dryRun + apply with audit trail; 6 data classes (artifacts / memory / timelines / jobs / videos / proposals) covered by default policies
- ✅ `compliance.js` supports 3 request kinds (export, delete, audit); every request itself audited; delete requires explicit `confirmed: true`
- ✅ `readiness.js` aggregates health probes via DI registry; overall status computed as worst-case
- ✅ `backup.js` produces sha256-verified BackupManifest; verify() detects tampering
- ✅ `release.js` orchestrator exposes all 5 capabilities with one entry point
- ✅ ≥80 assertions pass across all capabilities + orchestrator + error paths
- ✅ `USE_PUBLIC_RELEASE` flag registered (14 flags total; no runtime effect in 20-A)
- ✅ No changes to other A-tier modules; no graph/runtime changes
- ✅ Phase docs: Plan (expanded), Status, Decisions (D173-D180), Lessons

## Decisions expected

- **D173**: Public Release is a consolidation phase — it aggregates and packages existing stores; no new storage primitive is invented. Validates that the A-tier pattern scales to integration work.
- **D174**: Per-tenant usage metering keys off `customer_id` from Phase 19-A. No parallel tenant registry.
- **D175**: Retention policies expressed as `{data_class, max_age_days, storage_dirs[]}`. Engine is dry-run-first: `dryRun()` returns candidates with sizes; `apply({confirmed:true})` purges.
- **D176**: Compliance requests are themselves auditable events. Every `handleRequest` appends to `_release/compliance-audit.jsonl`. GDPR right-to-know is served by reading that log.
- **D177**: Readiness aggregator uses the DI registry pattern (same as Phase 18-A marketplace, Phase 17-A providers, Phase 16-A generators). Each module registers a probe function.
- **D178**: Backup manifest is SHA-256-verified over `_*` prefixed dirs in the workspace. Restore is 20-B's concern; 20-A proves manifest integrity.
- **D179**: Billing is 20-B. 20-A ships usage metering data in a shape Stripe can consume (metered usage records per tenant per period). 20-B translates.
- **D180**: Zero LLM calls in 20-A. Same A-tier discipline (D165 / D172 precedent).
