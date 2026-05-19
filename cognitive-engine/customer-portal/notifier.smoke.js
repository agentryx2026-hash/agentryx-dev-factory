/**
 * Phase 19-B smoke test for `createPortalNotifier` (D230).
 *
 *   node cognitive-engine/customer-portal/notifier.smoke.js
 *
 * Covers:
 *   - Dep validation throws on missing/incomplete courier
 *   - onSlaBreached → dispatches a customer.sla_breached Courier event
 *     with the correct type, severity (warn), title, body, meta
 *   - Validation: missing account.id / account.email / submission.id /
 *     submission.target_delivery_at returns ok=false WITHOUT calling
 *     courier.dispatch
 *   - Fail-isolation: courier.dispatch throws → returns {ok:false,error};
 *     does NOT propagate
 *   - Fail-isolation: courier.dispatch returns ok:false → mapped through
 *     into NotifyResult; does NOT throw
 *   - Dropped-event handling: courier returns {ok:true, dropped:true} →
 *     NotifyResult.ok stays true, channels is [], dropped:true
 *   - onLog hook fires for every dispatch outcome (success / dispatch
 *     fail / dispatch throw / dropped)
 *   - D226 stub-strictness: stub courier matches production return
 *     shape (no extra fields the real Courier doesn't return)
 *
 * Uses the real Courier types (via courier/types.js validateEvent) to
 * catch any event-shape regression at test time.
 */

import assert from "node:assert/strict";
import { createPortalNotifier } from "./notifier.js";
import { validateEvent, EVENT_TYPES } from "../courier/types.js";

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
 * Build a stub courier that mirrors production's dispatch return shape:
 *   - On success: { ok:true, event_id, channels_used, deliveries, dropped?, reason? }
 *   - On validation fail: { ok:false, event_id:null, channels_used:[], deliveries:[], error }
 * The stub validates the inbound event against the REAL Courier
 * validateEvent (catches type/severity drift in our notifier code).
 */
function buildCourier(opts = {}) {
  const calls = { dispatched: [] };
  return {
    courier: {
      dispatch: async (event) => {
        calls.dispatched.push(event);
        if (opts.throws) throw new Error("simulated courier.dispatch failure");
        if (opts.returnsError) {
          return { ok: false, event_id: null, channels_used: [], deliveries: [], error: opts.returnsError };
        }
        if (opts.dropped) {
          return { ok: true, event_id: "EVT-DROP", channels_used: [], deliveries: [], dropped: true, reason: opts.dropReason || "no rule" };
        }
        // Real Courier ALWAYS calls validateEvent first; mirror it so
        // any malformed event from the notifier surfaces here.
        const validationError = validateEvent(event);
        if (validationError) {
          return { ok: false, event_id: null, channels_used: [], deliveries: [], error: validationError };
        }
        return {
          ok: true,
          event_id: opts.eventId || "EVT-0001",
          channels_used: opts.channels || ["stdout"],
          deliveries: (opts.channels || ["stdout"]).map(ch => ({ channel: ch, target: null, ok: true })),
        };
      },
    },
    _calls: calls,
  };
}

const ACCOUNT = { id: "CUST-0001", email: "alice@example.com", tier: "free", display_name: "Alice" };
const SUBMISSION = {
  id: "SUB-0001",
  project_title: "Test Project",
  status: "in_progress",
  target_delivery_at: "2026-05-21T16:00:00.000Z",
};

// ─── dep validation ────────────────────────────────────────────────────────

group("createPortalNotifier — dep validation");
{
  let cnt = 0;
  try { createPortalNotifier(); } catch { cnt += 1; }
  try { createPortalNotifier({}); } catch { cnt += 1; }
  try { createPortalNotifier({ courier: {} }); } catch { cnt += 1; }
  try { createPortalNotifier({ courier: { dispatch: "not a function" } }); } catch { cnt += 1; }
  ok("4 invalid-input variants throw", cnt === 4);
}

// ─── event type registered in courier whitelist ────────────────────────────

