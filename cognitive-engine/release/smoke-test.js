import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
  SCHEMA_VERSION, DATA_CLASSES, PERIOD_KINDS, COMPLIANCE_KINDS,
  COMPLIANCE_OUTCOMES, HEALTH_STATUSES, DEFAULT_RETENTION_POLICIES,
  isValidDataClass, isValidPeriodKind, isValidComplianceKind,
  isValidHealthStatus, aggregateHealthStatus,
  startOfUtcDay, startOfUtcWeek, startOfUtcMonth,
} from "./types.js";
import { createUsageMeter } from "./metering.js";
import { createRetentionEngine } from "./retention.js";
import { createComplianceService } from "./compliance.js";
import { createReadinessAggregator, staticProbe } from "./readiness.js";
import { createBackupService } from "./backup.js";
import { createReleaseOrchestrator } from "./release.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

async function setupTmpRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "release-"));
}

async function writeFileIn(root, rel, content, mtimeMs) {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  if (mtimeMs != null) {
    const d = new Date(mtimeMs);
    await fs.utimes(abs, d, d);
  }
}

// ---------------------------------------------------------------------------
async function testTypes() {
  console.log("[types]");
  assert(SCHEMA_VERSION === 1, "schema_version is 1");
  assert(DATA_CLASSES.length === 8, "8 data classes (incl. training + verify)");
  assert(PERIOD_KINDS.length === 3, "3 period kinds");
  assert(COMPLIANCE_KINDS.length === 3, "3 compliance kinds");
  assert(COMPLIANCE_OUTCOMES.length === 4, "4 compliance outcomes");
  assert(HEALTH_STATUSES.length === 3, "3 health statuses");
  assert(isValidDataClass("memory") && !isValidDataClass("nonsense"), "isValidDataClass");
  assert(isValidPeriodKind("day") && !isValidPeriodKind("year"), "isValidPeriodKind");
  assert(isValidComplianceKind("export") && !isValidComplianceKind("deletion"), "isValidComplianceKind");
  assert(isValidHealthStatus("degraded") && !isValidHealthStatus("sick"), "isValidHealthStatus");

  // aggregation
  assert(aggregateHealthStatus(["healthy", "healthy"]) === "healthy", "all healthy → healthy");
  assert(aggregateHealthStatus(["healthy", "degraded"]) === "degraded", "one degraded → degraded");
  assert(aggregateHealthStatus(["healthy", "degraded", "unhealthy"]) === "unhealthy", "any unhealthy → unhealthy");
  assert(aggregateHealthStatus([]) === "healthy", "empty → healthy (vacuous)");

  // period starts
  assert(startOfUtcDay("2026-04-24T15:30:00Z") === "2026-04-24T00:00:00.000Z", "startOfUtcDay");
  // Friday 2026-04-24; ISO week starts Monday 2026-04-20
  assert(startOfUtcWeek("2026-04-24T15:30:00Z") === "2026-04-20T00:00:00.000Z", "startOfUtcWeek (Mon)");
  assert(startOfUtcMonth("2026-04-24T15:30:00Z") === "2026-04-01T00:00:00.000Z", "startOfUtcMonth");

  assert(DEFAULT_RETENTION_POLICIES.length === 7, "7 default retention policies");
  assert(DEFAULT_RETENTION_POLICIES.every(p => isValidDataClass(p.data_class)), "all policy classes valid");
}

