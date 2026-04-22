import { buildProofGraph } from "./proof.js";
import { concatArray, mergeObject, sumNumbers, dedupeBranchSet } from "./reducers.js";

const BRANCH_DELAY_MS = parseInt(process.env.BRANCH_DELAY_MS || "1000", 10);
const PARALLELISM_TOLERANCE_MS = 1000; // wall-clock should be < 1×delay + 1s overhead

function assert(condition, msg) {
  if (!condition) throw new Error(`ASSERT: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function testReducers() {
  console.log("[reducers]");
  assert(JSON.stringify(concatArray([1, 2], [3, 4])) === "[1,2,3,4]", "concatArray merges arrays");
  assert(JSON.stringify(concatArray(null, [3, 4])) === "[3,4]", "concatArray handles null left");
  assert(JSON.stringify(mergeObject({ a: 1 }, { b: 2 })) === '{"a":1,"b":2}', "mergeObject shallow merges");
  assert(JSON.stringify(mergeObject({ a: 1 }, { a: 2 })) === '{"a":2}', "mergeObject right wins on collision");
  assert(sumNumbers(0.05, 0.03) === 0.08, "sumNumbers adds");
  assert(sumNumbers(undefined, 0.03) === 0.03, "sumNumbers tolerates undefined");
  assert(JSON.stringify(dedupeBranchSet(["a"], ["b", "a"])) === '["a","b"]', "dedupeBranchSet dedupes");
}

async function testParallelExecution() {
  console.log(`[parallel] BRANCH_DELAY_MS=${BRANCH_DELAY_MS}, tolerance=${PARALLELISM_TOLERANCE_MS}ms`);

  const graph = buildProofGraph();
  const t0 = Date.now();
  const result = await graph.invoke({ request: "build a hello-world API" });
  const elapsed = Date.now() - t0;

  console.log(`[parallel] elapsed: ${elapsed}ms (vs ${BRANCH_DELAY_MS * 3}ms if sequential)`);
  assert(elapsed < BRANCH_DELAY_MS + PARALLELISM_TOLERANCE_MS, `wall-clock < ${BRANCH_DELAY_MS + PARALLELISM_TOLERANCE_MS}ms (proves concurrency)`);
  assert(elapsed < BRANCH_DELAY_MS * 2, `definitely faster than sequential (< ${BRANCH_DELAY_MS * 2}ms)`);

  console.log("[parallel] state assertions");
  assert(result.branchesCompleted.length === 3, "all 3 branches reported completion");
  assert(["torres", "tuvok", "data"].every(n => result.branchesCompleted.includes(n)), "branchesCompleted contains all three");
  assert(Object.keys(result.artifacts).length === 3, "3 distinct artifacts merged");
  assert(["code", "tests", "docs"].every(k => k in result.artifacts), "artifacts has code+tests+docs");
  assert(Math.abs(result.totalCostUsd - 0.10) < 0.0001, `totalCostUsd summed correctly: $${result.totalCostUsd.toFixed(4)}`);
  assert(result.log.length >= 7, `log has ≥7 entries (got ${result.log.length})`);
  assert(result.finalReport && result.finalReport.cost_usd === 0.10, "finalReport produced by obrien");
}

async function main() {
  try {
    await testReducers();
    console.log("");
    await testParallelExecution();
    console.log("\n[smoke] OK");
  } catch (e) {
    console.error(`\n[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
