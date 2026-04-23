import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { writeArtifact, listArtifacts } from "../artifacts/store.js";
import { collectRun, listRunIds } from "./run-collector.js";
import { buildReplayPlan } from "./planner.js";
import { executeReplay } from "./executor.js";
import { deriveReplayRunId, nextReplaySequence } from "./types.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

const RUN_ID = "run-2026-04-23-abc";

async function setupRecordedRun() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "replay-ws-"));
  const projectDir = path.join(root, "2026-04-23_demo");
  await fs.mkdir(projectDir, { recursive: true });

  // Build a 4-artifact recorded run:
  //   spock (triage)  ─→ ART-0001
  //                       ├─ troi (code)  ─→ ART-0002 (parent: ART-0001)
  //                       └─ tuvok (test) ─→ ART-0003 (parent: ART-0001)
  //                                          └─ obrien (release) ─→ ART-0004 (parents: ART-0002, ART-0003)
  const a1 = await writeArtifact(projectDir, {
    kind: "triage_spec", content: "spec text",
    produced_by: { agent: "spock", model: "model-a", run_id: RUN_ID, iteration: 1 },
    cost_usd: 0.01,
  });
  await new Promise(r => setTimeout(r, 10));
  const a2 = await writeArtifact(projectDir, {
    kind: "code_output", content: "function foo(){}",
    produced_by: { agent: "troi", model: "model-b", run_id: RUN_ID, iteration: 1 },
    cost_usd: 0.10, parent_ids: [a1.id],
  });
  await new Promise(r => setTimeout(r, 10));
  const a3 = await writeArtifact(projectDir, {
    kind: "test_output", content: "describe foo",
    produced_by: { agent: "tuvok", model: "model-c", run_id: RUN_ID, iteration: 1 },
    cost_usd: 0.04, parent_ids: [a1.id],
  });
  await new Promise(r => setTimeout(r, 10));
  const a4 = await writeArtifact(projectDir, {
    kind: "deploy_status", content: "deployed",
    produced_by: { agent: "obrien", model: "model-d", run_id: RUN_ID, iteration: 1 },
    cost_usd: 0.02, parent_ids: [a2.id, a3.id],
  });

  // Add a noise artifact from a DIFFERENT run to confirm filtering
  await writeArtifact(projectDir, {
    kind: "code_output", content: "noise",
    produced_by: { agent: "troi", run_id: "run-other-xyz", iteration: 1 },
    cost_usd: 0.05,
  });

  return { root, projectDir, ids: { a1: a1.id, a2: a2.id, a3: a3.id, a4: a4.id } };
}

async function testRunCollector(root, ids) {
  console.log("[run-collector]");
  const snap = await collectRun(root, RUN_ID);
  assert(snap != null, "snapshot returned");
  assert(snap.run_id === RUN_ID, "run_id matches");
  assert(snap.artifacts.length === 4, `4 artifacts (got ${snap.artifacts.length})`);
  assert(snap.agents.length === 4, "4 distinct agents");
  assert(snap.agents[0] === "spock", "first agent (temporal order) is spock");
  assert(snap.window.from <= snap.window.to, "window from ≤ to");

  const noise = await collectRun(root, "run-nonexistent");
  assert(noise === null, "missing run returns null");

  const allRunIds = await listRunIds(root);
  assert(allRunIds.length === 2, `2 distinct runs visible across workspace (got ${allRunIds.length})`);
}

async function testIdHelpers() {
  console.log("[id helpers]");
  assert(deriveReplayRunId(RUN_ID, 1) === `${RUN_ID}.replay.1`, "replay run id format");
  assert(nextReplaySequence([], RUN_ID) === 1, "no prior replays → seq 1");
  assert(nextReplaySequence([`${RUN_ID}.replay.1`, `${RUN_ID}.replay.3`], RUN_ID) === 4, "next after 3 = 4");
  assert(nextReplaySequence(["other.replay.5"], RUN_ID) === 1, "different source ignored");
}

async function testPlannerFromCenter(snap, ids) {
  console.log("[planner — replay from troi (mid-graph)]");
  const plan = buildReplayPlan(snap, { replayFromArtifactId: ids.a2 });
  assert(plan.source_run_id === RUN_ID, "source run id preserved");
  assert(plan.new_run_id === `${RUN_ID}.replay.1`, "new run id derived");
  assert(plan.replay_artifact_ids.length === 2, `2 artifacts to replay: troi (a2) + obrien (a4); got ${plan.replay_artifact_ids.length}`);
  assert(plan.replay_artifact_ids[0] === ids.a2, "replay starts with pivot");
  assert(plan.replay_artifact_ids[1] === ids.a4, "obrien is downstream");
  assert(plan.frozen_artifact_ids.length === 2, `frozen: spock (a1) + tuvok (a3 — sibling of pivot, parent of a4); got ${plan.frozen_artifact_ids.length}`);
  assert(plan.frozen_artifact_ids.includes(ids.a1), "spock frozen");
  assert(plan.frozen_artifact_ids.includes(ids.a3), "tuvok frozen (sibling)");
}