group("event type registered — customer.sla_breached must be in Courier EVENT_TYPES (D230 prevented dispatch fail)");
{
  ok("customer.sla_breached in EVENT_TYPES", EVENT_TYPES.includes("customer.sla_breached"));
  ok("customer.submission_received in EVENT_TYPES (added for future wiring)", EVENT_TYPES.includes("customer.submission_received"));
  ok("customer.submission_accepted in EVENT_TYPES (added for future wiring)", EVENT_TYPES.includes("customer.submission_accepted"));
  ok("customer.submission_delivered in EVENT_TYPES (added for future wiring)", EVENT_TYPES.includes("customer.submission_delivered"));
  ok("customer.submission_cancelled in EVENT_TYPES (added for future wiring)", EVENT_TYPES.includes("customer.submission_cancelled"));
  ok("customer.submission_rejected in EVENT_TYPES (added for future wiring)", EVENT_TYPES.includes("customer.submission_rejected"));
}

// ─── onSlaBreached happy path ──────────────────────────────────────────────

group("onSlaBreached — happy path → dispatches customer.sla_breached with correct shape");
{
  const logs = [];
  const { courier, _calls } = buildCourier();
  const notifier = createPortalNotifier({ courier, onLog: (l) => logs.push(l) });
  const res = await notifier.onSlaBreached({ account: ACCOUNT, submission: SUBMISSION });

  check("dispatched exactly once",       _calls.dispatched.length, 1);
  check("event type",                    _calls.dispatched[0].type, "customer.sla_breached");
  check("severity = warn",               _calls.dispatched[0].severity, "warn");
  ok("project_id is customer_submission scoped",
     _calls.dispatched[0].project_id === "CUST-0001_SUB-0001");
  ok("title mentions submission id",     String(_calls.dispatched[0].title).includes("SUB-0001"));
  ok("title mentions email",             String(_calls.dispatched[0].title).includes("alice@example.com"));
  ok("title mentions target",            String(_calls.dispatched[0].title).includes("2026-05-21"));
  ok("body is markdown string",          typeof _calls.dispatched[0].body === "string" && _calls.dispatched[0].body.length > 50);
  ok("body mentions project title",      _calls.dispatched[0].body.includes("Test Project"));
  ok("body mentions tier",               _calls.dispatched[0].body.includes("free"));
  check("meta.customer_id",              _calls.dispatched[0].meta.customer_id, "CUST-0001");
  check("meta.submission_id",            _calls.dispatched[0].meta.submission_id, "SUB-0001");
  check("meta.tier",                     _calls.dispatched[0].meta.tier, "free");
  check("meta.target_delivery_at",       _calls.dispatched[0].meta.target_delivery_at, "2026-05-21T16:00:00.000Z");
  check("meta.submission_status",        _calls.dispatched[0].meta.submission_status, "in_progress");

  // Real Courier validation must pass on our generated event.
  check("event passes Courier validateEvent", validateEvent(_calls.dispatched[0]), null);

  // Result shape
  ok("result.ok === true",               res.ok === true);
  check("result.event_id",               res.event_id, "EVT-0001");
  check("result.channels",               res.channels, ["stdout"]);
  ok("result.dropped is false",          res.dropped === false);

  ok("log fired once",                   logs.length === 1);
  ok("log mentions success + event id",  logs[0].includes("EVT-0001") && logs[0].includes("dispatched"));
}

// ─── input validation: missing fields → no dispatch ────────────────────────

group("onSlaBreached — input validation rejects bad input WITHOUT calling courier");
{
  const { courier, _calls } = buildCourier();
  const notifier = createPortalNotifier({ courier });

  const r1 = await notifier.onSlaBreached();
  ok("missing input → ok:false",        r1.ok === false);
  ok("missing input has error",         typeof r1.error === "string" && r1.error.length > 0);

  const r2 = await notifier.onSlaBreached({ account: { id: "CUST-1" }, submission: SUBMISSION });
  ok("missing account.email → ok:false", r2.ok === false);

  const r3 = await notifier.onSlaBreached({ account: ACCOUNT, submission: { id: "SUB-X" } });
  ok("missing target_delivery_at → ok:false", r3.ok === false);

  const r4 = await notifier.onSlaBreached({ account: ACCOUNT, submission: { target_delivery_at: "X" } });
  ok("missing submission.id → ok:false", r4.ok === false);

  check("no dispatches attempted on bad input", _calls.dispatched.length, 0);
}

