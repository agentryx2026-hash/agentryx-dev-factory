# Public Release (Phase 20-A)

Consolidation substrate for v1.0 go-public operations — the cross-cutting hardening every prior A-tier module needs before customers depend on it. 20-A ships 5 capabilities (usage metering, data retention, GDPR compliance, readiness aggregation, backup manifests) and an orchestrator that exposes them all. 20-B wires Stripe billing, production ops cron jobs, health-check HTTP endpoints, and the v1.0 release cutover.

## Status: Phase 20-A scaffolding

**126 smoke-test assertions pass.** All 5 capabilities proven via fake workspaces (seed fs → run capability → verify result). Cross-tenant isolation preserved through compliance delete. Backup sha256 verify catches tampering. **Zero external API calls; zero graph changes; \$0 cost.**

**This phase completes 100% A-tier coverage across the 20-phase roadmap.** Every phase slot now has at least substrate shipped. The factory moves from scaffold-heavy v0.0.1 to a B-tier-marathon posture toward R1.

## Files

- `types.js` — `UsageRecord`, `UsageRollup`, `RetentionPolicy` (+ 7 defaults), `RetentionResult`, `ComplianceRequest` (3 kinds), `ComplianceReport`, `HealthReport`, `HealthStatus`, `BackupManifest`, `BackupEntry`; UTC period-start helpers; `aggregateHealthStatus` worst-case fold
- `metering.js` — `createUsageMeter(rootDir)`: `record` / `rollup({period_kind, tenant_id?, since?, until?})` / `totals` / `listTenants` / `listRaw`
- `retention.js` — `createRetentionEngine({policies?, now?})`: `dryRun` / `apply({confirmed, only_data_class?})` / `listPolicies` / `readAudit`
- `compliance.js` — `createComplianceService({tenantDirs?})`: `handleRequest` for export / delete / audit kinds; per-tenant directory resolver DI'd for extension
- `readiness.js` — `createReadinessAggregator()`: `register` / `unregister` / `list` / `assemble` / `probe(name)` + `staticProbe(status, detail)` helper
- `backup.js` — `createBackupService({exclude?})`: `snapshot` / `verify` / `list` / `read`; `_release/backups/` excluded from own manifest
- `release.js` — orchestrator composing all 5; exposes `recordUsage`, `runDailyMetering`, `scanRetention`, `applyRetention`, `handleComplianceRequest`, `registerProbe`, `assembleHealthReport`, `snapshotBackup`, `verifyBackup`, `listBackups`
- `smoke-test.js` — 126 assertions across 10 test groups

## Layout

```
<workspace_root>/
  ├── _release/
  │   ├── metering.jsonl               append-only usage records
  │   ├── retention-audit.jsonl        retention apply events
  │   ├── compliance-audit.jsonl       compliance request events (received / succeeded / failed / refused)
  │   ├── _seq                         compliance request id counter
  │   ├── exports/
  │   │   └── CREQ-0001.json           per-request export manifest (GDPR data-portability)
  │   └── backups/
  │       ├── _seq                     backup id counter
  │       ├── BKP-0001.json            per-snapshot manifest
  │       └── BKP-0002.json
  ├── _customer-portal/...             walked by retention + compliance
  ├── _jobs/...                        walked by retention
  ├── _videos/...                      walked by retention + compliance
  ├── _training/...                    walked by retention + compliance
  └── _artifacts/...                   walked by retention + compliance
```

## Default retention policies (D175)

Registered in `types.js::DEFAULT_RETENTION_POLICIES`:

| Data class | max_age_days | Storage dir |
|---|---|---|
| `jobs`       | 30  | `_jobs` |
| `videos`     | 90  | `_videos` |
| `training`   | 90  | `_training` |
| `artifacts`  | 365 | `_artifacts` |
| `memory`     | 730 | `_factory-memory` |
| `timelines`  | 365 | `_customer-portal/customers` |
| `proposals`  | 180 | `_proposals` |

These are defaults. 20-B's admin UI registers a `retention_policies` config entry (Phase 12-A style) that operators can edit at runtime.

## Default tenant-dir resolver (D174)

