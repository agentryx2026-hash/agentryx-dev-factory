/**
 * Phase 19-B smoke test for `wrapForCustomerBackfeed`.
 *
 *   node cognitive-engine/concurrency/handlers/customer-backfeed-wrapper.smoke.js
 *
 * Stubs the Phase 19-A portal so the test runs in-process with no
 * filesystem. Covers the wrapper contract from D227:
 *   - Inner handler always runs; its result always propagates.
 *   - Jobs without customer_id/submission_id pass through untouched.
 *   - finalKind (default "pre_dev") triggers in_progress → delivered
 *     and records a `delivered` timeline event.
 *   - phaseKinds (default ["dev","post_dev"]) record a `phase_completed`
 *     event only — no transition.
 *   - Unrecognised kinds: no transition, no event.
 *   - Terminal-status short-circuit (delivered / rejected / cancelled):
 *     no transition attempted, no event recorded.
 *   - Fail-isolation: a back-feed transition error does NOT propagate
 *     to the queue — inner-handler result is still returned.
 *   - Stub validates every recorded event against TIMELINE_EVENT_KINDS
 *     (D226 lesson: lax stubs let real validation errors slip through).
 *   - Custom finalKind / phaseKinds at registration time override defaults.
 *   - Dep validation throws on bad inputs.
 */

import assert from "node:assert/strict";
import { wrapForCustomerBackfeed, DEFAULT_FINAL_KIND, DEFAULT_PHASE_KINDS } from "./customer-backfeed-wrapper.js";
import { TIMELINE_EVENT_KINDS } from "../../customer-portal/types.js";

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
 * Build stub deps. `initialStatus` controls what the portal reports for
 * a submission lookup. `transitionFails` simulates a portal failure.
 * `lookupFails` simulates a portal lookup throw. `submissionMissing`
 * makes the lookup return null.
 */
function buildStubs(opts = {}) {
  const calls = {
    transitions: [],
    timeline: [],
    lookups: [],
    logs: [],
    innerInvocations: [],
  };
  let submissionStatus = opts.initialStatus || "in_progress";
  const portal = {
    submissions: {
      get: async (cid, sid) => {
        calls.lookups.push({ cid, sid });
        if (opts.lookupFails) throw new Error("simulated submissions.get failure");
        if (opts.submissionMissing) return null;
        return {
          id: sid,
          customer_id: cid,
          status: submissionStatus,
          intake_payload: "test intake",
        };
      },
    },
    transitionSubmission: async (cid, sid, to, opts2) => {
      calls.transitions.push({ cid, sid, to, opts: opts2 });
      if (opts.transitionFails) throw new Error("simulated transition failure");
      submissionStatus = to;
    },
    recordTimelineEvent: async (cid, sid, event) => {
      // STRICT validation: catches typos (D226 lesson).
      if (!TIMELINE_EVENT_KINDS.includes(event.kind)) {
        throw new Error(`invalid timeline event kind: '${event.kind}' (valid: ${TIMELINE_EVENT_KINDS.join(", ")})`);
      }
      if (opts.timelineFails) throw new Error("simulated timeline failure");
      calls.timeline.push({ cid, sid, ...event });
    },
  };
  const innerHandler = async (job, ctx) => {
    calls.innerInvocations.push({ job, ctx });
    if (opts.innerThrows) throw new Error("simulated inner-handler failure");
    return { ok: true, job_id: job.id, kind: job.kind };
  };
  return {
    portal,
    innerHandler,
    onLog: (line, jobId) => calls.logs.push({ jobId, line }),
    _calls: calls,
  };
}

// ─── module exports ────────────────────────────────────────────────────────

group("module — exports + defaults");
{
  check("DEFAULT_FINAL_KIND", DEFAULT_FINAL_KIND, "pre_dev");
  check("DEFAULT_PHASE_KINDS", DEFAULT_PHASE_KINDS, ["dev", "post_dev"]);
  ok("wrapForCustomerBackfeed is a function", typeof wrapForCustomerBackfeed === "function");
}

// ─── dep validation ────────────────────────────────────────────────────────

