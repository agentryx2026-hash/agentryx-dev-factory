/**
 * Phase 19-B HTTP-surface integration smoke test.
 *
 *   node cognitive-engine/customer-portal/http-integration.smoke.js
 *
 * The HTTP routes themselves are thin glue in factory-dashboard/server/
 * telemetry.mjs (URL pattern → portal call → JSON response). The
 * substantive logic worth testing is:
 *   (1) Auto-enqueue of project_intake after a successful submitProject —
 *       must produce a queue job with customer-prefixed project_id and
 *       the {customer_id, submission_id} payload that the project_intake
 *       handler expects.
 *   (2) Bearer-token extraction from various Authorization header shapes.
 *   (3) Portal error code → HTTP status mapping.
 *
 * Uses a REAL Phase 19-A portal + REAL Phase 14-A queue in a tmpfs root
 * — no HTTP server spin-up. Re-implements the auto-enqueue stanza
 * from telemetry.mjs so the integration's correctness is verified
 * without coupling the test to telemetry.mjs's structure.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCustomerPortal } from "./portal.js";
import { createQueue } from "../concurrency/queue.js";

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

// ─── extractBearerToken (lifted from telemetry.mjs) ────────────────────────

function extractBearerToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!auth || typeof auth !== 'string') return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

group("extractBearerToken");
{
  check("lowercase 'authorization'", extractBearerToken({ headers: { authorization: "Bearer abc123" } }), "abc123");
  check("title-case 'Authorization'", extractBearerToken({ headers: { Authorization: "Bearer XYZ" } }), "XYZ");
  check("case-insensitive scheme",    extractBearerToken({ headers: { authorization: "bearer  spaced" } }), "spaced");
  check("missing header → null",      extractBearerToken({ headers: {} }), null);
  check("empty value → null",         extractBearerToken({ headers: { authorization: "" } }), null);
  check("wrong scheme → null",        extractBearerToken({ headers: { authorization: "Basic abc" } }), null);
  check("trims surrounding spaces",   extractBearerToken({ headers: { authorization: "Bearer    padded   " } }), "padded");
}

// ─── portalErrorToHttp (lifted; tests the code → status mapping) ───────────

function portalErrorToHttp(err) {
  const code = err?.code || 'INTERNAL';
  return {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    QUOTA_EXCEEDED: 429,
    VALIDATION: 400,
  }[code] || 500;
}

group("portalErrorToHttp — code mapping");
{
  check("UNAUTHORIZED → 401",    portalErrorToHttp({ code: "UNAUTHORIZED" }), 401);
  check("FORBIDDEN → 403",       portalErrorToHttp({ code: "FORBIDDEN" }), 403);
  check("NOT_FOUND → 404",       portalErrorToHttp({ code: "NOT_FOUND" }), 404);
  check("QUOTA_EXCEEDED → 429",  portalErrorToHttp({ code: "QUOTA_EXCEEDED" }), 429);
  check("VALIDATION → 400",      portalErrorToHttp({ code: "VALIDATION" }), 400);
  check("unknown code → 500",    portalErrorToHttp({ code: "WAT" }), 500);
  check("no code → 500",         portalErrorToHttp({}), 500);
  check("plain Error → 500",     portalErrorToHttp(new Error("oops")), 500);
}

// ─── Full integration: register → submit → auto-enqueue → status ──────────

const TMP = await fsp.mkdtemp(path.join(os.tmpdir(), "cust-http-smoke-"));
const portal = createCustomerPortal({ rootDir: TMP });
const queue = createQueue(TMP);

group("integration — register customer (admin path)");
let CUST_TOKEN, CUST_ID;
{
  const result = await portal.registerCustomer({ email: "alice@test.dev", display_name: "Alice", tier: "starter" });
  ok("returns customer + token", result.account && result.token);
  ok("customer has CUST-* id", /^CUST-\d{4}$/.test(result.account.id));
  check("tier preserved", result.account.tier, "starter");
  CUST_TOKEN = result.token;
  CUST_ID = result.account.id;
}

group("integration — submit + auto-enqueue (the HTTP route's substantive logic)");
{
  // Simulate what the POST /submit route does internally:
  //   1. portal.submitProject(token, payload)
  //   2. Resolve customer_id from the submission record
  //   3. queue.enqueue({kind: 'project_intake', project_id: customer_<sub_id>, payload, priority, max_attempts})
  const receipt = await portal.submitProject(CUST_TOKEN, {
    project_title: "TodoApp",
    intake_payload: "Build a TODO API with auth + 3 tests",
    tags: ["api"],
  });
  ok("receipt has submission_id (SUB-*)", /^SUB-\d{4}$/.test(receipt.submission_id));
  check("receipt status submitted", receipt.status, "submitted");
  check("receipt tier echoed", receipt.tier, "starter");
  ok("receipt has target_delivery_at", typeof receipt.target_delivery_at === "string");

  // Auto-enqueue mirror:
  const account = await portal.accounts.authenticate(CUST_TOKEN);
  ok("auth resolves account", account?.id === CUST_ID);
  const sub = await portal.submissions.get(account.id, receipt.submission_id);
  ok("submission record fetched", sub?.id === receipt.submission_id);

  const job = await queue.enqueue({
    kind: "project_intake",
    project_id: `${sub.customer_id}_${receipt.submission_id}`,
    payload: { customer_id: sub.customer_id, submission_id: receipt.submission_id },
    priority: 40,
    max_attempts: 2,
  });
  ok("queue job created", /^JOB-\d{4}$/.test(job.id));
  check("job kind", job.kind, "project_intake");
  check("project_id customer-prefixed",
        job.project_id, `${CUST_ID}_${receipt.submission_id}`);
  check("payload threads customer_id", job.payload.customer_id, CUST_ID);
  check("payload threads submission_id", job.payload.submission_id, receipt.submission_id);
  check("priority = 40 (between architect 30 and pre_dev 50)", job.priority, 40);
}

group("integration — list submissions + get status");
{
  const list = await portal.listMyProjects(CUST_TOKEN, {});
  ok("list has ≥1 entry", list.length >= 1);
  const sid = list[0].id;
  const status = await portal.getStatus(CUST_TOKEN, sid);
  ok("status has submission", !!status.submission);
  ok("status has timeline", Array.isArray(status.timeline));
  ok("status has sla_status", !!status.sla_status);
  ok("timeline has 'submitted' event", status.timeline.some(e => e.kind === "submitted"));
}

group("integration — cancel submission");
{
  const list = await portal.listMyProjects(CUST_TOKEN, {});
  const sid = list[0].id;
  const cancelled = await portal.cancelSubmission(CUST_TOKEN, sid, { note: "founder testing" });
  check("status now 'cancelled'", cancelled.status, "cancelled");
  // After cancel, the same submission should NOT be cancellable again.
  let threw = false;
  try { await portal.cancelSubmission(CUST_TOKEN, sid, {}); } catch (err) { threw = true; }
  ok("re-cancel throws", threw);
}

group("integration — auth errors surface portal codes");
{
  // Bad token → UNAUTHORIZED
  let err1;
  try { await portal.submitProject("not-a-real-token", { project_title: "x", intake_payload: "y" }); }
  catch (e) { err1 = e; }
  ok("bad token throws portal error", !!err1);
  ok("portal error has UNAUTHORIZED code", err1?.code === "UNAUTHORIZED");
  check("portalErrorToHttp(unauth) → 401", portalErrorToHttp(err1), 401);

  // Missing required fields → VALIDATION
  let err2;
  try { await portal.submitProject(CUST_TOKEN, { project_title: "" }); }
  catch (e) { err2 = e; }
  ok("invalid payload throws", !!err2);
  ok("VALIDATION code", err2?.code === "VALIDATION");
  check("portalErrorToHttp(validation) → 400", portalErrorToHttp(err2), 400);
}

group("integration — quota enforcement (starter tier = 5 active max)");
{
  // Register a fresh customer to control quota state cleanly
  const { token: t, account: c } = await portal.registerCustomer({ email: "quota@test.dev", display_name: "Quotalady", tier: "free" });
  // free tier max_active = 1; submit one → ok, second should hit quota
  await portal.submitProject(t, { project_title: "p1", intake_payload: "1" });
  let err;
  try { await portal.submitProject(t, { project_title: "p2", intake_payload: "2" }); }
  catch (e) { err = e; }
  ok("free tier 2nd submission hits quota", !!err);
  check("code QUOTA_EXCEEDED", err?.code, "QUOTA_EXCEEDED");
  check("portalErrorToHttp(quota) → 429", portalErrorToHttp(err), 429);
}

// Cleanup
await fsp.rm(TMP, { recursive: true, force: true });

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
