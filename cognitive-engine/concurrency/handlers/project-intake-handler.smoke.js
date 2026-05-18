/**
 * Phase 19-B Tier B smoke test for the project_intake queue handler.
 *
 *   node cognitive-engine/concurrency/handlers/project-intake-handler.smoke.js
 *
 * Stubs the Phase 19-A portal + Phase 14-A queue so the test runs
 * in-process without filesystem. The intent: prove the contract —
 * payload shape validation, state-machine walk (submitted → accepted
 * → in_progress), downstream pre_dev enqueue with correct project_id,
 * timeline events recorded, error paths.
 */

import assert from "node:assert/strict";
import { registerProjectIntakeHandler, PROJECT_INTAKE_KIND } from "./project-intake-handler.js";

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

function makeRegistry() {
  const handlers = new Map();
  return {
    register: (kind, fn) => { handlers.set(kind, fn); },
    get: (kind) => handlers.get(kind),
    has: (kind) => handlers.has(kind),
    list: () => [...handlers.keys()],
  };
}

function buildStubs(opts = {}) {
  const calls = {
    transitions: [],
    timeline: [],
    enqueued: [],
    logs: [],
    submissionLookups: [],
  };
  const portal = {
    submissions: {
      get: async (cid, sid) => {
        calls.submissionLookups.push({ cid, sid });
        if (opts.submissionMissing) return null;
        return {
          id: sid,
          customer_id: cid,
          status: "submitted",
          intake_payload: "Build a TODO REST API with auth",
          project_title: "TodoApp v1",
          budget_cap_usd: 10,
          target_delivery_at: "2026-05-19T12:00:00Z",
        };
      },
    },
    transitionSubmission: async (cid, sid, to, opts) => {
      calls.transitions.push({ cid, sid, to, opts });
      if (opts?.patch?.downstream_pre_dev_job_id === "FORCE_TRANSITION_FAIL") {
        throw new Error("simulated transition failure");
      }
    },
    recordTimelineEvent: async (cid, sid, event) => {
      calls.timeline.push({ cid, sid, ...event });
    },
  };
  const queue = {
    enqueue: async (job) => {
      calls.enqueued.push(job);
      if (opts.enqueueFails) throw new Error("simulated queue.enqueue failure");
      return { id: "JOB-DOWN-001", ...job, attempt: 0, state: "queued" };
    },
  };
  return {
    portal, queue,
    onLog: (line, jobId) => calls.logs.push({ jobId, line }),
    _calls: calls,
  };
}

// ─── registration ──────────────────────────────────────────────────────────

group(`registerProjectIntakeHandler — registers '${PROJECT_INTAKE_KIND}'`);
{
  const reg = makeRegistry();
  registerProjectIntakeHandler(reg, buildStubs());
  ok("registry.has", reg.has(PROJECT_INTAKE_KIND));
  ok("registry.list includes", reg.list().includes(PROJECT_INTAKE_KIND));
}

// ─── happy path ────────────────────────────────────────────────────────────

group("handler — valid payload → walks submission through state machine + enqueues pre_dev");
{
  const reg = makeRegistry();
  const deps = buildStubs();
  registerProjectIntakeHandler(reg, deps);
  const result = await reg.get(PROJECT_INTAKE_KIND)({
    id: "JOB-INTAKE-1",
    payload: { customer_id: "CUST-0001", submission_id: "SUB-0001" },
  });

  // Return shape
  check("submission_id",   result.submission_id, "SUB-0001");
  check("customer_id",     result.customer_id, "CUST-0001");
  check("status",          result.status, "in_progress");
  check("downstream pre_dev job id", result.downstream_pre_dev_job_id, "JOB-DOWN-001");
  check("downstream project_id",     result.downstream_project_id, "CUST-0001_SUB-0001");
  ok("accepted_at is ISO",  typeof result.accepted_at === "string" && result.accepted_at.includes("T"));

  // Lookup
  check("submission looked up once", deps._calls.submissionLookups.length, 1);
  check("lookup args",               deps._calls.submissionLookups[0], { cid: "CUST-0001", sid: "SUB-0001" });

  // Two transitions: submitted→accepted, accepted→in_progress
  check("2 transitions fired", deps._calls.transitions.length, 2);
  check("first transition target", deps._calls.transitions[0].to, "accepted");
  check("second transition target", deps._calls.transitions[1].to, "in_progress");
  ok("second transition patches downstream_pre_dev_job_id",
     deps._calls.transitions[1].opts?.patch?.downstream_pre_dev_job_id === "JOB-DOWN-001");

  // Timeline events: accepted + phase_change (intake handler doesn't add a fail/error event on happy path)
  ok("timeline event 'accepted' recorded",
     deps._calls.timeline.some(e => e.kind === "accepted"));
  ok("timeline event 'phase_change → pre_dev' recorded",
     deps._calls.timeline.some(e => e.kind === "phase_change" && e.phase === "pre_dev"));
  ok("no error event on happy path",
     !deps._calls.timeline.some(e => e.kind === "error"));

  // Downstream enqueue
  check("queue.enqueue called once", deps._calls.enqueued.length, 1);
  check("downstream kind = pre_dev", deps._calls.enqueued[0].kind, "pre_dev");
  check("downstream project_id customer-prefixed",
     deps._calls.enqueued[0].project_id, "CUST-0001_SUB-0001");
  check("downstream payload includes task",
     deps._calls.enqueued[0].payload.task, "Build a TODO REST API with auth");
  check("downstream payload threads customer_id",
     deps._calls.enqueued[0].payload.customer_id, "CUST-0001");

  // Logs
  ok("onLog fired ≥ 3 times", deps._calls.logs.length >= 3);
  ok("logs include 'intake start'", deps._calls.logs.some(l => l.line.includes("intake start")));
  ok("logs include 'accepted at'",  deps._calls.logs.some(l => l.line.includes("accepted at")));
  ok("logs include 'pre_dev enqueued'", deps._calls.logs.some(l => l.line.includes("pre_dev enqueued")));
}

