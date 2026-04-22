import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { getMemoryService } from "./service.js";
import { walkArtifacts, summarizeArtifacts } from "./artifact-walker.js";
import { writeArtifact } from "../artifacts/store.js";

async function testMemoryService() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-smoke-"));
  console.log(`[memory] vault: ${rootDir}`);
  const mem = getMemoryService({ rootDir });

  const o1 = await mem.addObservation({
    kind: "lesson",
    scope: "agent:troi",
    content: "Troi hallucinates auth middleware when the spec doesn't mention auth — always require explicit auth clause in triage spec.",
    tags: ["troi", "auth", "hallucination", "triage"],
    produced_by: { agent: "qa_reviewer", source: "post_dev_graph" },
    refs: { artifact_ids: ["ART-0001"], run_id: "run-abc" },
  });
  console.log(`[memory] wrote ${o1.id} (${o1.kind}, ${o1.scope})`);

  const o2 = await mem.addObservation({
    kind: "pattern",
    scope: "global",
    content: "Requests >4096 tokens return OpenRouter 402 on free-tier accounts; keep intake prompts under 2000.",
    tags: ["openrouter", "402", "budget"],
    produced_by: { source: "cli" },
  });
  console.log(`[memory] wrote ${o2.id}`);

  const o3 = await mem.addObservation({
    kind: "user_note",
    scope: "project:2026-04-22_todo-app",
    content: "User confirmed real-time sync is out of scope for v1. Document in A1 Scope.",
    tags: ["scope", "v1"],
    produced_by: { agent: "human:subhash", source: "verify_portal" },
  });
  console.log(`[memory] wrote ${o3.id}`);

  const allTroi = await mem.recall({ scope: "agent:troi" });
  console.log(`[memory] recall scope=agent:troi: ${allTroi.length} hit(s)`);

  const authTag = await mem.recall({ tags: ["auth"] });
  console.log(`[memory] recall tags=[auth]: ${authTag.length} hit(s)`);

  const textSearch = await mem.recall({ text: "openrouter" });
  console.log(`[memory] recall text=openrouter: ${textSearch.length} hit(s)`);

  const fetched = await mem.getById(o1.id);
  console.log(`[memory] getById(${o1.id}): markdown starts "${fetched.markdown.slice(0, 40)}..."`);

  console.log(`[memory] OK — cleanup: rm -rf ${rootDir}`);
  await fs.rm(rootDir, { recursive: true, force: true });
}

async function testArtifactWalker() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-walk-"));
  console.log(`[walker] workspace: ${workspace}`);

  const projA = path.join(workspace, "2026-04-22_todo-app");
  const projB = path.join(workspace, "2026-04-22_blog");
  await fs.mkdir(projA, { recursive: true });
  await fs.mkdir(projB, { recursive: true });

  await writeArtifact(projA, {
    kind: "code_output",
    content: "// project A code",
    produced_by: { agent: "troi" },
    cost_usd: 0.02,
  });
  await writeArtifact(projA, {
    kind: "qa_report",
    content: { passed: 5, failed: 0 },
    produced_by: { agent: "tuvok" },
    cost_usd: 0.01,
  });
  await writeArtifact(projB, {
    kind: "code_output",
    content: "// project B code",
    produced_by: { agent: "troi" },
    cost_usd: 0.03,
  });

  const summary = await summarizeArtifacts(workspace);
  console.log(`[walker] summary: ${JSON.stringify(summary)}`);
  const all = await walkArtifacts(workspace);
  console.log(`[walker] walked ${all.length} artifacts across ${summary.total_projects} projects`);

  console.log(`[walker] OK — cleanup: rm -rf ${workspace}`);
  await fs.rm(workspace, { recursive: true, force: true });
}

async function main() {
  await testMemoryService();
  console.log("");
  await testArtifactWalker();
}

main().catch(e => {
  console.error(`[smoke] FAILED: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
