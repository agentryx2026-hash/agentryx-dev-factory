/**
 * Phase 19-B smoke test for `createSlaBreachScanner`.
 *
 *   node cognitive-engine/customer-portal/sla-breach-scanner.smoke.js
 *
 * Covers the D228 contract:
 *   - Dep validation throws on missing/incomplete portal
 *   - runOnce returns a ScanResult; never throws
 *   - Empty customer list → 0 scanned, 0 raised
 *   - One customer, one breached submission, empty timeline → raised: 1
 *   - One customer, one breached submission, prior sla_breached event → deduped: 1
 *   - Multiple customers, mixed states → counts aggregate correctly
 *   - Terminal submissions ignored (delivered/rejected/cancelled never breach)
 *   - On_track / at_risk submissions do not raise
 *   - Fail-isolation: error in submissions.list for one customer does not halt
 *     scan; subsequent customers still scanned
 *   - Fail-isolation: error in timeline.read for one submission does not halt
 *     scan; other submissions still emit
 *   - Fail-isolation: error in raiseSLABreach for one submission does not halt
 *     scan; other submissions still emit
 *   - Fail-fast for accounts.list error: scan returns with errors[0] populated,
 *     scanned=0, no raise attempts
 *   - start() / stop() lifecycle: scheduling works without leaking timers
 *   - Test-clock injection drives breach detection deterministically
 */

import assert from "node:assert/strict";
import { createSlaBreachScanner } from "./sla-breach-scanner.js";

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

/**
 * Build a stub portal driven by a `world` map of customer_id → spec.
 *
 * spec: {
 *   tier: 'free'|'starter'|'pro',
 *   submissions: [{ id, status, submitted_at, target_delivery_at, timeline?: [{kind}] }],
 *   listFails?: boolean,  // submissions.list throws
 * }
 *
 * `nowMs` controls the SLA engine's view of time.
 *
 * Returns { portal, calls } where calls records every mutation for assertion.
 */
function buildPortal(world, opts = {}) {
  const calls = { listAccounts: 0, listSubs: [], reads: [], raises: [], logs: [] };
  const customers = Object.entries(world).map(([id, spec]) => ({ id, tier: spec.tier }));
  const accountsListFails = !!opts.accountsListFails;

  const portal = {
    accounts: {
      list: async () => {
        calls.listAccounts += 1;
        if (accountsListFails) throw new Error("simulated accounts.list failure");
        return customers;
      },
    },
    submissions: {
      list: async (customerId) => {
        calls.listSubs.push(customerId);
        const spec = world[customerId];
        if (!spec) return [];
        if (spec.listFails) throw new Error(`simulated submissions.list failure for ${customerId}`);
        return spec.submissions.map(s => ({
          id: s.id,
          customer_id: customerId,
          status: s.status,
          submitted_at: s.submitted_at,
          target_delivery_at: s.target_delivery_at,
        }));
      },
    },
    timeline: {
      read: async (customerId, subId) => {
        calls.reads.push({ customerId, subId });
        const spec = world[customerId];
        const sub = spec?.submissions.find(s => s.id === subId);
        if (sub?.timelineReadFails) throw new Error(`simulated timeline.read failure for ${subId}`);
        return sub?.timeline || [];
      },
    },
    sla: {
      // Pass-through to real SLA engine for breach detection. Tests
      // control breach status via target_delivery_at + injected `nowMs`.
      // We re-implement the minimal breach test here to keep the stub
      // standalone (no import-time coupling to the real engine).
      findBreaches: (subs, tiersByCustomer) => {
        const breaches = [];
        const now = opts.nowMs ? opts.nowMs() : Date.now();
        for (const sub of subs) {
          if (!tiersByCustomer[sub.customer_id]) continue;
          if (["delivered", "rejected", "cancelled"].includes(sub.status)) continue;
          const target = new Date(sub.target_delivery_at).getTime();
          if (now >= target) breaches.push({ submission: sub, sla_status: { status: "breached" } });
        }
        return breaches;
      },
    },
    raiseSLABreach: async (customerId, subId, { note } = {}) => {
      calls.raises.push({ customerId, subId, note });
      const spec = world[customerId];
      const sub = spec?.submissions.find(s => s.id === subId);
      if (sub?.raiseFails) throw new Error(`simulated raiseSLABreach failure for ${subId}`);
      // Mirror real portal: append to timeline so a *second* tick sees the breach event.
      sub.timeline = sub.timeline || [];
      sub.timeline.push({ kind: "sla_breached", note });
    },
  };
  return { portal, calls };
}

