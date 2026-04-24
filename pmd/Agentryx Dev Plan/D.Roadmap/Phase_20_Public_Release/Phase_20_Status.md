# Phase 20 — Status: 20-A COMPLETE ✅  (20-B DEFERRED)

**Phase started**: 2026-04-24
**Phase 20-A closed**: 2026-04-24
**Duration**: single session
**Milestone**: Phase 20-A close completes **100% A-tier scaffold coverage** across the 20-phase roadmap.

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 20-A.1 | `release/types.js` — UsageRecord / UsageRollup / RetentionPolicy (+7 defaults) / RetentionResult / ComplianceRequest (3 kinds) / ComplianceReport / HealthReport / BackupManifest + validators + UTC period-start helpers + `aggregateHealthStatus` worst-case fold | ✅ done |
| 20-A.2 | `release/metering.js` — createUsageMeter: record / rollup({period_kind, tenant_id?, since?, until?}) / totals / listTenants / listRaw | ✅ done |
| 20-A.3 | `release/retention.js` — createRetentionEngine({policies?, now?}): dryRun / apply({confirmed, only_data_class?}) / listPolicies / readAudit | ✅ done |
| 20-A.4 | `release/compliance.js` — createComplianceService({tenantDirs?}): handleRequest for export/delete/audit; per-request audit trail with tenant+kind filters | ✅ done |
| 20-A.5 | `release/readiness.js` — createReadinessAggregator: register/unregister/list/assemble/probe + staticProbe helper; 3 statuses with worst-case aggregation | ✅ done |
| 20-A.6 | `release/backup.js` — createBackupService({exclude?}): snapshot/verify/list/read; sha256-verified manifest body; `_release/backups/` auto-excluded | ✅ done |
| 20-A.7 | `release/release.js` — orchestrator composing all 5; exposes recordUsage / runDailyMetering / scanRetention / applyRetention / handleComplianceRequest / registerProbe / assembleHealthReport / snapshotBackup / verifyBackup / listBackups | ✅ done |
| 20-A.8 | Smoke test — 126 assertions across 10 test groups | ✅ done — all pass |
| 20-A.9 | `release/README.md` + `USE_PUBLIC_RELEASE` flag registered in admin-substrate | ✅ done |
| 20-B | Stripe billing + systemd health probes + cron retention + nightly backup + load tests + security review + v1.0 release ceremony | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/release/types.js` (new, ~160 lines)
- 8 data classes, 3 period kinds, 3 compliance kinds, 4 compliance outcomes, 3 health statuses
- `UsageRecord`, `UsageRollup`, `RetentionPolicy`, `RetentionCandidate`, `RetentionResult`, `ComplianceRequest`, `ComplianceReport`, `HealthReport`, `ProbeResult`, `BackupManifest`, `BackupEntry`
- `DEFAULT_RETENTION_POLICIES` — 7 default policies per D175 table
- Validators + `aggregateHealthStatus` + UTC period-start helpers

### `cognitive-engine/release/metering.js` (new, ~140 lines)
- Append-only `_release/metering.jsonl` with records containing `{tenant_id, request_count, cost_usd, duration_ms, tokens, at, meta?}`
- `rollup({period_kind, tenant_id?, since?, until?})` — on-demand aggregation by day/week/month; `underlying_records` per bucket
- Tenant list + totals (global or per-tenant)
- 6-decimal cost precision preserved through Math.round at 1e6

### `cognitive-engine/release/retention.js` (new, ~175 lines)
- Walks storage dirs; candidate = any file with `mtime + max_age_days < now`
- `dryRun()` enumerates; `apply({confirmed})` purges
- `tenant_id` extracted from path when directory includes `CUST-NNNN` segment
- Audit trail in `_release/retention-audit.jsonl`
- `only_data_class` scopes apply to a single class
- Policy validation at construction time (invalid data_class or max_age_days rejected)
- `dry_run_only` policy flag for read-only classes

### `cognitive-engine/release/compliance.js` (new, ~215 lines)
- `defaultTenantDirs(rootDir, tenantId)` returns 5 per-tenant paths across existing stores (`customer_portal`, `videos`, `training`, `artifacts`, `memory`)
- Three request handlers:
  - `export` → walks tenant dirs; writes manifest with sha256 + size per entry to `_release/exports/CREQ-NNNN.json`
  - `delete` → requires `confirmed: true`; rimrafs each tenant dir; refuses without confirmation (CONFIRMATION_REQUIRED error code)
  - `audit` → non-mutating; returns per-class file count + bytes
- Every action audited with `{tenant_id, kind}` for filtered readback
- 4 outcomes: `received` / `succeeded` / `failed` / `refused`

### `cognitive-engine/release/readiness.js` (new, ~115 lines)
- DI registry pattern: `register(name, probe)`, `unregister`, `list`, `has`, `assemble`, `probe(name)`
- Empty registry → vacuously `healthy`
- Throwing probe → `unhealthy` with error captured
- Non-object / invalid-status returns → rejected with error
- `assemble()` runs all probes in parallel, records per-probe duration_ms, computes overall via `aggregateHealthStatus`
- `staticProbe(status, detail)` helper for tests + placeholders

### `cognitive-engine/release/backup.js` (new, ~150 lines)
- `snapshot()` walks `_*` dirs, sha256 per file, writes BKP-NNNN.json manifest
- `manifest_sha256` hashes the manifest body itself (detects tampering with manifest)
- `verify()` returns `{ok, manifest_body_ok, missing, altered}` with per-file detail
- `_release/backups/` excluded from own manifest (no recursion)
- `list()` / `read()` for historical access

### `cognitive-engine/release/release.js` (new, ~90 lines)
- `createReleaseOrchestrator({retentionPolicies?, tenantDirs?, backupExclude?})` — composes all 5 substrate pieces
- 10 facade methods on one object; each delegates to the relevant store

### `cognitive-engine/release/smoke-test.js` (new, ~450 lines)
- **126 assertions across 10 test groups**:
  - types (16) — 8 classes / 3 period kinds / aggregate + period helpers / 7 default policies
  - metering (14) — daily / weekly / monthly rollups; since filter; tenant listing; totals; validation
  - retention (19) — dryRun + apply + confirmation gate + only_data_class + tenant extraction + audit + policy validation
  - compliance audit (7) — file count + class enumeration + audit trail
  - compliance export (6) — manifest writes; sha256 per entry
  - compliance delete (6) — refused without confirmation; cross-tenant isolation preserved; audit filterable by tenant
  - compliance validation (3)
  - readiness (13) — empty / mixed / throwing / null-return / register-unregister / single-probe / validation
  - backup (19) — snapshot + verify tamper + verify missing + BKP monotonic + list + read + exclude own manifest
  - orchestrator (9) — all 5 capabilities exercised via facade

### `cognitive-engine/release/README.md` (new)
- Status, layout diagram, default retention + tenant-dir tables, health status rules, API examples, smoke summary, decisions, 20-B/C preview

### `cognitive-engine/admin-substrate/registry.js` (modified)
- Added `USE_PUBLIC_RELEASE` feature flag (**14 total** — final flag)
- Admin smoke updated (13 → 14) — 41 assertions still pass

### Unchanged
- Graph files, `tools.js`, `telemetry.mjs`
- All prior A-tier modules: customer-portal (19-A), marketplace (18-A), training-videos (17-A), training-gen (16-A), self-improvement (15-A), concurrency (14-A), replay (13-A), admin-substrate core (12-A), cost-tracker (11-A), courier (10-A), verify-integration (9-A), parallel (8-A), memory-layer (7-A), artifacts (6-A), mcp (5-A)
- Zero regression risk

## Smoke test highlight

```
[compliance — delete kind + confirmation gate]
  ✓ delete without confirmed → refused
  ✓ other tenant untouched after refused delete
  ✓ confirmed delete → succeeded
  ✓ 3+ files deleted
  ✓ CUST-0001 customer-portal dir removed
  ✓ CUST-0002 data still present

