/**
 * Phase 14-B orphan-reaper smoke test.
 *
 *   node cognitive-engine/concurrency/orphan-reaper.smoke.js
 *
 * Uses a real tmp queue (not a stub) so we exercise the actual
 * filesystem rename + fail() interaction. Backdates `leased_at` on
 * specific in-flight files to simulate stale leases without waiting
 * 30 minutes.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createQueue } from "./queue.js";
import { reapOrphans, DEFAULT_LEASE_TIMEOUT_MS } from "./orphan-reaper.js";

let passed = 0, failed = 0;
function check(label, actual, expected) {
  try { assert.deepEqual(actual, expected); console.log(`  ✓ ${label}`); passed += 1; }
  catch { console.log(`  ✗ ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`); failed += 1; }
}
function ok(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); passed += 1; }
  else      { console.log(`  ✗ ${label}`); failed += 1; }
}
function group(name) { console.log(`\n[${name}]`); }

// Each test gets its own tmp workspace so prior state doesn't leak.
async function makeWorkspace() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "reaper-smoke-"));
  return dir;
}

// Helper: backdate a leased_at on an in-flight job file by `ageMs`.
async function backdate(queueBaseDir, jobId, ageMs, nowMs = Date.now()) {
  const p = path.join(queueBaseDir, "_jobs", "in-flight", `${jobId}.json`);
  const job = JSON.parse(await fsp.readFile(p, "utf-8"));
  job.leased_at = new Date(nowMs - ageMs).toISOString();
  await fsp.writeFile(p, JSON.stringify(job, null, 2), "utf-8");
}

// ─── happy path: empty queue → nothing to do ──────────────────────────────

await (async () => {
  group("empty queue → no-op");
  const ws = await makeWorkspace();
  const queue = createQueue(ws);
  const r = await reapOrphans({ queue });
  check("scanned=0", r.scanned, 0);
  check("reaped=0",  r.reaped,  0);
  check("kept=0",    r.kept,    0);
  check("errors=[]", r.errors,  []);
})();

// ─── fresh leases are kept; stale ones are reaped ─────────────────────────

await (async () => {
  group("3 in-flight: 2 stale, 1 fresh");
  const ws = await makeWorkspace();
  const queue = createQueue(ws);

  // Enqueue + lease 3 jobs.
  const j1 = await queue.enqueue({ project_id: "p", kind: "test", max_attempts: 3 });
  const j2 = await queue.enqueue({ project_id: "p", kind: "test", max_attempts: 3 });
  const j3 = await queue.enqueue({ project_id: "p", kind: "test", max_attempts: 3 });
  await queue.lease(j1.id, "worker-A");
  await queue.lease(j2.id, "worker-B");
  await queue.lease(j3.id, "worker-C");

  // Backdate j1 and j2; leave j3 fresh.
  await backdate(ws, j1.id, DEFAULT_LEASE_TIMEOUT_MS + 60_000);  // 31 min old
  await backdate(ws, j2.id, DEFAULT_LEASE_TIMEOUT_MS + 60_000);

  const r = await reapOrphans({ queue });
  check("scanned=3", r.scanned, 3);
  check("reaped=2",  r.reaped,  2);
  check("kept=1",    r.kept,    1);
  check("2 requeued", r.requeued_ids.sort(), [j1.id, j2.id].sort());
  check("0 failed",  r.failed_ids, []);

  // Verify the stale ones are back in queue/.
  const queued = await queue.listQueued();
  const queuedIds = queued.map(j => j.id).sort();
  ok("j1 in queue/", queuedIds.includes(j1.id));
  ok("j2 in queue/", queuedIds.includes(j2.id));

  // j3 stays in in-flight.
  const inflight = await queue.listInFlight();
  const inflightIds = inflight.map(j => j.id);
  check("only j3 still in in-flight", inflightIds, [j3.id]);
})();

// ─── exhausted attempts → moves to failed/, not requeued ──────────────────

await (async () => {
  group("stale job at max_attempts → failed/");
  const ws = await makeWorkspace();
  const queue = createQueue(ws);

  const j = await queue.enqueue({ project_id: "p", kind: "test", max_attempts: 2 });
  // Lease twice to bump attempt to 2 (= max_attempts).
  await queue.lease(j.id, "w");
  await queue.fail(j.id, new Error("first fail"));    // requeues, attempt now 1
  await queue.lease(j.id, "w");                       // attempt now 2 — at max
  await backdate(ws, j.id, DEFAULT_LEASE_TIMEOUT_MS + 60_000);

  const r = await reapOrphans({ queue });
  check("scanned=1", r.scanned, 1);
  check("reaped=1",  r.reaped,  1);
  check("0 requeued", r.requeued_ids, []);
  check("1 failed",  r.failed_ids, [j.id]);

  // Verify it's in failed/, not in queue/ or in-flight/.
  const queued = await queue.listQueued();
  const inflight = await queue.listInFlight();
  check("queue/ empty", queued, []);
  check("in-flight/ empty", inflight, []);
  ok("failed/ exists", fs.existsSync(path.join(ws, "_jobs", "failed", `${j.id}.json`)));
})();

// ─── second reaper run after first → no-op ────────────────────────────────

await (async () => {
  group("idempotent: 2nd reap after 1st finds nothing stale");
  const ws = await makeWorkspace();
  const queue = createQueue(ws);
  const j = await queue.enqueue({ project_id: "p", kind: "test", max_attempts: 3 });
  await queue.lease(j.id, "w");
  await backdate(ws, j.id, DEFAULT_LEASE_TIMEOUT_MS + 60_000);

  const r1 = await reapOrphans({ queue });
  check("first reap reaped 1", r1.reaped, 1);

  const r2 = await reapOrphans({ queue });
  check("second reap scanned=0", r2.scanned, 0);
  check("second reap reaped=0", r2.reaped, 0);
})();

// ─── invalid leased_at → treated as stale ────────────────────────────────

await (async () => {
  group("invalid leased_at → treated as stale");
  const ws = await makeWorkspace();
  const queue = createQueue(ws);
  const j = await queue.enqueue({ project_id: "p", kind: "test", max_attempts: 3 });
  await queue.lease(j.id, "w");

  // Corrupt the leased_at to something unparseable.
  const p = path.join(ws, "_jobs", "in-flight", `${j.id}.json`);
  const job = JSON.parse(await fsp.readFile(p, "utf-8"));
  job.leased_at = "not-a-date-at-all";
  await fsp.writeFile(p, JSON.stringify(job, null, 2), "utf-8");

  const r = await reapOrphans({ queue, logger: { info: () => {}, warn: () => {} } });
  check("scanned=1", r.scanned, 1);
  check("reaped=1",  r.reaped,  1);
})();

// ─── custom timeoutMs honored ─────────────────────────────────────────────

await (async () => {
  group("custom timeoutMs honored");
  const ws = await makeWorkspace();
  const queue = createQueue(ws);
  const j = await queue.enqueue({ project_id: "p", kind: "test", max_attempts: 3 });
  await queue.lease(j.id, "w");
  // Backdate by 5 min only.
  await backdate(ws, j.id, 5 * 60 * 1000);

  // With default 30-min timeout → not stale yet, kept.
  let r = await reapOrphans({ queue });
  check("kept under default timeout", r.kept, 1);
  check("reaped=0", r.reaped, 0);

  // With 1-min timeout → stale, reaped.
  r = await reapOrphans({ queue, timeoutMs: 60_000 });
  check("reaped under 1-min timeout", r.reaped, 1);
})();

// ─── env var override ─────────────────────────────────────────────────────

await (async () => {
  group("LEASE_TIMEOUT_MS env var override");
  const ws = await makeWorkspace();
  const queue = createQueue(ws);
  const j = await queue.enqueue({ project_id: "p", kind: "test", max_attempts: 3 });
  await queue.lease(j.id, "w");
  await backdate(ws, j.id, 2 * 60 * 1000); // 2 min old

  const prior = process.env.LEASE_TIMEOUT_MS;
  process.env.LEASE_TIMEOUT_MS = "60000";  // 1 min → makes 2-min-old stale
  const r = await reapOrphans({ queue });
  check("reaped (env override)", r.reaped, 1);
  if (prior === undefined) delete process.env.LEASE_TIMEOUT_MS; else process.env.LEASE_TIMEOUT_MS = prior;
})();

// ─── arg validation ──────────────────────────────────────────────────────

await (async () => {
  group("arg validation");
  let cnt = 0;
  try { await reapOrphans(); } catch { cnt += 1; }
  try { await reapOrphans({}); } catch { cnt += 1; }
  try { await reapOrphans({ queue: { listInFlight: () => {} } }); } catch { cnt += 1; } // missing fail
  ok("3 missing-arg variants throw", cnt === 3);
})();

// ─── DEFAULT_LEASE_TIMEOUT_MS constant ────────────────────────────────────

group("DEFAULT_LEASE_TIMEOUT_MS constant");
check("30 minutes", DEFAULT_LEASE_TIMEOUT_MS, 30 * 60 * 1000);

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
