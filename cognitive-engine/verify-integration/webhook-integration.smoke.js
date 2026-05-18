/**
 * Phase 9-B substrate — webhook-integration smoke test.
 *
 *   node cognitive-engine/verify-integration/webhook-integration.smoke.js
 *
 * The HTTP handler in factory-dashboard/server/telemetry.mjs combines four
 * pieces:
 *   (1) validateFeedbackPayload — reject bad input
 *   (2) handleFeedback — write user_note observation + plan FixRoute
 *   (3) append to verify_feedback.jsonl — append-only audit log
 *   (4) tail-read of the same JSONL — fuel the Verify panel UI
 *
 * This smoke test reproduces (1)→(4) in-process so the wire path is
 * exercised without spinning up the HTTP server. Uses a tmp dir for
 * both the memory layer and the feedback log.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateFeedbackPayload } from "./types.js";
import { handleFeedback } from "./feedback-receiver.js";

let passed = 0, failed = 0;
function check(label, actual, expected) {
  try { assert.deepEqual(actual, expected); console.log(`  ✓ ${label}`); passed += 1; }
  catch { console.log(`  ✗ ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`); failed += 1; }
}
function ok(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); passed += 1; }
  else      { console.log(`  ✗ ${label}`); failed += 1; }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "verify-webhook-smoke-"));
const LOG = path.join(TMP, "verify_feedback.jsonl");

const fakeMemory = {
  observations: [],
  async addObservation(o) {
    const id = `OBS-${this.observations.length + 1}`;
    const record = { id, ...o };
    this.observations.push(record);
    return record;
  },
};

// Reproduce the telemetry webhook handler's logic.
async function webhookHandler(body) {
  const project_id = body.project_id || "unknown";
  const { project_id: _drop, ...payload } = body;
  const vErr = validateFeedbackPayload(payload);
  if (vErr) return { status: 400, body: { error: vErr } };
  const result = await handleFeedback(payload, { memory: fakeMemory, projectId: project_id });
  const record = {
    received_at: new Date().toISOString(),
    project_id,
    build_id: payload.build_id,
    decision: payload.decision,
    reviewer: payload.reviewer,
    review_item_id: payload.review_item_id || null,
    comments_preview: (payload.comments || "").slice(0, 200),
    ok: result.ok,
    route_lane: result.route?.lane || null,
    route_agent: result.route?.agent || null,
    observation_id: result.observation_id || null,
    error: result.error || null,
  };
  fs.appendFileSync(LOG, JSON.stringify(record) + "\n");
  if (!result.ok) return { status: 400, body: { error: result.error } };
  return { status: 200, body: { ok: true, observation_id: result.observation_id, route: result.route } };
}

// ─── invalid payload → 400, no log entry ────────────────────────────────────

console.log("\n[invalid payload]");
{
  const r = await webhookHandler({ reviewer: "rev@x", reviewed_at: "2026-05-10T00:00:00Z" }); // missing build_id + decision
  check("status 400", r.status, 400);
  ok("error mentions build_id", String(r.body.error).includes("build_id"));
  ok("no log file written yet", !fs.existsSync(LOG));
}

// ─── valid pass → 200, log written, no route ────────────────────────────────

console.log("\n[valid pass]");
{
  const r = await webhookHandler({
    project_id: "2026-05-10_blog",
    build_id: "pre-dev-2026-05-10-abc",
    decision: "pass",
    reviewer: "founder@agentryx.dev",
    reviewed_at: new Date().toISOString(),
  });
  check("status 200", r.status, 200);
  ok("route lane is none", r.body.route.lane === "none");
  ok("observation persisted", fakeMemory.observations.length === 1);
  ok("observation scoped to project", fakeMemory.observations[0].scope === "project:2026-05-10_blog");
  ok("observation tagged decision:pass", (fakeMemory.observations[0].tags || []).includes("decision:pass"));
  ok("log file exists", fs.existsSync(LOG));
  const lines = fs.readFileSync(LOG, "utf-8").trim().split("\n");
  ok("1 log line", lines.length === 1);
  const parsed = JSON.parse(lines[0]);
  check("logged decision", parsed.decision, "pass");
  check("logged ok=true", parsed.ok, true);
  check("logged route_lane", parsed.route_lane, "none");
}

// ─── valid fail with doc complaint → docs lane, agent=data ──────────────────

console.log("\n[fail → doc complaint]");
{
  const r = await webhookHandler({
    project_id: "2026-05-10_blog",
    build_id: "pre-dev-2026-05-10-def",
    decision: "fail",
    reviewer: "founder@agentryx.dev",
    reviewed_at: new Date().toISOString(),
    comments: "The README has a typo and the docs are unclear",
  });
  check("status 200", r.status, 200);
  check("route lane = docs", r.body.route.lane, "docs");
  check("route agent = data", r.body.route.agent, "data");
  const lines = fs.readFileSync(LOG, "utf-8").trim().split("\n");
  ok("2 log lines now", lines.length === 2);
  const last = JSON.parse(lines[1]);
  check("comments_preview captured", last.comments_preview, "The README has a typo and the docs are unclear");
}

// ─── valid partial with test complaint → tests lane, agent=tuvok ────────────

console.log("\n[partial → test complaint]");
{
  const r = await webhookHandler({
    project_id: "2026-05-10_blog",
    build_id: "pre-dev-2026-05-10-ghi",
    decision: "partial",
    reviewer: "founder@agentryx.dev",
    reviewed_at: new Date().toISOString(),
    comments: "Missing test coverage for edge cases",
  });
  check("route lane = tests", r.body.route.lane, "tests");
  check("route agent = tuvok", r.body.route.agent, "tuvok");
}

// ─── missing project_id falls back to 'unknown' ─────────────────────────────

console.log("\n[no project_id provided]");
{
  const r = await webhookHandler({
    build_id: "pre-dev-orphan",
    decision: "pass",
    reviewer: "rev@x",
    reviewed_at: new Date().toISOString(),
  });
  check("status 200", r.status, 200);
  const last = JSON.parse(fs.readFileSync(LOG, "utf-8").trim().split("\n").pop());
  check("logged as project_id=unknown", last.project_id, "unknown");
  const obs = fakeMemory.observations[fakeMemory.observations.length - 1];
  check("observation scope is project:unknown", obs.scope, "project:unknown");
}

// ─── tail-read produces the most-recent-first list with correct shape ───────

console.log("\n[recent-feedback tail-read]");
{
  const raw = fs.readFileSync(LOG, "utf-8");
  const recent = raw.split("\n").filter(Boolean).slice(-20).map(JSON.parse).reverse();
  ok("non-empty", recent.length >= 4);
  // last we wrote (orphan) should be first in reverse-tail
  check("most-recent first → 'orphan'", recent[0].build_id, "pre-dev-orphan");
  ok("every record has decision", recent.every(r => typeof r.decision === "string"));
  ok("every record has received_at", recent.every(r => typeof r.received_at === "string"));
}

// ─── cleanup ────────────────────────────────────────────────────────────────

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