async function testPlannerFromRoot(snap, ids) {
  console.log("[planner — replay from spock (root)]");
  const plan = buildReplayPlan(snap, { replayFromArtifactId: ids.a1, existingRunIds: [`${RUN_ID}.replay.1`, `${RUN_ID}.replay.2`] });
  assert(plan.replay_artifact_ids.length === 4, "all 4 artifacts replay");
  assert(plan.frozen_artifact_ids.length === 0, "nothing frozen");
  assert(plan.new_run_id === `${RUN_ID}.replay.3`, "new run id picks next seq");
}

async function testExecutor(projectDir, snap, ids) {
  console.log("[executor — frozen-input replay from troi]");
  const plan = buildReplayPlan(snap, { replayFromArtifactId: ids.a2 });

  const stubCalls = [];
  const nodeStubs = {
    troi: async ({ original, parents, new_run_id }) => {
      stubCalls.push({ agent: "troi", parent_count: parents.length });
      return { kind: "code_output", content: "REPLAYED CODE", agent: "troi", model: "model-b-replay", cost_usd: 0.07 };
    },
    obrien: async ({ original, parents, new_run_id }) => {
      stubCalls.push({ agent: "obrien", parent_count: parents.length });
      return { kind: "deploy_status", content: "REPLAYED DEPLOY", agent: "obrien", cost_usd: 0.01 };
    },
  };

  const result = await executeReplay(plan, { projectDir, nodeStubs, snapshot: snap });
  assert(result.ok, `executor ok (${result.error || "no error"})`);
  assert(result.new_artifact_ids.length === 2, "2 new artifacts written");
  assert(result.produced[0].agent === "troi", "first produced is troi");
  assert(result.produced[1].agent === "obrien", "second produced is obrien");
  assert(stubCalls.length === 2, "2 stubs invoked");
  assert(stubCalls[0].parent_count === 1, "troi has 1 parent (spock, frozen)");
  assert(stubCalls[1].parent_count === 2, "obrien has 2 parents (troi-new + tuvok-frozen)");

  // Verify written artifacts have correct lineage
  const allInProj = await listArtifacts(projectDir);
  const newTroi = allInProj.find(a => a.id === result.new_artifact_ids[0]);
  const newObrien = allInProj.find(a => a.id === result.new_artifact_ids[1]);
  assert(newTroi.produced_by.run_id === plan.new_run_id, "new troi has new run_id");
  assert(newTroi.parent_ids[0] === ids.a1, "new troi parent = original spock (frozen)");
  assert(newObrien.parent_ids.includes(ids.a3), "new obrien parent includes original tuvok (frozen)");
  assert(newObrien.parent_ids.includes(newTroi.id), "new obrien parent includes NEW troi (replayed)");
  assert(newTroi.tags.includes("replay"), "new artifact tagged replay");
  assert(newTroi.meta.replays_artifact_id === ids.a2, "meta tracks original");
}

async function testSubstitution(projectDir, snap, ids) {
  console.log("[executor — substitution mode]");
  // Pretend we have an alternative spock spec we want to test against
  const altSpock = await writeArtifact(projectDir, {
    kind: "triage_spec", content: "ALTERNATIVE SPEC",
    produced_by: { agent: "spock", run_id: "experiment-1" },
    cost_usd: 0,
  });

  const plan = buildReplayPlan(snap, {
    replayFromArtifactId: ids.a2,
    substitutions: { [ids.a1]: altSpock.id },
    existingRunIds: [`${RUN_ID}.replay.1`],
  });

  const seenSpock = [];
  const stubs = {
    troi: async ({ parents }) => {
      seenSpock.push(parents.find(p => p.agent === "spock")?.id);
      return { kind: "code_output", content: "x", agent: "troi", cost_usd: 0 };
    },
    obrien: async () => ({ kind: "deploy_status", content: "x", agent: "obrien", cost_usd: 0 }),
  };

  const result = await executeReplay(plan, { projectDir, nodeStubs: stubs, snapshot: snap });
  assert(result.ok, "substitution replay ok");
  assert(seenSpock[0] === altSpock.id, `troi saw substituted spock id (${seenSpock[0]})`);
}

async function testMissingStub(projectDir, snap, ids) {
  console.log("[executor — missing stub]");
  const plan = buildReplayPlan(snap, { replayFromArtifactId: ids.a4 });
  const result = await executeReplay(plan, { projectDir, nodeStubs: {}, snapshot: snap });
  assert(!result.ok, "missing stub → ok=false");
  assert(result.error.includes("no stub"), "error mentions missing stub");
}

async function main() {
  const { root, projectDir, ids } = await setupRecordedRun();
  try {
    await testRunCollector(root, ids);
    console.log("");
    await testIdHelpers();
    console.log("");
    const snap = await collectRun(root, RUN_ID);
    await testPlannerFromCenter(snap, ids);
    console.log("");
    await testPlannerFromRoot(snap, ids);
    console.log("");
    await testExecutor(projectDir, snap, ids);
    console.log("");
    await testSubstitution(projectDir, snap, ids);
    console.log("");
    await testMissingStub(projectDir, snap, ids);
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