// ─── missing payload fields → throws ───────────────────────────────────────

group("handler — missing payload fields → throws");
{
  const reg = makeRegistry();
  registerProjectIntakeHandler(reg, buildStubs());
  const fn = reg.get(PROJECT_INTAKE_KIND);
  let cnt = 0;
  try { await fn({ id: "X", payload: {} }); } catch { cnt += 1; }
  try { await fn({ id: "X", payload: { customer_id: "C" } }); } catch { cnt += 1; }
  try { await fn({ id: "X", payload: { submission_id: "S" } }); } catch { cnt += 1; }
  ok("3 missing-field variants throw", cnt === 3);
}

// ─── submission not found → throws (no transitions, no enqueue) ────────────

group("handler — submission missing → fails fast");
{
  const reg = makeRegistry();
  const deps = buildStubs({ submissionMissing: true });
  registerProjectIntakeHandler(reg, deps);
  let threw = false;
  try {
    await reg.get(PROJECT_INTAKE_KIND)({
      id: "JOB-MISS",
      payload: { customer_id: "CUST-X", submission_id: "SUB-X" },
    });
  } catch (err) {
    threw = true;
    ok("error mentions submission id", String(err.message).includes("SUB-X"));
  }
  ok("threw on missing submission", threw);
  check("no transitions attempted", deps._calls.transitions.length, 0);
  check("no enqueue attempted",     deps._calls.enqueued.length, 0);
}

// ─── downstream enqueue failure → submission stays in accepted ────────────

group("handler — downstream enqueue fails → timeline 'error' + submission left in 'accepted'");
{
  const reg = makeRegistry();
  const deps = buildStubs({ enqueueFails: true });
  registerProjectIntakeHandler(reg, deps);
  let threw = false;
  try {
    await reg.get(PROJECT_INTAKE_KIND)({
      id: "JOB-EQFAIL",
      payload: { customer_id: "CUST-0001", submission_id: "SUB-0001" },
    });
  } catch (err) {
    threw = true;
    ok("error from queue surfaces", String(err.message).includes("queue.enqueue failure"));
  }
  ok("threw on enqueue failure", threw);

  // Should have done: lookup, submitted→accepted transition, accepted-event, error-event
  // Should NOT have done: accepted→in_progress transition, phase_change event
  check("1 transition (accepted only)", deps._calls.transitions.length, 1);
  check("transition target was accepted", deps._calls.transitions[0].to, "accepted");
  ok("timeline has error event",
     deps._calls.timeline.some(e => e.kind === "error" && e.note.includes("enqueue failed")));
  ok("timeline does NOT have phase_change event",
     !deps._calls.timeline.some(e => e.kind === "phase_change"));
}

// ─── dep validation ───────────────────────────────────────────────────────

group("registerProjectIntakeHandler — dep validation");
{
  let cnt = 0;
  try { registerProjectIntakeHandler(); } catch { cnt += 1; }
  try { registerProjectIntakeHandler(makeRegistry()); } catch { cnt += 1; }
  try { registerProjectIntakeHandler(makeRegistry(), { portal: { submissions: {} } }); } catch { cnt += 1; }
  try {
    registerProjectIntakeHandler(makeRegistry(), {
      portal: { submissions: { get: () => {} }, transitionSubmission: () => {} },
    });
  } catch { cnt += 1; }
  ok("4 missing-dep variants throw", cnt === 4);
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