const ISO = (ms) => new Date(ms).toISOString();
const HOUR = 60 * 60 * 1000;

// ─── dep validation ───────────────────────────────────────────────────────

group("createSlaBreachScanner — dep validation");
{
  let cnt = 0;
  try { createSlaBreachScanner(); } catch { cnt += 1; }
  try { createSlaBreachScanner({}); } catch { cnt += 1; }
  try { createSlaBreachScanner({ portal: {} }); } catch { cnt += 1; }
  try { createSlaBreachScanner({ portal: { accounts: { list: () => [] } } }); } catch { cnt += 1; }
  try { createSlaBreachScanner({ portal: { accounts: { list: () => [] }, submissions: {}, timeline: {}, sla: {}, raiseSLABreach: () => {} } }); } catch { cnt += 1; }
  ok("5 invalid-input variants throw", cnt === 5);
}

// ─── empty world ──────────────────────────────────────────────────────────

group("runOnce — no customers → 0 scanned, no errors");
{
  const { portal, calls } = buildPortal({});
  const scanner = createSlaBreachScanner({ portal });
  const res = await scanner.runOnce();
  check("scanned",             res.scanned, 0);
  check("submissions_checked", res.submissions_checked, 0);
  check("breaches_found",      res.breaches_found, 0);
  check("raised",              res.raised, 0);
  check("deduped",             res.deduped, 0);
  check("errors empty",        res.errors, []);
  ok("computed_at is ISO",     typeof res.computed_at === "string" && res.computed_at.includes("T"));
  check("accounts.list called once", calls.listAccounts, 1);
}

// ─── one customer, one breached submission, fresh ───────────────────────

group("runOnce — single customer, single breached submission → raised: 1");
{
  const now = Date.now();
  const submittedMs = now - 26 * HOUR;   // 26h ago
  const targetMs = now - 2 * HOUR;       // target was 2h ago → breached
  const { portal, calls } = buildPortal({
    "CUST-1": {
      tier: "free",
      submissions: [{
        id: "SUB-1",
        status: "in_progress",
        submitted_at: ISO(submittedMs),
        target_delivery_at: ISO(targetMs),
        timeline: [{ kind: "submitted" }, { kind: "accepted" }, { kind: "phase_started" }],
      }],
    },
  }, { nowMs: () => now });
  const scanner = createSlaBreachScanner({ portal });
  const res = await scanner.runOnce();
  check("scanned",             res.scanned, 1);
  check("submissions_checked", res.submissions_checked, 1);
  check("breaches_found",      res.breaches_found, 1);
  check("raised",              res.raised, 1);
  check("deduped",             res.deduped, 0);
  check("raised_ids",          res.raised_ids, ["SUB-1"]);
  check("errors empty",        res.errors, []);
  check("raiseSLABreach called once", calls.raises.length, 1);
  check("raise target",        calls.raises[0].subId, "SUB-1");
  ok("raise note mentions target",
     String(calls.raises[0].note).includes("target_delivery_at"));
}

// ─── dedup: second tick on already-breached submission does NOT re-fire ─

group("runOnce — submission already has sla_breached event → deduped");
{
  const now = Date.now();
  const { portal, calls } = buildPortal({
    "CUST-1": {
      tier: "free",
      submissions: [{
        id: "SUB-1",
        status: "in_progress",
        submitted_at: ISO(now - 30 * HOUR),
        target_delivery_at: ISO(now - 6 * HOUR),
        timeline: [
          { kind: "submitted" },
          { kind: "sla_breached", note: "prior tick already raised" },
        ],
      }],
    },
  }, { nowMs: () => now });
  const scanner = createSlaBreachScanner({ portal });
  const res = await scanner.runOnce();
  check("breaches_found", res.breaches_found, 1);
  check("raised",         res.raised, 0);
  check("deduped",        res.deduped, 1);
  check("raise NOT called", calls.raises.length, 0);
}