group("wrapForCustomerBackfeed — dep validation");
{
  let cnt = 0;
  try { wrapForCustomerBackfeed(); } catch { cnt += 1; }                          // no inner
  try { wrapForCustomerBackfeed("not a function"); } catch { cnt += 1; }          // bad inner
  try { wrapForCustomerBackfeed(async () => {}); } catch { cnt += 1; }            // no deps.portal
  try { wrapForCustomerBackfeed(async () => {}, { portal: {} }); } catch { cnt += 1; } // portal missing methods
  try {
    wrapForCustomerBackfeed(async () => {}, {
      portal: { submissions: {} },  // missing .get
    });
  } catch { cnt += 1; }
  ok("5 invalid-input variants throw", cnt === 5);
}

// ─── inner handler always runs + result propagates ─────────────────────────

group("wrapper — inner handler runs unchanged + result propagates");
{
  const deps = buildStubs();
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  const result = await wrapped(
    { id: "JOB-X", kind: "pre_dev", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } },
    { tracer: "ctx" },
  );
  check("inner invoked once", deps._calls.innerInvocations.length, 1);
  check("inner saw the job", deps._calls.innerInvocations[0].job.id, "JOB-X");
  check("inner saw ctx",     deps._calls.innerInvocations[0].ctx, { tracer: "ctx" });
  check("result propagated", result, { ok: true, job_id: "JOB-X", kind: "pre_dev" });
}

// ─── inner-handler failure: short-circuits, no back-feed ──────────────────

group("wrapper — inner handler throws → propagates, no back-feed attempt");
{
  const deps = buildStubs({ innerThrows: true });
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  let threw = false;
  try {
    await wrapped({ id: "JOB-FAIL", kind: "pre_dev", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } }, {});
  } catch (err) {
    threw = true;
    ok("inner error surfaces verbatim", String(err.message).includes("simulated inner-handler failure"));
  }
  ok("threw out of wrapper", threw);
  check("no submission lookup attempted", deps._calls.lookups.length, 0);
  check("no transitions attempted",       deps._calls.transitions.length, 0);
  check("no timeline events recorded",    deps._calls.timeline.length, 0);
}

// ─── job without customer refs: pass through, no portal interaction ───────

group("wrapper — job without customer_id/submission_id → pass through, portal untouched");
{
  const deps = buildStubs();
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  const result = await wrapped(
    { id: "JOB-PIPELINE", kind: "pre_dev", payload: { task: "regular factory work" } },
    {},
  );
  check("result still returned", result, { ok: true, job_id: "JOB-PIPELINE", kind: "pre_dev" });
  check("no lookup",      deps._calls.lookups.length, 0);
  check("no transitions", deps._calls.transitions.length, 0);
  check("no timeline",    deps._calls.timeline.length, 0);
}

group("wrapper — job with only customer_id (no submission_id) → pass through");
{
  const deps = buildStubs();
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  await wrapped({ id: "X", kind: "pre_dev", payload: { customer_id: "CUST-1" } }, {});
  check("no lookup", deps._calls.lookups.length, 0);
}

// ─── happy path — finalKind (pre_dev) → in_progress → delivered ───────────

group("wrapper — finalKind (pre_dev) on in_progress submission → delivered + delivered event");
{
  const deps = buildStubs({ initialStatus: "in_progress" });
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  const result = await wrapped(
    { id: "JOB-PD-1", kind: "pre_dev", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } },
    {},
  );
  check("inner result still propagates", result, { ok: true, job_id: "JOB-PD-1", kind: "pre_dev" });
  check("submission looked up once",     deps._calls.lookups.length, 1);
  check("lookup args",                   deps._calls.lookups[0], { cid: "CUST-1", sid: "SUB-1" });
  check("1 transition fired",            deps._calls.transitions.length, 1);
  check("transition target = delivered", deps._calls.transitions[0].to, "delivered");
  ok("transition patches delivered_by_job_id",
     deps._calls.transitions[0].opts?.patch?.delivered_by_job_id === "JOB-PD-1");
  check("1 timeline event recorded", deps._calls.timeline.length, 1);
  check("event kind = delivered",    deps._calls.timeline[0].kind, "delivered");
  ok("event references job id",      String(deps._calls.timeline[0].note).includes("JOB-PD-1"));
  ok("log includes 'delivered'",     deps._calls.logs.some(l => l.line.includes("delivered")));
}