// ---------------------------------------------------------------------------
async function testMetering() {
  console.log("[metering — record + rollup + totals]");
  const root = await setupTmpRoot();
  try {
    const m = createUsageMeter(root);

    await m.record({ tenant_id: "CUST-0001", request_count: 1, cost_usd: 0.10, duration_ms: 200, at: "2026-04-24T10:00:00Z" });
    await m.record({ tenant_id: "CUST-0001", request_count: 2, cost_usd: 0.25, duration_ms: 400, tokens: 500, at: "2026-04-24T14:00:00Z" });
    await m.record({ tenant_id: "CUST-0001", request_count: 1, cost_usd: 0.05, duration_ms: 100, at: "2026-04-25T08:00:00Z" });
    await m.record({ tenant_id: "CUST-0002", request_count: 3, cost_usd: 0.60, duration_ms: 900, at: "2026-04-24T09:00:00Z" });

    const daily = await m.rollup({ period_kind: "day" });
    assert(daily.length === 3, `3 daily rows (2 tenants × days; got ${daily.length})`);
    const alice24 = daily.find(r => r.tenant_id === "CUST-0001" && r.period_start === "2026-04-24T00:00:00.000Z");
    assert(alice24.request_count === 3, "alice day-24 request_count=3");
    assert(Math.abs(alice24.cost_usd - 0.35) < 1e-6, "alice day-24 cost=0.35");
    assert(alice24.duration_ms === 600, "alice day-24 duration_ms=600");
    assert(alice24.tokens === 500, "alice day-24 tokens=500");
    assert(alice24.underlying_records === 2, "underlying_records=2");
    assert(alice24.period_end === "2026-04-25T00:00:00.000Z", "period_end = next day");

    // Weekly rollup
    const weekly = await m.rollup({ period_kind: "week", tenant_id: "CUST-0001" });
    assert(weekly.length === 1, "alice all in one week");
    assert(weekly[0].request_count === 4, "alice week total request_count=4");
    assert(weekly[0].period_start === "2026-04-20T00:00:00.000Z", "week starts Mon Apr 20");

    // Monthly rollup
    const monthly = await m.rollup({ period_kind: "month" });
    assert(monthly.length === 2, "2 monthly rows (one per tenant)");

    // Filtered by time window
    const since25 = await m.rollup({ period_kind: "day", since: "2026-04-25T00:00:00Z" });
    assert(since25.length === 1 && since25[0].tenant_id === "CUST-0001", "since filter limits to Apr 25+");

    // Totals
    const all = await m.totals();
    assert(all.record_count === 4, "totals record_count=4");
    assert(Math.abs(all.cost_usd - 1.00) < 1e-6, "totals cost=1.00");

    const aliceTotals = await m.totals({ tenant_id: "CUST-0001" });
    assert(aliceTotals.record_count === 3, "alice totals=3");

    const tenants = await m.listTenants();
    assert(tenants.length === 2 && tenants[0] === "CUST-0001", "2 tenants listed");

    // Validation
    try { await m.record({}); throw new Error("should reject"); }
    catch (e) { assert(/tenant_id required/.test(e.message), "missing tenant_id rejected"); }
    try { await m.rollup({ period_kind: "year" }); throw new Error("should reject"); }
    catch (e) { assert(/invalid period_kind/.test(e.message), "bad period_kind rejected"); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
async function testRetention() {
  console.log("[retention — dryRun + apply + audit]");
  const root = await setupTmpRoot();
  try {
    // Seed files: some old, some new
    const NOW = Date.parse("2026-04-24T00:00:00Z");
    const DAY = 24 * 60 * 60 * 1000;
    await writeFileIn(root, "_jobs/queue/JOB-0001.json", "{}", NOW - 40 * DAY);   // 40d old → purge (jobs: 30d)
    await writeFileIn(root, "_jobs/queue/JOB-0002.json", "{}", NOW - 10 * DAY);   // 10d → keep
    await writeFileIn(root, "_videos/CUST-0001/VID-0001/video.mp4", "vid", NOW - 100 * DAY); // 100d → purge (videos: 90d)
    await writeFileIn(root, "_videos/CUST-0001/VID-0002/video.mp4", "vid", NOW - 5 * DAY);   // keep
    await writeFileIn(root, "_artifacts/A-0001.json", "{}", NOW - 400 * DAY);                // 400d → purge (artifacts: 365d)

    const engine = createRetentionEngine({
      now: () => NOW,
    });

    const dry = await engine.dryRun(root);
    assert(dry.dry_run === true, "dryRun returns dry_run=true");
    assert(dry.candidate_count === 3, `3 candidates (got ${dry.candidate_count})`);
    assert(dry.purged_count === 0, "dryRun never purges");
    assert(dry.total_bytes_freed === 0, "dryRun reports 0 freed");
    const classes = new Set(dry.candidates.map(c => c.data_class));
    assert(classes.has("jobs") && classes.has("videos") && classes.has("artifacts"),
      "candidates span 3 classes");

    // Tenant extraction for the video
    const videoCandidate = dry.candidates.find(c => c.rel_path.includes("VID-0001"));
    assert(videoCandidate.tenant_id === "CUST-0001", "tenant_id extracted from video path");

    // Apply without confirmation → refuses
    try { await engine.apply(root); throw new Error("should reject"); }
    catch (e) { assert(e.code === "CONFIRMATION_REQUIRED", "apply without confirmed rejected"); }

    // Apply with only_data_class
    const jobsOnly = await engine.apply(root, { confirmed: true, only_data_class: "jobs" });
    assert(jobsOnly.dry_run === false, "apply dry_run=false");
    assert(jobsOnly.purged_count === 1, "1 job purged");
    assert(jobsOnly.total_bytes_freed > 0, "bytes freed > 0");

    // Check file gone
    const jobGone = await fs.access(path.join(root, "_jobs/queue/JOB-0001.json")).then(() => false, () => true);
    assert(jobGone, "old job file actually gone");
    const jobKept = await fs.access(path.join(root, "_jobs/queue/JOB-0002.json")).then(() => true, () => false);
    assert(jobKept, "new job file still present");

    // Subsequent full apply cleans the rest
    const full = await engine.apply(root, { confirmed: true });
    assert(full.purged_count === 2, `2 more purged (got ${full.purged_count})`);

    // Audit log captures both applies
    const audit = await engine.readAudit(root);
    assert(audit.length === 2, "2 retention_apply audit entries");
    assert(audit[0].action === "retention_apply", "audit entries tagged");
    assert(audit[0].only_data_class === null, "most recent apply = full");
    assert(audit[1].only_data_class === "jobs", "older apply = jobs-only");

    // Policy listing
    const policies = engine.listPolicies();
    assert(policies.length === 7, "7 default policies loaded");

    // Validation
    try {
      createRetentionEngine({ policies: [{ data_class: "nope", max_age_days: 1, storage_dirs: ["_x"] }] });
      throw new Error("should reject");
    } catch (e) { assert(/invalid data_class/.test(e.message), "bad data_class rejected"); }
    try {
      createRetentionEngine({ policies: [{ data_class: "jobs", max_age_days: -1, storage_dirs: ["_jobs"] }] });
      throw new Error("should reject");
    } catch (e) { assert(/max_age_days/.test(e.message), "negative max_age_days rejected"); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
async function testComplianceAudit() {
  console.log("[compliance — audit kind]");
  const root = await setupTmpRoot();
  try {
    // Seed some tenant data
    await writeFileIn(root, "_customer-portal/customers/CUST-0001/account.json", '{"id":"CUST-0001"}');
    await writeFileIn(root, "_customer-portal/customers/CUST-0001/submissions/SUB-0001.json", "{}");
    await writeFileIn(root, "_videos/CUST-0001/VID-0001/video.mp4", "vid");
    await writeFileIn(root, "_training/CUST-0001/TART-0001.md", "# gen");

    const c = createComplianceService();
    const report = await c.handleRequest(root, {
      kind: "audit", tenant_id: "CUST-0001", requested_by: "admin@agentryx.io",
    });
    assert(report.request_id === "CREQ-0001", "first compliance request id");
    assert(report.outcome === "succeeded", "audit outcome=succeeded");
    assert(report.summary.total_files === 4, `4 files found (got ${report.summary.total_files})`);
    assert(report.summary.classes.length === 5, "5 default tenant dirs enumerated");

    // Audit log — 2 entries (received + succeeded)
    const audit = await c.readAudit(root);
    assert(audit.length === 2, "received + succeeded audit entries");
    assert(audit[0].action === "succeeded", "newest is succeeded");
    assert(audit[1].action === "received", "oldest is received");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function testComplianceExport() {
  console.log("[compliance — export kind]");
  const root = await setupTmpRoot();
  try {
    await writeFileIn(root, "_customer-portal/customers/CUST-0001/account.json", '{"x":1}');
    await writeFileIn(root, "_videos/CUST-0001/video.mp4", "vid");

    const c = createComplianceService();
    const report = await c.handleRequest(root, {
      kind: "export", tenant_id: "CUST-0001", requested_by: "admin@agentryx.io",
    });
    assert(report.outcome === "succeeded", "export succeeded");
    assert(report.manifest_ref, "manifest_ref present");
    assert(report.summary.entry_count === 2, "2 entries exported");
    assert(report.summary.total_bytes > 0, "total_bytes > 0");

    // Manifest on disk
    const manifestPath = path.join(root, report.manifest_ref);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    assert(manifest.tenant_id === "CUST-0001", "manifest stamped with tenant");
    assert(manifest.entries.every(e => e.sha256.length === 64), "all entries have sha256");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function testComplianceDelete() {
  console.log("[compliance — delete kind + confirmation gate]");
  const root = await setupTmpRoot();
  try {
    await writeFileIn(root, "_customer-portal/customers/CUST-0001/account.json", '{"x":1}');
    await writeFileIn(root, "_customer-portal/customers/CUST-0001/submissions/SUB-0001.json", "{}");
    await writeFileIn(root, "_videos/CUST-0001/VID-0001/video.mp4", "vid");
    // Other tenant's data must NOT be touched
    await writeFileIn(root, "_customer-portal/customers/CUST-0002/account.json", '{"x":2}');

    const c = createComplianceService();

    // Without confirmation → refused
    const refused = await c.handleRequest(root, {
      kind: "delete", tenant_id: "CUST-0001", requested_by: "admin@agentryx.io",
    });
    assert(refused.outcome === "refused", "delete without confirmed → refused");

    // Other tenant data still there
    const otherStill = await fs.access(path.join(root, "_customer-portal/customers/CUST-0002/account.json"))
      .then(() => true, () => false);
    assert(otherStill, "other tenant untouched after refused delete");

    // With confirmation → succeeds
    const ok = await c.handleRequest(root, {
      kind: "delete", tenant_id: "CUST-0001", requested_by: "admin@agentryx.io",
      confirmed: true, reason: "GDPR right to erasure",
    });
    assert(ok.outcome === "succeeded", "confirmed delete → succeeded");
    assert(ok.summary.deleted_file_count >= 3, "3+ files deleted");

    // Tenant-1 directories gone
    const gone = await fs.access(path.join(root, "_customer-portal/customers/CUST-0001"))
      .then(() => false, () => true);
    assert(gone, "CUST-0001 customer-portal dir removed");

    // Tenant-2 still intact
    const stillOk = await fs.access(path.join(root, "_customer-portal/customers/CUST-0002/account.json"))
      .then(() => true, () => false);
    assert(stillOk, "CUST-0002 data still present");

    // Audit filter by tenant
    const auditForCust1 = await c.readAudit(root, { tenant_id: "CUST-0001" });
    assert(auditForCust1.length >= 4, `≥4 audit events for CUST-0001 (got ${auditForCust1.length})`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function testComplianceValidation() {
  console.log("[compliance — validation]");
  const root = await setupTmpRoot();
  try {
    const c = createComplianceService();
    try { await c.handleRequest(root, { kind: "bogus", tenant_id: "x", requested_by: "a" }); throw new Error("should reject"); }
    catch (e) { assert(/invalid compliance kind/.test(e.message), "bad kind rejected"); }
    try { await c.handleRequest(root, { kind: "export", requested_by: "a" }); throw new Error("should reject"); }
    catch (e) { assert(/tenant_id required/.test(e.message), "missing tenant_id rejected"); }
    try { await c.handleRequest(root, { kind: "export", tenant_id: "x" }); throw new Error("should reject"); }
    catch (e) { assert(/requested_by required/.test(e.message), "missing requested_by rejected"); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
async function testReadiness() {
  console.log("[readiness — aggregation + DI registry]");
  const agg = createReadinessAggregator();

  // Empty registry → vacuous healthy
  let r = await agg.assemble();
  assert(r.overall === "healthy", "empty registry → healthy");
  assert(r.probes.length === 0, "0 probes");

  agg.register("db", staticProbe("healthy", "connected"));
  agg.register("queue", staticProbe("healthy"));
  agg.register("llm", staticProbe("degraded", "fallback provider only"));

  r = await agg.assemble();
  assert(r.overall === "degraded", "mixed → degraded");
  assert(r.probes.length === 3, "3 probes");
  assert(r.counts.healthy === 2 && r.counts.degraded === 1 && r.counts.unhealthy === 0, "counts correct");
  assert(r.duration_ms >= 0, "duration_ms recorded");

  // Throwing probe is counted as unhealthy
  agg.register("external", async () => { throw new Error("boom"); });
  r = await agg.assemble();
  assert(r.overall === "unhealthy", "throwing probe pushes overall to unhealthy");
  const ext = r.probes.find(p => p.name === "external");
  assert(ext.status === "unhealthy" && /boom/.test(ext.error), "probe error captured");

  // Probe returning non-object
  agg.register("bad-return", async () => null);
  r = await agg.assemble();
  const bad = r.probes.find(p => p.name === "bad-return");
  assert(bad.status === "unhealthy" && /returned/.test(bad.error), "null return handled");

  // Unregister
  assert(agg.unregister("bad-return") === true, "unregister returns true");
  assert(agg.has("bad-return") === false, "has=false after unregister");

  // List alphabetical
  agg.unregister("external");
  const names = agg.list();
  assert(names.join(",") === "db,llm,queue", "list returns sorted names");

  // Single-probe query
  const single = await agg.probe("db");
  assert(single.name === "db" && single.status === "healthy", "single-probe query works");
  const missing = await agg.probe("nope");
  assert(missing === null, "missing probe returns null");

  // Validation
  try { agg.register("", staticProbe("healthy")); throw new Error("should reject"); }
  catch (e) { assert(/name required/.test(e.message), "empty name rejected"); }
  try { agg.register("x", "not a function"); throw new Error("should reject"); }
  catch (e) { assert(/function/.test(e.message), "non-function probe rejected"); }
}

// ---------------------------------------------------------------------------
async function testBackup() {
  console.log("[backup — snapshot + verify + list]");
  const root = await setupTmpRoot();
  try {
    await writeFileIn(root, "_customer-portal/index.jsonl", '{"id":"CUST-0001"}\n');
    await writeFileIn(root, "_jobs/queue/JOB-0001.json", "{}");
    await writeFileIn(root, "_videos/CUST-0001/VID-0001/manifest.json", "{}");
    // A dir we will NOT backup (doesn't start with _)
    await writeFileIn(root, "not-underscore/ignore.txt", "skip me");

    const b = createBackupService();
    const manifest = await b.snapshot(root);
    assert(manifest.id === "BKP-0001", "first backup id is BKP-0001");
    assert(manifest.entry_count === 3, `3 entries (got ${manifest.entry_count})`);
    assert(manifest.included_dirs.includes("_customer-portal"), "included_dirs covers _customer-portal");
    assert(!manifest.included_dirs.includes("not-underscore"), "non-underscore dirs excluded");
    assert(manifest.manifest_sha256.length === 64, "manifest_sha256 populated");
    assert(manifest.entries.every(e => e.sha256.length === 64), "all entries sha256");

    // Verify unmodified
    const v1 = await b.verify(root, manifest);
    assert(v1.ok === true, "verify ok=true for unmodified");
    assert(v1.manifest_body_ok === true, "manifest body hash matches");
    assert(v1.missing_count === 0 && v1.altered_count === 0, "no drift");

    // Tamper: modify one file
    await writeFileIn(root, "_jobs/queue/JOB-0001.json", '{"modified":true}', Date.now());
    const v2 = await b.verify(root, manifest);
    assert(v2.ok === false, "tampered → ok=false");
    assert(v2.altered_count === 1, "1 file altered");
    assert(v2.altered[0].rel_path.includes("JOB-0001.json"), "altered file identified");

    // Delete one file → missing
    await fs.unlink(path.join(root, "_customer-portal/index.jsonl"));
    const v3 = await b.verify(root, manifest);
    assert(v3.missing_count === 1, "1 file missing");
    assert(v3.missing[0] === "_customer-portal/index.jsonl", "missing path identified");

    // Second snapshot → BKP-0002
    const m2 = await b.snapshot(root);
    assert(m2.id === "BKP-0002", "sequence monotonic");

    // List newest-first
    const list = await b.list(root);
    assert(list.length === 2, "2 manifests listed");
    assert(list[0].id === "BKP-0002", "newest first");

    const read = await b.read(root, "BKP-0001");
    assert(read.id === "BKP-0001", "read by id works");
    const missing = await b.read(root, "BKP-9999");
    assert(missing === null, "missing id returns null");

    // Exclude option — backups themselves should not be in their own manifest
    const m3 = await b.snapshot(root);
    const backupsInOwnManifest = m3.entries.filter(e => e.rel_path.startsWith("_release/backups"));
    assert(backupsInOwnManifest.length === 0, "_release/backups excluded from own manifest");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
async function testOrchestrator() {
  console.log("[orchestrator — end-to-end]");
  const root = await setupTmpRoot();
  try {
    const orch = createReleaseOrchestrator();

    // Metering
    await orch.recordUsage(root, { tenant_id: "CUST-0001", cost_usd: 0.50, duration_ms: 1000, tokens: 800 });
    await orch.recordUsage(root, { tenant_id: "CUST-0001", cost_usd: 0.30, duration_ms: 400 });
    const rollups = await orch.runDailyMetering(root, { tenant_id: "CUST-0001" });
    assert(rollups.length === 1, "orchestrator rolls up usage");
    assert(Math.abs(rollups[0].cost_usd - 0.80) < 1e-6, "orchestrator rollup sums cost");

    // Retention
    await writeFileIn(root, "_jobs/queue/OLD.json", "{}", Date.now() - 60 * 24 * 3600 * 1000);
    const scan = await orch.scanRetention(root);
    assert(scan.candidate_count >= 1, "orchestrator scans retention");
    const applied = await orch.applyRetention(root, { confirmed: true, only_data_class: "jobs" });
    assert(applied.purged_count >= 1, "orchestrator applies retention");

    // Compliance
    await writeFileIn(root, "_customer-portal/customers/CUST-0001/account.json", '{}');
    const comp = await orch.handleComplianceRequest(root, {
      kind: "audit", tenant_id: "CUST-0001", requested_by: "admin@agentryx.io",
    });
    assert(comp.outcome === "succeeded", "orchestrator routes compliance");

    // Readiness
    orch.registerProbe("test-probe", staticProbe("healthy"));
    const health = await orch.assembleHealthReport();
    assert(health.overall === "healthy", "orchestrator assembles health");
    assert(health.probes.length === 1, "1 probe registered");

    // Backup
    const manifest = await orch.snapshotBackup(root);
    assert(manifest.id === "BKP-0001", "orchestrator snapshot");
    const v = await orch.verifyBackup(root, manifest);
    assert(v.ok, "orchestrator verify");
    const list = await orch.listBackups(root);
    assert(list.length === 1, "orchestrator lists backups");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
async function main() {
  try {
    await testTypes();                console.log("");
    await testMetering();             console.log("");
    await testRetention();            console.log("");
    await testComplianceAudit();      console.log("");
    await testComplianceExport();     console.log("");
    await testComplianceDelete();     console.log("");
    await testComplianceValidation(); console.log("");
    await testReadiness();            console.log("");
    await testBackup();               console.log("");
    await testOrchestrator();
    console.log("\n[smoke] OK");
  } catch (e) {
    console.error(`\n[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