// ─── back-to-back ticks: 1st raises, 2nd dedups ─────────────────────────

group("runOnce ×2 — first tick raises, second tick dedups (D226 idempotency)");
{
  const now = Date.now();
  const { portal, calls } = buildPortal({
    "CUST-1": {
      tier: "free",
      submissions: [{
        id: "SUB-1",
        status: "in_progress",
        submitted_at: ISO(now - 26 * HOUR),
        target_delivery_at: ISO(now - 2 * HOUR),
        timeline: [{ kind: "submitted" }],
      }],
    },
  }, { nowMs: () => now });
  const scanner = createSlaBreachScanner({ portal });
  const r1 = await scanner.runOnce();
  const r2 = await scanner.runOnce();
  check("tick 1: raised=1",   r1.raised, 1);
  check("tick 1: deduped=0",  r1.deduped, 0);
  check("tick 2: raised=0",   r2.raised, 0);
  check("tick 2: deduped=1",  r2.deduped, 1);
  check("only 1 raise total", calls.raises.length, 1);
}

// ─── terminal submissions never raise ────────────────────────────────────

for (const terminal of ["delivered", "rejected", "cancelled"]) {
  group(`runOnce — terminal status '${terminal}' is never raised`);
  {
    const now = Date.now();
    const { portal, calls } = buildPortal({
      "CUST-1": {
        tier: "free",
        submissions: [{
          id: "SUB-1",
          status: terminal,
          submitted_at: ISO(now - 50 * HOUR),
          target_delivery_at: ISO(now - 26 * HOUR),
          timeline: [{ kind: "submitted" }, { kind: terminal }],
        }],
      },
    }, { nowMs: () => now });
    const scanner = createSlaBreachScanner({ portal });
    const res = await scanner.runOnce();
    check("submissions_checked = 0 (filtered out before SLA)",
       res.submissions_checked, 0);
    check("breaches_found = 0", res.breaches_found, 0);
    check("raised = 0",         res.raised, 0);
    check("raise NOT called",   calls.raises.length, 0);
  }
}

// ─── on_track / at_risk submissions are not breaches ────────────────────

group("runOnce — on-track + at-risk submissions do not raise");
{
  const now = Date.now();
  const { portal, calls } = buildPortal({
    "CUST-1": {
      tier: "free",
      submissions: [
        { // on_track: 0% elapsed, 24h to go
          id: "SUB-OT", status: "in_progress",
          submitted_at: ISO(now),
          target_delivery_at: ISO(now + 24 * HOUR),
          timeline: [{ kind: "submitted" }],
        },
        { // at_risk: 22h elapsed of 24h
          id: "SUB-AR", status: "in_progress",
          submitted_at: ISO(now - 22 * HOUR),
          target_delivery_at: ISO(now + 2 * HOUR),
          timeline: [{ kind: "submitted" }],
        },
      ],
    },
  }, { nowMs: () => now });
  const scanner = createSlaBreachScanner({ portal });
  const res = await scanner.runOnce();
  check("submissions_checked", res.submissions_checked, 2);
  check("breaches_found",      res.breaches_found, 0);
  check("raised",              res.raised, 0);
  check("no raise calls",      calls.raises.length, 0);
}

// ─── multiple customers, mixed states ───────────────────────────────────