// ─── intermediate phase kinds (dev / post_dev) → phase_completed only ─────

group("wrapper — phase kind 'dev' on in_progress submission → phase_completed event only (no transition)");
{
  const deps = buildStubs({ initialStatus: "in_progress" });
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  await wrapped(
    { id: "JOB-DEV-1", kind: "dev", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } },
    {},
  );
  check("no transitions fired",       deps._calls.transitions.length, 0);
  check("1 timeline event",           deps._calls.timeline.length, 1);
  check("event kind = phase_completed", deps._calls.timeline[0].kind, "phase_completed");
  check("event.phase = dev",          deps._calls.timeline[0].phase, "dev");
  ok("event uses valid kind",         TIMELINE_EVENT_KINDS.includes(deps._calls.timeline[0].kind));
}

group("wrapper — phase kind 'post_dev' on in_progress submission → phase_completed event only");
{
  const deps = buildStubs({ initialStatus: "in_progress" });
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  await wrapped(
    { id: "JOB-POSTDEV-1", kind: "post_dev", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } },
    {},
  );
  check("no transitions",           deps._calls.transitions.length, 0);
  check("1 timeline event",         deps._calls.timeline.length, 1);
  check("kind = phase_completed",   deps._calls.timeline[0].kind, "phase_completed");
  check("phase = post_dev",         deps._calls.timeline[0].phase, "post_dev");
}

// ─── unrecognised kind → no transition, no event ──────────────────────────

group("wrapper — unrecognised kind ('architect_research') → no transition, no event");
{
  const deps = buildStubs({ initialStatus: "in_progress" });
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  await wrapped(
    { id: "JOB-AR-1", kind: "architect_research", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } },
    {},
  );
  check("no transitions", deps._calls.transitions.length, 0);
  check("no timeline events", deps._calls.timeline.length, 0);
  ok("log mentions skip",     deps._calls.logs.some(l => l.line.includes("no submission action")));
}

// ─── terminal-status short-circuits (idempotency) ─────────────────────────

for (const terminal of ["delivered", "rejected", "cancelled"]) {
  group(`wrapper — submission already '${terminal}' → no transition, no event, no error`);
  {
    const deps = buildStubs({ initialStatus: terminal });
    const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
    const result = await wrapped(
      { id: `JOB-${terminal}`, kind: "pre_dev", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } },
      {},
    );
    check("inner result still returned", result, { ok: true, job_id: `JOB-${terminal}`, kind: "pre_dev" });
    check("looked up once", deps._calls.lookups.length, 1);
    check("0 transitions",  deps._calls.transitions.length, 0);
    check("0 timeline",     deps._calls.timeline.length, 0);
    ok("log mentions skip", deps._calls.logs.some(l => l.line.includes(`already terminal (${terminal})`)));
  }
}

// ─── submission missing → log + pass through ──────────────────────────────

group("wrapper — submission not found → log, inner result returned, no transition");
{
  const deps = buildStubs({ submissionMissing: true });
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  const result = await wrapped(
    { id: "JOB-MISS", kind: "pre_dev", payload: { customer_id: "CUST-X", submission_id: "SUB-X" } },
    {},
  );
  check("inner result returned", result, { ok: true, job_id: "JOB-MISS", kind: "pre_dev" });
  check("0 transitions",         deps._calls.transitions.length, 0);
  check("0 timeline",             deps._calls.timeline.length, 0);
  ok("log notes missing submission", deps._calls.logs.some(l => l.line.includes("not found")));
}

// ─── submission lookup throws → fail-isolated ─────────────────────────────

group("wrapper — submission lookup throws → inner result returned, error logged, no propagation");
{
  const deps = buildStubs({ lookupFails: true });
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  let threw = false;
  let result;
  try {
    result = await wrapped(
      { id: "JOB-LU", kind: "pre_dev", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } },
      {},
    );
  } catch { threw = true; }
  ok("did NOT throw out of wrapper", !threw);
  check("inner result still returned", result, { ok: true, job_id: "JOB-LU", kind: "pre_dev" });
  check("0 transitions attempted",     deps._calls.transitions.length, 0);
  ok("log mentions lookup failure",    deps._calls.logs.some(l => l.line.includes("lookup failed")));
}

// ─── transition throws → fail-isolated (D227 — queue must still see done) ─