// ─── fail-isolation: courier.dispatch THROWS ───────────────────────────────

group("onSlaBreached — courier.dispatch throws → ok:false with error, NOT thrown");
{
  const logs = [];
  const { courier, _calls } = buildCourier({ throws: true });
  const notifier = createPortalNotifier({ courier, onLog: (l) => logs.push(l) });

  let didThrow = false;
  let res;
  try {
    res = await notifier.onSlaBreached({ account: ACCOUNT, submission: SUBMISSION });
  } catch { didThrow = true; }
  ok("notifier did NOT throw",          didThrow === false);
  ok("result.ok === false",              res.ok === false);
  ok("result.error captured",            typeof res.error === "string" && res.error.includes("simulated"));
  check("courier was called",            _calls.dispatched.length, 1);
  ok("log mentions throw",               logs.some(l => l.includes("threw")));
}

// ─── fail-isolation: courier.dispatch returns ok:false ─────────────────────

group("onSlaBreached — courier returns ok:false → mapped through NotifyResult");
{
  const logs = [];
  const { courier } = buildCourier({ returnsError: "validation: bad" });
  const notifier = createPortalNotifier({ courier, onLog: (l) => logs.push(l) });
  const res = await notifier.onSlaBreached({ account: ACCOUNT, submission: SUBMISSION });
  ok("result.ok === false",        res.ok === false);
  ok("error surfaces from courier", String(res.error).includes("validation: bad"));
  ok("log mentions failed",         logs.some(l => l.includes("failed")));
}

// ─── dropped events ────────────────────────────────────────────────────────

group("onSlaBreached — courier drops event (no rule / severity threshold) → ok:true + dropped:true");
{
  const logs = [];
  const { courier } = buildCourier({ dropped: true, dropReason: "severity info below warn" });
  const notifier = createPortalNotifier({ courier, onLog: (l) => logs.push(l) });
  const res = await notifier.onSlaBreached({ account: ACCOUNT, submission: SUBMISSION });
  ok("result.ok === true (dropped is not an error)", res.ok === true);
  ok("result.dropped === true",     res.dropped === true);
  check("channels empty when dropped", res.channels, []);
  ok("log mentions dropped",          logs.some(l => l.includes("dropped")));
}

// ─── D231 — onSubmitted (HTTP /submit wiring) ──────────────────────────────

group("onSubmitted — happy path → dispatches customer.submission_received");
{
  const logs = [];
  const { courier, _calls } = buildCourier();
  const notifier = createPortalNotifier({ courier, onLog: (l) => logs.push(l) });
  const res = await notifier.onSubmitted({
    account: ACCOUNT,
    submission: { ...SUBMISSION, status: "submitted" },
  });

  check("dispatched once",                   _calls.dispatched.length, 1);
  check("event type",                        _calls.dispatched[0].type, "customer.submission_received");
  check("severity = info",                   _calls.dispatched[0].severity, "info");
  check("project_id customer_sub scoped",    _calls.dispatched[0].project_id, "CUST-0001_SUB-0001");
  ok("title mentions submission id",         _calls.dispatched[0].title.includes("SUB-0001"));
  ok("title mentions email",                 _calls.dispatched[0].title.includes("alice@example.com"));
  ok("title mentions project_title",         _calls.dispatched[0].title.includes("Test Project"));
  ok("body mentions tier",                   _calls.dispatched[0].body.includes("free"));
  ok("body mentions intake handler",         _calls.dispatched[0].body.includes("project_intake"));
  check("meta.customer_id",                  _calls.dispatched[0].meta.customer_id, "CUST-0001");
  check("meta.submission_id",                _calls.dispatched[0].meta.submission_id, "SUB-0001");
  check("meta.submission_status = submitted",_calls.dispatched[0].meta.submission_status, "submitted");
  check("event passes Courier validateEvent",validateEvent(_calls.dispatched[0]), null);
  ok("result.ok",                            res.ok === true);
  ok("log fired once",                       logs.length === 1);
}

