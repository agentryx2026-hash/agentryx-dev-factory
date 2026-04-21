import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { writeArtifact, listArtifacts, getArtifact, verifyArtifact } from "./store.js";

async function main() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "artifacts-smoke-"));
  console.log(`[smoke] project dir: ${tmpDir}`);

  const a1 = await writeArtifact(tmpDir, {
    kind: "code_output",
    content: "const hello = 'world';\n",
    produced_by: { agent: "troi", node: "troiBackendNode", model: "test-model", run_id: "run-abc", iteration: 1 },
    cost_usd: 0.01,
    latency_ms: 1234,
  });
  console.log(`[smoke] wrote ${a1.id} (${a1.kind}) sha=${a1.content_sha256.slice(0, 12)}...`);

  const a2 = await writeArtifact(tmpDir, {
    kind: "qa_report",
    content: { passed: 10, failed: 2, errors: ["auth timeout", "db connection"] },
    produced_by: { agent: "tuvok", run_id: "run-abc" },
    parent_ids: [a1.id],
  });
  console.log(`[smoke] wrote ${a2.id} (${a2.kind}) parent=${a2.parent_ids?.[0]}`);

  const a3 = await writeArtifact(tmpDir, {
    kind: "pmd_doc",
    content: "# A1 Scope\n\n(example)\n",
    produced_by: { agent: "picard", run_id: "run-abc" },
    tags: ["A1", "scope"],
  });
  console.log(`[smoke] wrote ${a3.id}`);

  const all = await listArtifacts(tmpDir);
  console.log(`[smoke] index has ${all.length} entries: ${all.map(a => a.id + ":" + a.kind).join(", ")}`);

  const qa = await listArtifacts(tmpDir, { kind: "qa_report" });
  console.log(`[smoke] qa_report filter: ${qa.length} match`);

  const fetched = await getArtifact(tmpDir, a1.id);
  console.log(`[smoke] getArtifact(${a1.id}): content length=${fetched.content.length}, provenance agent=${fetched.record.produced_by.agent}`);

  const verify = await verifyArtifact(tmpDir, a2.id);
  console.log(`[smoke] verify(${a2.id}): ok=${verify.ok}`);

  const badRead = await getArtifact(tmpDir, "ART-9999");
  console.log(`[smoke] getArtifact(missing): ${badRead === null ? "null (ok)" : "UNEXPECTED " + JSON.stringify(badRead)}`);

  console.log(`[smoke] OK — cleanup: rm -rf ${tmpDir}`);
  await fs.rm(tmpDir, { recursive: true, force: true });
}

main().catch(e => {
  console.error(`[smoke] FAILED: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