group("wrapper — transitionSubmission throws → inner result returned, no propagation");
{
  const deps = buildStubs({ initialStatus: "in_progress", transitionFails: true });
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  let threw = false;
  let result;
  try {
    result = await wrapped(
      { id: "JOB-T-FAIL", kind: "pre_dev", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } },
      {},
    );
  } catch { threw = true; }
  ok("did NOT throw out of wrapper", !threw);
  check("inner result still returned", result, { ok: true, job_id: "JOB-T-FAIL", kind: "pre_dev" });
  check("1 transition attempted (the one that failed)", deps._calls.transitions.length, 1);
  ok("log mentions transition FAILED",  deps._calls.logs.some(l => l.line.includes("transition FAILED")));
}

// ─── timeline record throws → fail-isolated ───────────────────────────────

group("wrapper — recordTimelineEvent throws on phase kind → inner result returned, no propagation");
{
  const deps = buildStubs({ initialStatus: "in_progress", timelineFails: true });
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  let threw = false;
  let result;
  try {
    result = await wrapped(
      { id: "JOB-TL-FAIL", kind: "dev", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } },
      {},
    );
  } catch { threw = true; }
  ok("did NOT throw out of wrapper", !threw);
  check("inner result still returned", result, { ok: true, job_id: "JOB-TL-FAIL", kind: "dev" });
  ok("log mentions transition FAILED",  deps._calls.logs.some(l => l.line.includes("transition FAILED")));
}

// ─── custom finalKind / phaseKinds override defaults ──────────────────────

group("wrapper — custom finalKind='post_dev' → 'pre_dev' becomes intermediate phase");
{
  const deps = buildStubs({ initialStatus: "in_progress" });
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, {
    portal: deps.portal,
    finalKind: "post_dev",
    phaseKinds: ["pre_dev", "dev"],
    onLog: deps.onLog,
  });

  // pre_dev should now be a phase event, not a transition.
  await wrapped(
    { id: "JOB-1", kind: "pre_dev", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } },
    {},
  );
  check("pre_dev did NOT transition", deps._calls.transitions.length, 0);
  check("pre_dev recorded phase_completed", deps._calls.timeline[0].kind, "phase_completed");
  check("phase = pre_dev",            deps._calls.timeline[0].phase, "pre_dev");

  // post_dev should now trigger the delivered transition.
  await wrapped(
    { id: "JOB-2", kind: "post_dev", payload: { customer_id: "CUST-1", submission_id: "SUB-1" } },
    {},
  );
  check("post_dev fired 1 transition", deps._calls.transitions.length, 1);
  check("transition target = delivered", deps._calls.transitions[0].to, "delivered");
  ok("2nd timeline event = delivered", deps._calls.timeline[1].kind === "delivered");
}

// ─── all recorded timeline events use valid kinds (D226 guard) ────────────

group("wrapper — every recorded timeline event uses a valid TIMELINE_EVENT_KINDS entry");
{
  const deps = buildStubs({ initialStatus: "in_progress" });
  const wrapped = wrapForCustomerBackfeed(deps.innerHandler, { portal: deps.portal, onLog: deps.onLog });
  // Fire one of each branch that records an event.
  await wrapped({ id: "A", kind: "pre_dev",  payload: { customer_id: "C", submission_id: "S" } }, {});
  // Reset internal status for next iteration (the first one moved it to delivered).
  // Build a fresh deps to avoid terminal short-circuit for the next two assertions.
  const deps2 = buildStubs({ initialStatus: "in_progress" });
  const wrapped2 = wrapForCustomerBackfeed(deps2.innerHandler, { portal: deps2.portal, onLog: deps2.onLog });
  await wrapped2({ id: "B", kind: "dev",      payload: { customer_id: "C", submission_id: "S" } }, {});
  await wrapped2({ id: "C", kind: "post_dev", payload: { customer_id: "C", submission_id: "S" } }, {});
  const allEvents = [...deps._calls.timeline, ...deps2._calls.timeline];
  ok("≥ 3 events recorded across branches", allEvents.length >= 3);
  ok("every event kind is in TIMELINE_EVENT_KINDS",
     allEvents.every(e => TIMELINE_EVENT_KINDS.includes(e.kind)));
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