group("runOnce — multiple customers + mixed states → counts aggregate correctly");
{
  const now = Date.now();
  const { portal, calls } = buildPortal({
    "CUST-A": {
      tier: "free",
      submissions: [
        { id: "SUB-A1", status: "in_progress", submitted_at: ISO(now - 30 * HOUR), target_delivery_at: ISO(now - 6 * HOUR) }, // breach
        { id: "SUB-A2", status: "delivered",   submitted_at: ISO(now - 50 * HOUR), target_delivery_at: ISO(now - 26 * HOUR) }, // ignored
      ],
    },
    "CUST-B": {
      tier: "starter",
      submissions: [
        { id: "SUB-B1", status: "in_progress", submitted_at: ISO(now - 4 * HOUR), target_delivery_at: ISO(now + 8 * HOUR) }, // on_track
        { id: "SUB-B2", status: "accepted",    submitted_at: ISO(now - 14 * HOUR), target_delivery_at: ISO(now - 2 * HOUR) }, // breach
      ],
    },
    "CUST-C": {
      tier: "pro",
      submissions: [
        { id: "SUB-C1", status: "in_progress", submitted_at: ISO(now - 5 * HOUR), target_delivery_at: ISO(now - 1 * HOUR),
          timeline: [{ kind: "submitted" }, { kind: "sla_breached" }] }, // already raised → dedup
      ],
    },
  }, { nowMs: () => now });
  const scanner = createSlaBreachScanner({ portal });
  const res = await scanner.runOnce();
  check("scanned (customers)",      res.scanned, 3);
  check("submissions_checked (non-terminal)", res.submissions_checked, 4);
  check("breaches_found",           res.breaches_found, 3);
  check("raised (2 fresh)",         res.raised, 2);
  check("deduped (1)",              res.deduped, 1);
  check("raised_ids contains both", res.raised_ids.sort(), ["SUB-A1", "SUB-B2"]);
  check("raise calls = 2",          calls.raises.length, 2);
}

// ─── fail-isolation: one customer's submissions.list throws ─────────────

group("runOnce — submissions.list throws for one customer → others still scanned");
{
  const now = Date.now();
  const { portal, calls } = buildPortal({
    "CUST-BAD":  { tier: "free", submissions: [], listFails: true },
    "CUST-GOOD": {
      tier: "free",
      submissions: [{
        id: "SUB-G", status: "in_progress",
        submitted_at: ISO(now - 26 * HOUR),
        target_delivery_at: ISO(now - 2 * HOUR),
        timeline: [{ kind: "submitted" }],
      }],
    },
  }, { nowMs: () => now });
  const scanner = createSlaBreachScanner({ portal });
  const res = await scanner.runOnce();
  check("scanned = 2 (both customers attempted)", res.scanned, 2);
  check("errors recorded for BAD", res.errors.length, 1);
  ok("error scope mentions submissions.list",
     res.errors[0].scope.includes("submissions.list") && res.errors[0].scope.includes("CUST-BAD"));
  check("raised = 1 (good customer's breach)", res.raised, 1);
  check("raise.subId = SUB-G", calls.raises[0].subId, "SUB-G");
}

// ─── fail-isolation: timeline.read throws → skip that breach, continue ──

group("runOnce — timeline.read throws for one breach → skip + continue");
{
  const now = Date.now();
  const { portal, calls } = buildPortal({
    "CUST-1": {
      tier: "free",
      submissions: [
        { id: "SUB-FAIL", status: "in_progress",
          submitted_at: ISO(now - 26 * HOUR), target_delivery_at: ISO(now - 2 * HOUR),
          timeline: [{ kind: "submitted" }], timelineReadFails: true },
        { id: "SUB-OK", status: "in_progress",
          submitted_at: ISO(now - 26 * HOUR), target_delivery_at: ISO(now - 2 * HOUR),
          timeline: [{ kind: "submitted" }] },
      ],
    },
  }, { nowMs: () => now });
  const scanner = createSlaBreachScanner({ portal });
  const res = await scanner.runOnce();
  check("breaches_found = 2",       res.breaches_found, 2);
  check("raised = 1 (the readable)",res.raised, 1);
  check("raised_ids = [SUB-OK]",    res.raised_ids, ["SUB-OK"]);
  ok("errors include timeline.read scope",
     res.errors.some(e => e.scope.includes("timeline.read") && e.scope.includes("SUB-FAIL")));
  check("no raise for SUB-FAIL",    calls.raises.filter(r => r.subId === "SUB-FAIL").length, 0);
}

// ─── fail-isolation: raiseSLABreach throws → continue with others ───────

