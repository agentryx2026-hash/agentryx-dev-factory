import { StateGraph, Annotation, END } from "@langchain/langgraph";
import { concatArray, mergeObject, sumNumbers, dedupeBranchSet, lastWriteWins } from "./reducers.js";

/**
 * Proof-of-concept: 3 stub branches running concurrently after a single
 * "spock" planner node, then converging at "join" before "obrien" wraps up.
 *
 * Topology:
 *   __start__ → spock ──┬──→ torres (code) ──┐
 *                       ├──→ tuvok  (tests) ─┼─→ join → obrien → __end__
 *                       └──→ data   (docs)  ─┘
 *
 * Each branch sleeps for `BRANCH_DELAY_MS` to simulate LLM latency.
 * Wall-clock total should be ~BRANCH_DELAY_MS, NOT 3 × BRANCH_DELAY_MS.
 */

const BRANCH_DELAY_MS = parseInt(process.env.BRANCH_DELAY_MS || "1000", 10);

const ProofState = Annotation.Root({
  request: Annotation({ reducer: lastWriteWins }),
  triage: Annotation({ reducer: lastWriteWins }),
  artifacts: Annotation({ reducer: mergeObject, default: () => ({}) }),
  branchesCompleted: Annotation({ reducer: dedupeBranchSet, default: () => [] }),
  totalCostUsd: Annotation({ reducer: sumNumbers, default: () => 0 }),
  log: Annotation({ reducer: concatArray, default: () => [] }),
  finalReport: Annotation({ reducer: lastWriteWins }),
});

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function spockNode(state) {
  return {
    triage: { spec: `triage for: ${state.request}`, allowed_branches: ["code", "tests", "docs"] },
    log: [`[spock] planned ${new Date().toISOString()}`],
  };
}

async function torresNode(state) {
  await sleep(BRANCH_DELAY_MS);
  return {
    artifacts: { code: "function hello(){ return 'world'; }" },
    branchesCompleted: ["torres"],
    totalCostUsd: 0.05,
    log: [`[torres] code branch done at ${new Date().toISOString()}`],
  };
}

async function tuvokNode(state) {
  await sleep(BRANCH_DELAY_MS);
  return {
    artifacts: { tests: "describe('hello', () => it('returns world'))" },
    branchesCompleted: ["tuvok"],
    totalCostUsd: 0.03,
    log: [`[tuvok] tests branch done at ${new Date().toISOString()}`],
  };
}

async function dataNode(state) {
  await sleep(BRANCH_DELAY_MS);
  return {
    artifacts: { docs: "# Hello API\n\nReturns the string 'world'." },
    branchesCompleted: ["data"],
    totalCostUsd: 0.02,
    log: [`[data] docs branch done at ${new Date().toISOString()}`],
  };
}

async function joinNode(state) {
  return {
    log: [
      `[join] received from branches: ${state.branchesCompleted.join(", ")}`,
      `[join] artifacts: ${Object.keys(state.artifacts).join(", ")}`,
      `[join] total cost: $${state.totalCostUsd.toFixed(4)}`,
    ],
  };
}

async function obrienNode(state) {
  return {
    finalReport: {
      branches: state.branchesCompleted,
      artifact_kinds: Object.keys(state.artifacts),
      cost_usd: state.totalCostUsd,
      log_lines: state.log.length,
    },
    log: [`[obrien] finalized ${new Date().toISOString()}`],
  };
}

export function buildProofGraph() {
  const wf = new StateGraph(ProofState)
    .addNode("spock", spockNode)
    .addNode("torres", torresNode)
    .addNode("tuvok", tuvokNode)
    .addNode("data", dataNode)
    .addNode("join", joinNode)
    .addNode("obrien", obrienNode)
    .addEdge("__start__", "spock")
    .addEdge("spock", "torres")
    .addEdge("spock", "tuvok")
    .addEdge("spock", "data")
    .addEdge("torres", "join")
    .addEdge("tuvok", "join")
    .addEdge("data", "join")
    .addEdge("join", "obrien")
    .addEdge("obrien", END);
  return wf.compile();
}