[backup — snapshot + verify + list]
  ✓ verify ok=true for unmodified
  ✓ manifest body hash matches
  ✓ tampered → ok=false
  ✓ 1 file altered
  ✓ altered file identified
  ✓ _release/backups excluded from own manifest

[smoke] OK  — 126 assertions
```

## Why 20-B deferred

20-B = **production ops + v1.0 release ceremony**. Requires:

- **Stripe integration** — consume `runDailyMetering` rollups; push usage records; invoice generation; webhook for payment events
- **HTTP health endpoints** — `/healthz` (liveness) + `/readyz` (wraps `assembleHealthReport`) in factory-dashboard server
- **Cron retention** — daily dryRun → admin queue; weekly auto-apply for low-risk classes; admin-gated for tenant data
- **Nightly backup** — cron `snapshotBackup` → tar + upload (S3/R2) + restore drill
- **Security review** — external pen test; threat modeling; dependency audit
- **Load tests** — concurrent tenant simulation + capacity planning
- **v1.0 ceremony** — CHANGELOG.md; migration guide; marketing site; support rotation

Ship 20-A as firm substrate; 20-B wires production ops on a tested base.

## Feature-flag posture (final A-tier count)

| Flag | Default | Effect |
|---|---|---|
| (existing 13 flags ...) | off | Phases 4-19 |
| `USE_PUBLIC_RELEASE` | off | Phase 20-B: cron + health endpoints + Stripe reporter; 20-A library only |

**14 feature flags total** — final count for v0.0.1 scaffolding.

## Phase 20-A exit criteria — met

- ✅ `release/` scaffolded (types + 5 capabilities + orchestrator + smoke-test + README)
- ✅ metering records + rolls up per-tenant usage across day/week/month windows
- ✅ retention dryRun + apply with audit; 7 data classes covered by default policies
- ✅ compliance: 3 request kinds (export/delete/audit); confirmation gate; cross-tenant isolation preserved
- ✅ readiness: DI registry with 3 statuses; worst-case aggregation; throwing + invalid-return probes handled
- ✅ backup: sha256-verified manifest body; tamper detection; own-manifest exclusion
- ✅ orchestrator exposes all 5 capabilities via one entry point
- ✅ **126 smoke-test assertions all pass**
- ✅ `USE_PUBLIC_RELEASE` flag registered (14 flags total); admin smoke green at 41 assertions
- ✅ Zero changes outside `release/` + admin-substrate flag registration
- ✅ Phase docs: Plan (expanded), Status, Decisions (D173-D180), Lessons
- ⏳ 20-B Stripe + health endpoints + cron + backup automation + security + load + v1.0 deferred

**Phase 20-A closes the 20-phase A-tier scaffold bundle.** All 20 phase slots now have substrate; the factory is ready for the B-tier marathon toward R1 cutover.