group("runOnce — raiseSLABreach throws for one → other emits still fire");
{
  const now = Date.now();
  const { portal, calls } = buildPortal({
    "CUST-1": {
      tier: "free",
      submissions: [
        { id: "SUB-A", status: "in_progress",
          submitted_at: ISO(now - 26 * HOUR), target_delivery_at: ISO(now - 2 * HOUR),
          timeline: [{ kind: "submitted" }], raiseFails: true },
        { id: "SUB-B", status: "in_progress",
          submitted_at: ISO(now - 26 * HOUR), target_delivery_at: ISO(now - 2 * HOUR),
          timeline: [{ kind: "submitted" }] },
      ],
    },
  }, { nowMs: () => now });
  const scanner = createSlaBreachScanner({ portal });
  const res = await scanner.runOnce();
  check("breaches_found = 2", res.breaches_found, 2);
  check("raised = 1",          res.raised, 1);
  check("raised_ids",          res.raised_ids, ["SUB-B"]);
  ok("errors include raiseSLABreach scope",
     res.errors.some(e => e.scope.includes("raiseSLABreach") && e.scope.includes("SUB-A")));
  // Both raise calls attempted; only one succeeded.
  check("raise attempts = 2",  calls.raises.length, 2);
}

// ─── fail-fast: accounts.list throws → scan returns with error ──────────

group("runOnce — accounts.list throws → scan returns with errors[0], no raises");
{
  const { portal, calls } = buildPortal({}, { accountsListFails: true });
  const scanner = createSlaBreachScanner({ portal });
  const res = await scanner.runOnce();
  check("scanned = 0",   res.scanned, 0);
  check("raised = 0",    res.raised, 0);
  check("errors = 1",    res.errors.length, 1);
  ok("error scope = accounts.list", res.errors[0].scope === "accounts.list");
  ok("error message present",       typeof res.errors[0].error === "string" && res.errors[0].error.length > 0);
  check("raise NOT called", calls.raises.length, 0);
  ok("computed_at still ISO", typeof res.computed_at === "string" && res.computed_at.includes("T"));
}

// ─── start() / stop() lifecycle ─────────────────────────────────────────

group("start() / stop() — lifecycle does not leak timers");
{
  const { portal } = buildPortal({});
  const scanner = createSlaBreachScanner({ portal, intervalMs: 60_000 });
  const a = scanner.start();
  check("start returns running:true + intervalMs", a, { running: true, intervalMs: 60_000 });
  ok("internal flag running",    scanner._running === true);
  const b = scanner.start();
  check("idempotent start",       b, { running: true, intervalMs: 60_000 });
  const c = scanner.stop();
  check("stop returns running:false", c, { running: false });
  ok("internal flag cleared",     scanner._running === false);
  const d = scanner.stop();
  check("idempotent stop",        d, { running: false });
}

// ─── intervalMs default ─────────────────────────────────────────────────

group("createSlaBreachScanner — intervalMs default (5 min) + invalid → default");
{
  const { portal } = buildPortal({});
  const s1 = createSlaBreachScanner({ portal });
  check("default intervalMs in start()", s1.start().intervalMs, 5 * 60 * 1000);
  s1.stop();
  const s2 = createSlaBreachScanner({ portal, intervalMs: 0 });
  check("intervalMs=0 → default",   s2.start().intervalMs, 5 * 60 * 1000);
  s2.stop();
  const s3 = createSlaBreachScanner({ portal, intervalMs: -100 });
  check("intervalMs<0 → default",   s3.start().intervalMs, 5 * 60 * 1000);
  s3.stop();
  const s4 = createSlaBreachScanner({ portal, intervalMs: 15_000 });
  check("custom intervalMs respected", s4.start().intervalMs, 15_000);
  s4.stop();
}

// ─── onLog hook fires for raised events ─────────────────────────────────

group("runOnce — onLog hook fires for raised events");
{
  const now = Date.now();
  const logs = [];
  const { portal } = buildPortal({
    "CUST-1": {
      tier: "free",
      submissions: [{
        id: "SUB-LOG", status: "in_progress",
        submitted_at: ISO(now - 26 * HOUR),
        target_delivery_at: ISO(now - 2 * HOUR),
        timeline: [{ kind: "submitted" }],
      }],
    },
  }, { nowMs: () => now });
  const scanner = createSlaBreachScanner({ portal, onLog: (l) => logs.push(l) });
  await scanner.runOnce();
  ok("log entry produced",      logs.length === 1);
  ok("log mentions sub id",     logs[0].includes("SUB-LOG"));
  ok("log mentions sla_breached", logs[0].includes("sla_breached"));
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
