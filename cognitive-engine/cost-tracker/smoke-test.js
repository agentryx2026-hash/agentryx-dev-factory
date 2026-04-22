import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { writeArtifact } from "../artifacts/store.js";
import { getRollup } from "./service.js";

function assert(condition, msg) {
  if (!condition) throw new Error(`ASSERT: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function setupWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cost-ws-"));
  console.log(`[setup] workspace: ${root}`);
  const todoProj = path.join(root, "2026-04-22_todo-app");
  const blogProj = path.join(root, "2026-04-22_blog");
  await fs.mkdir(todoProj, { recursive: true });
  await fs.mkdir(blogProj, { recursive: true });

  // todo-app: 3 artifacts from 2 agents on 2 models
  await writeArtifact(todoProj, {
    kind: "code_output",
    content: "// todo app",
    produced_by: { agent: "troi", model: "openrouter:anthropic/claude-sonnet-4-5" },
    cost_usd: 0.15,
    latency_ms: 3200,
  });
  await writeArtifact(todoProj, {
    kind: "qa_report",
    content: { passed: 10 },
    produced_by: { agent: "tuvok", model: "openrouter:anthropic/claude-haiku-4-5" },
    cost_usd: 0.02,
  });
  await writeArtifact(todoProj, {
    kind: "architect_review",
    content: "LGTM",
    produced_by: { agent: "picard", model: "openrouter:anthropic/claude-opus-4.7" },
    cost_usd: 0.50,
  });

  // blog: 2 artifacts from 1 agent
  await writeArtifact(blogProj, {
    kind: "code_output",
    content: "// blog",
    produced_by: { agent: "troi", model: "openrouter:anthropic/claude-sonnet-4-5" },
    cost_usd: 0.08,
  });
  await writeArtifact(blogProj, {
    kind: "pmd_doc",
    content: "# A1 Scope",
    produced_by: { agent: "picard", model: "openrouter:anthropic/claude-opus-4.7" },
    cost_usd: 0.25,
  });

  return root;
}

async function testArtifactRollup(root) {
  console.log("[rollup source=artifacts]");
  const rollup = await getRollup({}, { workspaceRoot: root, source: "artifacts" });

  assert(rollup.source === "artifacts", "source tagged 'artifacts'");
  assert(Math.abs(rollup.totals.cost_usd - 1.00) < 0.0001, `totals.cost_usd = $${rollup.totals.cost_usd.toFixed(4)} (expected $1.0000)`);
  assert(rollup.totals.calls === 5, `totals.calls = ${rollup.totals.calls} (expected 5)`);

  assert(Object.keys(rollup.by_project).length === 2, "2 projects rolled up");
  assert(rollup.by_project["2026-04-22_todo-app"].calls === 3, "todo-app has 3 calls");
  assert(Math.abs(rollup.by_project["2026-04-22_todo-app"].cost_usd - 0.67) < 0.0001, `todo-app cost = $${rollup.by_project["2026-04-22_todo-app"].cost_usd.toFixed(4)}`);

  assert(Object.keys(rollup.by_agent).length === 3, "3 agents (troi, tuvok, picard)");
  assert(rollup.by_agent.troi.calls === 2, "troi appears in both projects");
  assert(Math.abs(rollup.by_agent.troi.cost_usd - 0.23) < 0.0001, `troi total = $${rollup.by_agent.troi.cost_usd.toFixed(4)}`);
  assert(Math.abs(rollup.by_agent.picard.cost_usd - 0.75) < 0.0001, `picard total = $${rollup.by_agent.picard.cost_usd.toFixed(4)}`);

  assert(Object.keys(rollup.by_model).length === 3, "3 distinct models");
  assert(rollup.by_day && Object.keys(rollup.by_day).length >= 1, "by_day populated");
  assert(rollup.period.from && rollup.period.to, "period has both from/to");
}

async function testFilters(root) {
  console.log("[filters]");
  const byProject = await getRollup({ project_ids: ["2026-04-22_blog"] }, { workspaceRoot: root, source: "artifacts" });
  assert(byProject.totals.calls === 2, "project filter: blog has 2 calls");
  assert(Math.abs(byProject.totals.cost_usd - 0.33) < 0.0001, `project filter: blog cost = $${byProject.totals.cost_usd.toFixed(4)}`);

  const byAgent = await getRollup({ agents: ["picard"] }, { workspaceRoot: root, source: "artifacts" });
  assert(byAgent.totals.calls === 2, "agent filter: picard has 2 calls");
  assert(Math.abs(byAgent.totals.cost_usd - 0.75) < 0.0001, `agent filter: picard cost = $${byAgent.totals.cost_usd.toFixed(4)}`);

  const byModel = await getRollup({ models: ["openrouter:anthropic/claude-haiku-4-5"] }, { workspaceRoot: root, source: "artifacts" });
  assert(byModel.totals.calls === 1, "model filter: haiku has 1 call");

  const empty = await getRollup({ agents: ["nonexistent"] }, { workspaceRoot: root, source: "artifacts" });
  assert(empty.totals.calls === 0, "nonexistent agent returns zero");
}

async function testErrorCases(root) {
  console.log("[error cases]");
  try {
    await getRollup({}, { source: "artifacts" });
    throw new Error("should have thrown without workspaceRoot");
  } catch (e) {
    assert(e.message.includes("workspaceRoot required"), "artifact source requires workspaceRoot");
  }

  try {
    await getRollup({}, { source: "db" });
    throw new Error("should have thrown without pool");
  } catch (e) {
    assert(e.message.includes("pool required"), "db source requires pool");
  }

  try {
    await getRollup({}, { source: "unknown", workspaceRoot: root });
    throw new Error("should have thrown on unknown source");
  } catch (e) {
    assert(e.message.includes("unknown COST_TRACKER_SOURCE"), "unknown source rejected");
  }
}

async function main() {
  const root = await setupWorkspace();
  try {
    await testArtifactRollup(root);
    console.log("");
    await testFilters(root);
    console.log("");
    await testErrorCases(root);
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
