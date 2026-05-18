/**
 * Phase 8-B smoke — proves the parallel topology dev_graph.js uses under
 * USE_PARALLEL_DEV_GRAPH=true actually fan-outs concurrently and joins
 * correctly.
 *
 *   node cognitive-engine/parallel/dev-graph-topology.smoke.js
 *
 * dev_graph.js can't be imported directly (it ends in `main().catch(...)`),
 * so this test reconstructs the SAME topology using stubbed node fns:
 *
 *   torres → [tuvok, data] → join_review → router → (torres | crusher)
 *
 * Each stub waits 200ms to simulate LLM latency. Wall-clock < 350ms
 * proves they overlapped (sequential would take 400ms+). State writes
 * are checked to confirm:
 *  - tuvok wrote qaReport + branchesCompleted: ['tuvok']
 *  - data wrote architectReview + branchesCompleted: ['data']
 *  - branchesCompleted contains both after join (dedupeBranchSet merger)
 *  - router fires once with both verdicts present
 */

import assert from "node:assert/strict";
import { StateGraph, Annotation, END } from "@langchain/langgraph";

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// State shape mirrors dev_graph.js's FactoryState. Critical: branchesCompleted
// uses dedupeBranchSet reducer (concat + dedupe) so concurrent tuvok+data
// writes merge rather than clobbering.
const State = Annotation.Root({
  codeOutput: Annotation({ reducer: (a, b) => b ?? a }),
  qaReport: Annotation({ reducer: (a, b) => b ?? a }),
  testOutput: Annotation({ reducer: (a, b) => b ?? a }),
  architectReview: Annotation({ reducer: (a, b) => b ?? a }),
  currentAgent: Annotation({ reducer: (a, b) => b ?? a }),
  iteration: Annotation({ reducer: (a, b) => b ?? a }),
  branchesCompleted: Annotation({
    reducer: (a = [], b = []) => Array.from(new Set([...(a || []), ...(b || [])])),
    default: () => [],
  }),
});

// Track invocation timing per node — proves the overlap.
const calls = { torres: [], tuvok: [], data: [], join: [], router: [] };

function record(name, mark) { calls[name].push({ t: Date.now(), mark }); }

async function torresNode(_state) {
  record('torres', 'start');
  await sleep(50);
  record('torres', 'end');
  return { codeOutput: 'src/auth.js — JWT middleware', currentAgent: 'torres-done' };
}

async function tuvokNode(state) {
  record('tuvok', 'start');
  // Read codeOutput from state (must exist by now — torres ran first).
  ok('tuvok sees codeOutput', !!state.codeOutput);
  await sleep(200);  // simulate LLM latency
  record('tuvok', 'end');
  return {
    qaReport: 'QA_VERDICT: PASS',
    testOutput: 'all 14 tests pass',
    currentAgent: 'join_review',
    branchesCompleted: ['tuvok'],
  };
}

async function dataNode(state) {
  record('data', 'start');
  // Data sees codeOutput too. May or may not see qaReport (depends on
  // whether tuvok finished first — race-safe by design: empty qaReport
  // is handled gracefully in real dev_graph dataNode).
  ok('data sees codeOutput', !!state.codeOutput);
  await sleep(200);  // simulate LLM latency
  record('data', 'end');
  return {
    architectReview: 'VERDICT: APPROVED\nOVERALL_CONFIDENCE: 0.85',
    currentAgent: 'join_review',
    branchesCompleted: ['data'],
  };
}

async function joinReviewNode(state) {
  record('join', 'start');
  // The join is a barrier — by the time we get here both predecessors
  // must have completed. Verify branchesCompleted has both.
  ok('join sees both branches in branchesCompleted',
     (state.branchesCompleted || []).sort().join(',') === 'data,tuvok');
  return { currentAgent: 'route_after_review' };
}

function routeAfterReview(state) {
  record('router', state.architectReview && state.qaReport ? 'both' : 'incomplete');
  const review = (state.architectReview || '').toUpperCase();
  const qa = (state.qaReport || '').toUpperCase();
  const hasFix = review.includes('NEEDS_FIX') || qa.includes('SEND_BACK') || qa.includes('FAIL');
  return hasFix && (state.iteration || 0) < 2 ? 'torres' : 'crusher';
}

async function crusherNode(_state) { return { currentAgent: 'obrien' }; }
async function obrienNode(_state) { return { currentAgent: 'complete' }; }

const workflow = new StateGraph(State)
  .addNode('torres', torresNode)
  .addNode('tuvok', tuvokNode)
  .addNode('data', dataNode)
  .addNode('join_review', joinReviewNode)
  .addNode('crusher', crusherNode)
  .addNode('obrien', obrienNode)
  .addEdge('__start__', 'torres')
  .addEdge('torres', 'tuvok')
  .addEdge('torres', 'data')
  .addEdge('tuvok', 'join_review')
  .addEdge('data', 'join_review')
  .addConditionalEdges('join_review', routeAfterReview, { torres: 'torres', crusher: 'crusher' })
  .addEdge('crusher', 'obrien')
  .addEdge('obrien', END);

const graph = workflow.compile();

// ─── run the graph ─────────────────────────────────────────────────────────

console.log('\n[invoke]');
const t0 = Date.now();
const result = await graph.invoke({ iteration: 0 });
const elapsed = Date.now() - t0;

console.log(`  elapsed: ${elapsed}ms (sequential lower bound = 450ms; parallel target ~280ms)`);

// ─── proof of parallelism ─────────────────────────────────────────────────

group('overlap (proves concurrent execution)');
{
  // tuvok and data both took 200ms. If sequential, elapsed > 50+200+200 = 450ms.
  // If parallel, elapsed ≈ 50 + max(200,200) + ~ tiny overhead = ~250-350ms.
  ok('wall-clock < 400ms (parallel)', elapsed < 400);
  ok('tuvok start < data end (overlap)', calls.tuvok[0].t < calls.data[1].t);
  ok('data start < tuvok end (overlap)', calls.data[0].t < calls.tuvok[1].t);
}

// ─── state coherence ──────────────────────────────────────────────────────

group('state coherence at end of run');
{
  check('codeOutput preserved', result.codeOutput, 'src/auth.js — JWT middleware');
  check('qaReport written', result.qaReport, 'QA_VERDICT: PASS');
  check('testOutput written', result.testOutput, 'all 14 tests pass');
  ok('architectReview written', (result.architectReview || '').includes('APPROVED'));
  check('branchesCompleted both branches (deduped)',
        (result.branchesCompleted || []).sort(), ['data', 'tuvok']);
}

// ─── join + router behaviour ──────────────────────────────────────────────

group('join + router fired exactly once');
{
  check('join fired once', calls.join.length, 1);
  check('router fired once', calls.router.length, 1);
  check('router saw both verdicts', calls.router[0].mark, 'both');
}

// ─── per-node call count (no double-firing under parallel topology) ──────

group('every node fired exactly once');
{
  check('torres x1', calls.torres.length, 2 /* start+end */);
  check('tuvok x1',  calls.tuvok.length, 2);
  check('data x1',   calls.data.length, 2);
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