group("onSubmitted — input validation");
{
  const { courier, _calls } = buildCourier();
  const notifier = createPortalNotifier({ courier });
  const r1 = await notifier.onSubmitted();
  ok("no input → ok:false", r1.ok === false);
  const r2 = await notifier.onSubmitted({ account: { id: "X" }, submission: SUBMISSION });
  ok("missing account.email → ok:false", r2.ok === false);
  const r3 = await notifier.onSubmitted({ account: ACCOUNT, submission: { id: "S" } });
  ok("missing target_delivery_at → ok:false", r3.ok === false);
  check("no dispatches on bad input", _calls.dispatched.length, 0);
}

group("onSubmitted — courier.dispatch throws → fail-isolated");
{
  const { courier } = buildCourier({ throws: true });
  const notifier = createPortalNotifier({ courier });
  let didThrow = false;
  let res;
  try { res = await notifier.onSubmitted({ account: ACCOUNT, submission: SUBMISSION }); }
  catch { didThrow = true; }
  ok("did not throw",      didThrow === false);
  ok("result.ok === false", res.ok === false);
}

// ─── D231 — onCancelled (HTTP /cancel wiring) ──────────────────────────────

group("onCancelled — happy path → dispatches customer.submission_cancelled with note");
{
  const logs = [];
  const { courier, _calls } = buildCourier();
  const notifier = createPortalNotifier({ courier, onLog: (l) => logs.push(l) });
  const res = await notifier.onCancelled({
    account: ACCOUNT,
    submission: { ...SUBMISSION, status: "cancelled" },
    note: "scope changed; will resubmit later",
  });

  check("dispatched once",                   _calls.dispatched.length, 1);
  check("event type",                        _calls.dispatched[0].type, "customer.submission_cancelled");
  check("severity = info",                   _calls.dispatched[0].severity, "info");
  ok("title mentions cancelled + email",     _calls.dispatched[0].title.includes("cancelled") && _calls.dispatched[0].title.includes("alice@example.com"));
  ok("body mentions customer note",          _calls.dispatched[0].body.includes("scope changed; will resubmit later"));
  check("meta.cancel_note carried",          _calls.dispatched[0].meta.cancel_note, "scope changed; will resubmit later");
  check("event passes Courier validateEvent",validateEvent(_calls.dispatched[0]), null);
  ok("result.ok",                            res.ok === true);
}

group("onCancelled — no note → body shows '(none provided)' + meta.cancel_note = null");
{
  const { courier, _calls } = buildCourier();
  const notifier = createPortalNotifier({ courier });
  await notifier.onCancelled({ account: ACCOUNT, submission: { ...SUBMISSION, status: "cancelled" } });
  ok("body shows (none provided)", _calls.dispatched[0].body.includes("(none provided)"));
  ok("meta.cancel_note = null",    _calls.dispatched[0].meta.cancel_note === null);
}

group("onCancelled — input validation");
{
  const { courier, _calls } = buildCourier();
  const notifier = createPortalNotifier({ courier });
  const r1 = await notifier.onCancelled();
  ok("no input → ok:false", r1.ok === false);
  const r2 = await notifier.onCancelled({ account: ACCOUNT });
  ok("missing submission → ok:false", r2.ok === false);
  const r3 = await notifier.onCancelled({ account: ACCOUNT, submission: { project_title: "x" } });
  ok("missing submission.id → ok:false", r3.ok === false);
  check("no dispatches on bad input", _calls.dispatched.length, 0);
}

// ─── surface — D231 ships expand the export set ────────────────────────────

group("notifier surface — D231 ships onSubmitted + onCancelled (D232+ still pending)");
{
  const { courier } = buildCourier();
  const notifier = createPortalNotifier({ courier });
  ok("onSlaBreached is a function", typeof notifier.onSlaBreached === "function");
  ok("onSubmitted is a function (D231 new)", typeof notifier.onSubmitted === "function");
  ok("onCancelled is a function (D231 new)", typeof notifier.onCancelled === "function");
  ok("onAccepted not exported (D232)", typeof notifier.onAccepted !== "function");
  ok("onDelivered not exported (D232)", typeof notifier.onDelivered !== "function");
  ok("onRejected not exported (D233)",  typeof notifier.onRejected !== "function");
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
