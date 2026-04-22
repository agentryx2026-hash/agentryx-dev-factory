import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { writeArtifact } from "../artifacts/store.js";
import { getMemoryService } from "../memory-layer/service.js";
import { buildBundle } from "./bundle-builder.js";
import { getVerifyClient, createMockClient } from "./client.js";
import { handleFeedback, planFixRoute } from "./feedback-receiver.js";
import { validateFeedbackPayload } from "./types.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

async function setupProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "verify-ws-"));
  const projectDir = path.join(root, "2026-04-22_todo-app");
  await fs.mkdir(projectDir, { recursive: true });

  await writeArtifact(projectDir, {
    kind: "code_output",
    content: "function todo(){ /* ... */ }",
    produced_by: { agent: "troi", model: "openrouter:anthropic/claude-sonnet-4-5" },
    cost_usd: 0.12,
  });
  await writeArtifact(projectDir, {
    kind: "qa_report",
    content: { passed: 8, failed: 2, errors: ["empty title", "xss on note body"] },
    produced_by: { agent: "tuvok" },
    cost_usd: 0.04,
  });
  await writeArtifact(projectDir, {
    kind: "pmd_doc",
    content: "# A1 Scope — Todo App v1",
    produced_by: { agent: "picard" },
    tags: ["A1"],
  });
  await writeArtifact(projectDir, {
    kind: "architect_review",
    content: "LGTM with minor nits around error handling",
    produced_by: { agent: "jane" },
  });

  return { root, projectDir };
}

async function testBundleBuilder(projectDir) {
  console.log("[bundle-builder]");
  const bundle = await buildBundle(projectDir, {
    build_id: "build-001",
    version: "v0.0.1-rc1",
    preview_url: "https://todo-app-staging.agentryx.dev/",
    agent_trace_url: "https://langfuse.agentryx.dev/trace/abc",
  });
  assert(bundle.build_id === "build-001", "build_id set");
  assert(bundle.project_id === "2026-04-22_todo-app", "project_id inferred from path");
  assert(bundle.preview_url.includes("todo-app-staging"), "preview_url passed through");
  assert(bundle.review_items.length === 3, `3 review items (got ${bundle.review_items.length})`);
  assert(bundle.review_items.some(i => i.category === "automated"), "qa_report → automated item");
  assert(bundle.review_items.filter(i => i.category === "manual").length === 2, "code + pmd → 2 manual items");
  assert(bundle.release_notes?.includes("ART-"), "architect_review surfaced in release_notes");
  return bundle;
}

async function testMockClient(bundle) {
  console.log("[mock client]");
  const client = getVerifyClient({ kind: "mock" });
  assert(client.kind === "mock", "mock client created");
  const pub = await client.publishBuild(bundle);
  assert(pub.ok, "publish returned ok");
  assert(pub.portal_url.startsWith("mock://"), "portal_url is mock url");
  const fetched = await client.getPublishedBundle(bundle.build_id);
  assert(fetched?.build_id === bundle.build_id, "published bundle retrievable");
}

async function testFeedbackValidation() {
  console.log("[feedback validation]");
  assert(validateFeedbackPayload(null) !== null, "null payload rejected");
  assert(validateFeedbackPayload({}) !== null, "empty payload rejected");
  assert(validateFeedbackPayload({ build_id: "x", decision: "yes", reviewer: "a", reviewed_at: "t" }) !== null, "invalid decision rejected");
  assert(validateFeedbackPayload({ build_id: "x", decision: "pass", reviewer: "a", reviewed_at: "t" }) === null, "valid payload accepted");
}

async function testFixRoutePlanning() {
  console.log("[fix-route planning]");
  assert(planFixRoute({ decision: "pass" }).lane === "none", "pass → no fix");
  assert(planFixRoute({ decision: "fail", comments: "missing edge case test for empty title" }).lane === "tests", "test complaint → tests lane");
  assert(planFixRoute({ decision: "fail", comments: "readme typo and unclear writing" }).lane === "docs", "doc complaint → docs lane");
  assert(planFixRoute({ decision: "partial", comments: "spec says X but got Y — wrong requirement" }).lane === "triage", "scope complaint → triage");
  assert(planFixRoute({ decision: "fail", comments: "button is broken" }).lane === "code", "default → code lane");
}

async function testFullFeedbackCycle(root, projectId) {
  console.log("[full feedback cycle]");
  const memRoot = path.join(root, "_factory-memory");
  const memory = getMemoryService({ rootDir: memRoot });

  const stubRouterCalls = [];
  const stubRouter = async (route) => { stubRouterCalls.push(route); return { ok: true, routed_to: route.agent }; };

  const failPayload = {
    build_id: "build-001",
    review_item_id: "RI-0001",
    requirement_id: "FR-12",
    decision: "fail",
    comments: "xss on note body — missing input sanitization test coverage",
    reviewer: "subhash@agentryx.dev",
    reviewed_at: "2026-04-22T15:30:00Z",
  };

  const result = await handleFeedback(failPayload, { memory, projectId, fixRouter: stubRouter });
  assert(result.ok, "handle result ok");
  assert(result.observation_id?.startsWith("OBS-"), `observation created (${result.observation_id})`);
  assert(result.route.lane === "tests", `route lane=tests (got ${result.route.lane})`);
  assert(stubRouterCalls.length === 1, "stub router invoked once");
  assert(stubRouterCalls[0].agent === "tuvok", "routed to tuvok");

  const obs = await memory.recall({ scope: `project:${projectId}` });
  assert(obs.length === 1, "observation persisted in memory");
  assert(obs[0].kind === "user_note", "kind=user_note");
  assert(obs[0].tags.includes("verify"), "tagged verify");
  assert(obs[0].tags.includes("decision:fail"), "tagged decision:fail");
  assert(obs[0].tags.includes("req:FR-12"), "tagged requirement");
  assert(obs[0].produced_by.source === "verify_portal", "produced_by.source=verify_portal");
  assert(obs[0].produced_by.agent.startsWith("human:"), "produced_by.agent=human:<reviewer>");

  const passPayload = { ...failPayload, decision: "pass", comments: "all good" };
  const passResult = await handleFeedback(passPayload, { memory, projectId, fixRouter: stubRouter });
  assert(passResult.ok, "pass result ok");
  assert(passResult.route.lane === "none", "pass → lane=none");
  assert(stubRouterCalls.length === 1, "pass does NOT invoke router (still 1 call)");
}

async function testFailOpen() {
  console.log("[fail-open path]");
  const result = await handleFeedback({ build_id: "x", decision: "fail", reviewer: "a", reviewed_at: "t" }, { projectId: "p" });
  assert(!result.ok && result.error.includes("memory.addObservation"), "missing memory dep → ok=false");
  const res2 = await handleFeedback({ decision: "pass" }, { memory: { addObservation: async () => ({ id: "OBS-x" }) }, projectId: "p" });
  assert(!res2.ok && res2.error.includes("build_id"), "missing build_id → ok=false");
}

async function main() {
  const { root, projectDir } = await setupProject();
  try {
    const bundle = await testBundleBuilder(projectDir);
    console.log("");
    await testMockClient(bundle);
    console.log("");
    await testFeedbackValidation();
    console.log("");
    await testFixRoutePlanning();
    console.log("");
    await testFullFeedbackCycle(root, path.basename(projectDir));
    console.log("");
    await testFailOpen();
    console.log("\n[smoke] OK");
  } catch (e) {
    console.error(`\n[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main();