Compliance `export` / `delete` / `audit` walks these per-tenant paths by default:

| Data class | Path |
|---|---|
| `customer_portal` | `_customer-portal/customers/<tenant_id>` |
| `videos`          | `_videos/<tenant_id>` |
| `training`        | `_training/<tenant_id>` |
| `artifacts`       | `_artifacts/<tenant_id>` |
| `memory`          | `_factory-memory/projects/<tenant_id>` |

New phases that add per-tenant storage register a custom `tenantDirs` resolver via `createComplianceService({ tenantDirs })`.

## Health statuses + aggregation (D177)

Three statuses: `healthy` / `degraded` / `unhealthy`. Overall is the **worst** across probes:
- all healthy → `healthy`
- any degraded, none unhealthy → `degraded`
- any unhealthy → `unhealthy`

Empty registry is vacuously `healthy`. Throwing probe is recorded as `unhealthy` with the error message. Non-object / invalid-status returns are rejected.

## API

```js
import { createReleaseOrchestrator } from "./release/release.js";
import { staticProbe } from "./release/readiness.js";

const orch = createReleaseOrchestrator({
  // Optional: retention policy overrides
  // retentionPolicies: [{data_class: "jobs", max_age_days: 14, storage_dirs: ["_jobs"]}, ...],
  // Optional: compliance tenant-dir resolver override
  // tenantDirs: (rootDir, tenantId) => [{data_class, rel_path}, ...],
  // Optional: backup excludes
  // backupExclude: ["_archive"],
});

// 1. Metering
await orch.recordUsage("/workspace", {
  tenant_id: "CUST-0001", request_count: 1, cost_usd: 0.08, duration_ms: 450, tokens: 900,
});
const dailyRollups = await orch.runDailyMetering("/workspace", {
  tenant_id: "CUST-0001", since: "2026-04-24T00:00:00Z", until: "2026-04-25T00:00:00Z",
});
// dailyRollups = [{tenant_id, period_start, period_end, request_count, cost_usd, duration_ms, tokens, underlying_records}]

// 2. Retention
const scan = await orch.scanRetention("/workspace");
// scan.candidate_count = N, scan.candidates[] = [{data_class, rel_path, age_days, size_bytes, tenant_id?}]
const purged = await orch.applyRetention("/workspace", { confirmed: true, only_data_class: "jobs" });
// purged = {dry_run: false, purged_count: N, total_bytes_freed: B, ...}

// 3. Compliance
const audit = await orch.handleComplianceRequest("/workspace", {
  kind: "audit", tenant_id: "CUST-0001", requested_by: "admin@agentryx.io",
});
const exp = await orch.handleComplianceRequest("/workspace", {
  kind: "export", tenant_id: "CUST-0001", requested_by: "admin@agentryx.io",
});
// exp.manifest_ref = "_release/exports/CREQ-0001.json"  ← 20-B tars this + uploads
const del = await orch.handleComplianceRequest("/workspace", {
  kind: "delete", tenant_id: "CUST-0001", requested_by: "admin@agentryx.io",
  confirmed: true, reason: "GDPR right to erasure",
});

// 4. Readiness
orch.registerProbe("db", async () => ({ status: "healthy", detail: "connected" }));
orch.registerProbe("llm", staticProbe("degraded", "fallback provider only"));
const health = await orch.assembleHealthReport();
// health = {overall: "degraded", probes: [...], counts: {healthy, degraded, unhealthy}, duration_ms}

// 5. Backup
const manifest = await orch.snapshotBackup("/workspace");
// manifest = {id: "BKP-0001", entries: [{rel_path, size_bytes, sha256, mtime}], manifest_sha256}
const verification = await orch.verifyBackup("/workspace", manifest);
// verification = {ok, manifest_body_ok, missing, altered}
const history = await orch.listBackups("/workspace");
```

## Smoke test summary

