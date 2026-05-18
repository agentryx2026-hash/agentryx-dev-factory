/**
 * Phase 16-B Tier B smoke test for the training_gen queue handler.
 *
 *   node cognitive-engine/concurrency/handlers/training-gen-handler.smoke.js
 *
 * Tests the wrapper against stub Phase 16-A substrate — no filesystem
 * store, no real generators. The intent: prove the contract (payload
 * shape validation, runPipeline called with the right inputs, return
 * shape correct, onLog fires).
 */

import assert from "node:assert/strict";
import { registerTrainingGenHandler, TRAINING_GEN_KIND } from "./training-gen-handler.js";

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

function makeRegistry() {
  const handlers = new Map();
  return {
    register: (kind, fn) => { handlers.set(kind, fn); },
    get: (kind) => handlers.get(kind),
    has: (kind) => handlers.has(kind),
    list: () => [...handlers.keys()],
  };
}

function buildStubs() {
  const calls = { store: [], regBuilt: 0, runPipeline: [], logs: [] };
  return {
    createTrainingStore: (root) => {
      calls.store.push(root);
      return { write: async () => ({}), readLatest: async () => null };
    },
    createGeneratorRegistry: ({ defaults }) => {
      calls.regBuilt += 1; calls.defaults = defaults;
      return { register: () => {}, get: () => null, has: () => false, list: () => ["user_guide", "voiceover_script"] };
    },
    runPipeline: async (args) => {
      calls.runPipeline.push(args);
      return {
        produced: [
          { kind: "user_guide", record: { id: "TART-0001", title: "Stub user guide" } },
          { kind: "voiceover_script", record: { id: "TART-0002", title: "Stub voiceover" } },
        ],
        errors: [],
      };
    },
    defaultStoreRoot: "/tmp/training-stub-store",
    onLog: (line, jobId) => calls.logs.push({ jobId, line }),
    _calls: calls,
  };
}

// ─── registration ──────────────────────────────────────────────────────────

group(`registerTrainingGenHandler — registers '${TRAINING_GEN_KIND}'`);
{
  const reg = makeRegistry();
  registerTrainingGenHandler(reg, buildStubs());
  ok(`registry.has('${TRAINING_GEN_KIND}')`, reg.has(TRAINING_GEN_KIND));
  ok(`registry.list() includes it`, reg.list().includes(TRAINING_GEN_KIND));
}

// ─── happy path ────────────────────────────────────────────────────────────

group("handler — valid payload → runs pipeline, returns summary");
{
  const reg = makeRegistry();
  const deps = buildStubs();
  registerTrainingGenHandler(reg, deps);
  const result = await reg.get(TRAINING_GEN_KIND)({
    id: "JOB-101",
    payload: {
      ctx: { project_id: "proj-x", project_title: "Project X" },
      kinds: ["user_guide", "voiceover_script"],
    },
  });
  check("produced_count", result.produced_count, 2);
  check("errors_count",   result.errors_count, 0);
  check("produced_ids has 2", result.produced_ids.length, 2);
  check("first produced kind", result.produced_ids[0].kind, "user_guide");
  check("runPipeline called once", deps._calls.runPipeline.length, 1);
  check("runPipeline received correct kinds", deps._calls.runPipeline[0].kinds, ["user_guide", "voiceover_script"]);
  check("runPipeline received project_id", deps._calls.runPipeline[0].ctx.project_id, "proj-x");
  ok("onLog fired at least once", deps._calls.logs.length >= 1);
  ok("logs include start marker",  deps._calls.logs.some(l => l.line.includes("training_gen start")));
  ok("logs include done marker",   deps._calls.logs.some(l => l.line.includes("training_gen done")));
}

// ─── store_root resolution ────────────────────────────────────────────────

group("handler — payload.store_root overrides default");
{
  const reg = makeRegistry();
  const deps = buildStubs();
  registerTrainingGenHandler(reg, deps);
  await reg.get(TRAINING_GEN_KIND)({
    id: "JOB-102",
    payload: {
      ctx: { project_id: "p", project_title: "P" },
      store_root: "/tmp/custom-root",
    },
  });
  check("createTrainingStore got custom root", deps._calls.store[0], "/tmp/custom-root");
}