```
$ node cognitive-engine/release/smoke-test.js
[types]                          ✓ 16   (8 data classes / 3 period kinds / aggregation / period starts)
[metering]                       ✓ 14   (record / rollup day+week+month / since filter / totals / listTenants / validation)
[retention]                      ✓ 19   (dryRun / apply with confirmation gate / only_data_class / audit / policy validation)
[compliance — audit]             ✓ 7
[compliance — export]            ✓ 6
[compliance — delete + gate]     ✓ 6    (refused without confirmed; cross-tenant untouched; audit by tenant)
[compliance — validation]        ✓ 3
[readiness]                      ✓ 13   (empty / mixed / throwing / null-return / register-unregister / sorted list / single probe / validation)
[backup]                         ✓ 19   (snapshot / verify tamper+missing / BKP monotonic / list / read / exclude own manifest)
[orchestrator]                   ✓ 9    (5 capabilities via one facade)

[smoke] OK  — 126 assertions
```

## Feature flag

```
USE_PUBLIC_RELEASE=true     Phase 20-B onwards: cron retention + nightly backup + health endpoints + Stripe wiring active
                            Phase 20-A: no runtime effect; library only
```

## Design decisions

- **D173** — Public Release is a consolidation phase. Reads from stores built by 15 prior phases; no new storage primitives invented. Validates the A-tier pattern generalises to integration work.
- **D174** — Tenant_id = customer_id from Phase 19-A. No parallel tenant registry. "system" is a reserved tenant for non-tenant usage (internal jobs, admin actions).
- **D175** — Retention policies are `{data_class, max_age_days, storage_dirs[]}`. Engine is dry-run-first: `dryRun()` enumerates candidates; `apply({confirmed:true})` purges + audits.
- **D176** — Every compliance request is itself auditable. `received` + `succeeded` / `failed` / `refused` pairs land in `_release/compliance-audit.jsonl` with tenant_id + kind for filtering. GDPR right-to-know served by reading the log.
- **D177** — Readiness uses the DI registry pattern (same as Phase 18-A marketplace, Phase 17-A providers, Phase 16-A generators). Each module contributes a named probe.
- **D178** — Backup manifest is sha256-verified over `_*` prefixed dirs. `_release/backups/` excluded from own manifest to avoid recursion. `manifest.manifest_sha256` hashes the manifest body itself so tampering with the manifest is also detected.
- **D179** — Billing is 20-B. 20-A ships metering data in a shape Stripe can consume (per-tenant-per-period records with cost_usd + request_count + tokens + duration_ms). 20-B translates to Stripe usage records + invoicing.
- **D180** — Zero LLM calls in 20-A. Same A-tier discipline (D165, D172 precedent).

## Rollback

20-A has no runtime hooks. The library exists but no cron / HTTP / Stripe callers wire it yet. Flag defaults OFF. Removal = `rm -rf cognitive-engine/release/` + unregister flag. Phase tag `phase-20a-closed` is the rollback anchor.

## What 20-B adds

- **Stripe billing** — consumes `runDailyMetering` rollups; reports usage records per tenant per day; invoicing; payment method on file via Phase 19 customer portal
- **systemd / k8s health probes** — HTTP `/healthz` (always returns 200 if process alive) and `/readyz` (wraps `assembleHealthReport`; returns 503 if unhealthy)
- **Cron / scheduled retention** — daily `dryRun` → admin review queue; weekly auto-apply for non-destructive classes (logs, temp dirs); manual confirmation required for tenant data
- **Nightly backup + offsite** — cron `snapshotBackup` → tar of `_*` dirs → S3/R2 upload with server-side encryption; restore tested monthly
- **Security review** — external pen test; threat model; secrets rotation policy; dependency audit (npm audit + Snyk)
- **Load tests** — concurrent tenant simulation (10 / 100 / 1000 customers submitting simultaneously); capacity planning doc
- **v1.0 release ceremony** — CHANGELOG.md from git log; migration guide; marketing site update; support rotation plan

## What 20-C (or later) may add

- **Multi-region deployment** — per-region data residency for GDPR Art. 3 compliance; compliance audit includes region attestation
- **SOC 2 Type II substrate** — control mapping doc; auditor-friendly audit log format; evidence collection automation
- **HIPAA track** — if factory customers include healthcare; BAA template; separate encryption-at-rest story
- **White-label deployment** — per-customer branded factory instances; shared infra, isolated data