group("handler — no payload.store_root → uses deps.defaultStoreRoot");
{
  const reg = makeRegistry();
  const deps = buildStubs();
  registerTrainingGenHandler(reg, deps);
  await reg.get(TRAINING_GEN_KIND)({
    id: "JOB-103",
    payload: { ctx: { project_id: "p", project_title: "P" } },
  });
  check("createTrainingStore got default root", deps._calls.store[0], "/tmp/training-stub-store");
}

group("handler — no defaults + no payload + ctx.workingDir → uses workingDir");
{
  const reg = makeRegistry();
  const deps = { ...buildStubs(), defaultStoreRoot: undefined };
  registerTrainingGenHandler(reg, deps);
  await reg.get(TRAINING_GEN_KIND)(
    { id: "JOB-104", payload: { ctx: { project_id: "p", project_title: "P" } } },
    { workingDir: "/var/run/job-104" }
  );
  // Should resolve to /var/run/job-104/_training-store
  ok("createTrainingStore got workingDir-derived path",
     deps._calls.store[0] === "/var/run/job-104/_training-store");
}

// ─── error paths ───────────────────────────────────────────────────────────

group("handler — missing payload.ctx → throws");
{
  const reg = makeRegistry();
  registerTrainingGenHandler(reg, buildStubs());
  let threw = false;
  try { await reg.get(TRAINING_GEN_KIND)({ id: "JOB-105", payload: {} }); } catch { threw = true; }
  ok("throws on missing ctx", threw);
}

group("handler — missing project_title → throws");
{
  const reg = makeRegistry();
  registerTrainingGenHandler(reg, buildStubs());
  let threw = false;
  try { await reg.get(TRAINING_GEN_KIND)({ id: "JOB-106", payload: { ctx: { project_id: "p" } } }); } catch { threw = true; }
  ok("throws on missing project_title", threw);
}

group("handler — no defaults + no payload.store_root + no workingDir → throws");
{
  const reg = makeRegistry();
  const deps = { ...buildStubs(), defaultStoreRoot: undefined };
  registerTrainingGenHandler(reg, deps);
  let threw = false;
  try {
    await reg.get(TRAINING_GEN_KIND)(
      { id: "JOB-107", payload: { ctx: { project_id: "p", project_title: "P" } } }
    );
  } catch { threw = true; }
  ok("throws when store_root can't be resolved", threw);
}

// ─── errors path ───────────────────────────────────────────────────────────

group("handler — runPipeline returns errors → still returns + logs them");
{
  const reg = makeRegistry();
  const deps = buildStubs();
  // override runPipeline to return errors
  deps.runPipeline = async () => ({
    produced: [{ kind: "user_guide", record: { id: "TART-A", title: "Title A" } }],
    errors: [
      { kind: "voiceover_script", error: "stub: no transcript" },
      { kind: "video_storyboard", error: "stub: depends on voiceover" },
    ],
  });
  registerTrainingGenHandler(reg, deps);
  const result = await reg.get(TRAINING_GEN_KIND)({
    id: "JOB-108",
    payload: { ctx: { project_id: "p", project_title: "P" } },
  });
  check("produced_count", result.produced_count, 1);
  check("errors_count",   result.errors_count, 2);
  ok("errors[] preserved", result.errors.length === 2);
  ok("logs contain error markers", deps._calls.logs.some(l => l.line.includes("⚠️")));
}

// ─── dep validation ───────────────────────────────────────────────────────

group("registerTrainingGenHandler — dep validation");
{
  let t = 0;
  try { registerTrainingGenHandler(); }                                                 catch { t += 1; }
  try { registerTrainingGenHandler(makeRegistry()); }                                   catch { t += 1; }
  try { registerTrainingGenHandler(makeRegistry(), { createTrainingStore: () => {} }); } catch { t += 1; }
  try { registerTrainingGenHandler(makeRegistry(), { createTrainingStore: () => {}, createGeneratorRegistry: () => {} }); } catch { t += 1; }
  ok("4 missing-dep variants all throw", t === 4);
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
