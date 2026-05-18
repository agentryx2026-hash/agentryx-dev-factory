/**
 * Phase 17-B Tier B smoke test for the training_video_render queue handler.
 *
 *   node cognitive-engine/concurrency/handlers/training-video-handler.smoke.js
 *
 * Stubs every Phase 17-A dep so the test runs in-process without
 * filesystem, providers, or real video rendering.
 */

import assert from "node:assert/strict";
import {
  registerTrainingVideoRenderHandler,
  TRAINING_VIDEO_RENDER_KIND,
  DEFAULT_PROVIDER_CHOICE,
} from "./training-video-handler.js";

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

function buildStubs(opts = {}) {
  const calls = { store: [], regBuilt: 0, render: [], logs: [], progress: [] };
  return {
    createVideoStore: (root) => {
      calls.store.push(root);
      return { reserve: async () => ({ id: "VID-0001", renderDir: root + "/VID-0001", subdirs: {} }) };
    },
    createProviderRegistry: ({ defaults }) => {
      calls.regBuilt += 1; calls.defaults = defaults;
      return { resolve: () => ({ tts: {}, capture: {}, stitcher: {} }) };
    },
    renderFromPhase17Payload: async (args) => {
      calls.render.push(args);
      // simulate a progress event so onLog flow is exercised
      args.onProgress?.({ stage: "tts_start", beat_id: "B1" });
      args.onProgress?.({ stage: "stitch_done" });
      return opts.failure
        ? { id: "VID-FAILED", status: "failed", error: "stub failure", duration_ms: 0, cost_usd: 0 }
        : {
            id: "VID-0001",
            status: "done",
            duration_ms: 12345,
            cost_usd: 0.0123,
            mp4_ref: "video.mp4",
            thumbnail_ref: "thumbnail.png",
            captions_ref: "captions.srt",
            degraded: false,
          };
    },
    defaultStoreRoot: "/tmp/videos-stub-root",
    onLog: (line, jobId) => calls.logs.push({ jobId, line }),
    _calls: calls,
  };
}

const PHASE17_SAMPLE = {
  narration: [{ beat_id: "B1", text: "Welcome", target_duration_ms: 4000 }],
  capture_plan: [{ beat_id: "B1", url: "https://example/", actions: [] }],
  transitions: [],
  captions_srt: "1\n00:00:00,000 --> 00:00:04,000\nWelcome\n",
  total_duration_ms: 4000,
};

// ─── registration ──────────────────────────────────────────────────────────

group(`registerTrainingVideoRenderHandler — registers '${TRAINING_VIDEO_RENDER_KIND}'`);
{
  const reg = makeRegistry();
  registerTrainingVideoRenderHandler(reg, buildStubs());
  ok("registry.has", reg.has(TRAINING_VIDEO_RENDER_KIND));
  ok("registry.list includes", reg.list().includes(TRAINING_VIDEO_RENDER_KIND));
}

// ─── happy path ────────────────────────────────────────────────────────────

group("handler — valid payload (default providerChoice) → renders + returns artifact summary");
{
  const reg = makeRegistry();
  const deps = buildStubs();
  registerTrainingVideoRenderHandler(reg, deps);
  const result = await reg.get(TRAINING_VIDEO_RENDER_KIND)({
    id: "JOB-201",
    payload: { project_id: "proj", script_id: "TART-0001", phase17: PHASE17_SAMPLE },
  });

  check("video_id",      result.video_id, "VID-0001");
  check("status",        result.status, "done");
  check("duration_ms",   result.duration_ms, 12345);
  ok("cost_usd matches", Math.abs(result.cost_usd - 0.0123) < 1e-9);
  check("mp4_ref",       result.mp4_ref, "video.mp4");
  check("providers default = all null", result.providers, { ...DEFAULT_PROVIDER_CHOICE });

  check("renderFromPhase17Payload called once", deps._calls.render.length, 1);
  check("project_id passed through", deps._calls.render[0].project_id, "proj");
  check("script_id passed through",  deps._calls.render[0].script_id, "TART-0001");
  ok("phase17 forwarded",            deps._calls.render[0].phase17 === PHASE17_SAMPLE);
  check("providerChoice resolved to defaults",
        deps._calls.render[0].providerChoice, { ...DEFAULT_PROVIDER_CHOICE });

  ok("onLog fired at least once", deps._calls.logs.length >= 1);
  ok("logs include start",        deps._calls.logs.some(l => l.line.includes("video_render start")));
  ok("logs include done",         deps._calls.logs.some(l => l.line.includes("video_render done")));
  ok("onProgress forwarded → logs include 'tts_start'", deps._calls.logs.some(l => l.line.includes("tts_start")));
}

// ─── providerChoice override ──────────────────────────────────────────────

group("handler — payload.providerChoice partial override merges with defaults");
{
  const reg = makeRegistry();
  const deps = buildStubs();
  registerTrainingVideoRenderHandler(reg, deps);
  await reg.get(TRAINING_VIDEO_RENDER_KIND)({
    id: "JOB-202",
    payload: {
      project_id: "proj", script_id: "TART-2", phase17: PHASE17_SAMPLE,
      providerChoice: { tts: "stub-elevenlabs" },
    },
  });
  check("tts override applied",     deps._calls.render[0].providerChoice.tts, "stub-elevenlabs");
  check("capture stays default",    deps._calls.render[0].providerChoice.capture, "null");
  check("stitcher stays default",   deps._calls.render[0].providerChoice.stitcher, "null");
}

// ─── store_root resolution ────────────────────────────────────────────────

group("handler — payload.store_root overrides default");
{
  const reg = makeRegistry();
  const deps = buildStubs();
  registerTrainingVideoRenderHandler(reg, deps);
  await reg.get(TRAINING_VIDEO_RENDER_KIND)({
    id: "JOB-203",
    payload: { project_id: "p", script_id: "s", phase17: PHASE17_SAMPLE, store_root: "/tmp/custom" },
  });
  check("createVideoStore got custom root", deps._calls.store[0], "/tmp/custom");
}

group("handler — workingDir-derived store_root when defaults unset");
{
  const reg = makeRegistry();
  const deps = { ...buildStubs(), defaultStoreRoot: undefined };
  registerTrainingVideoRenderHandler(reg, deps);
  await reg.get(TRAINING_VIDEO_RENDER_KIND)(
    { id: "JOB-204", payload: { project_id: "p", script_id: "s", phase17: PHASE17_SAMPLE } },
    { workingDir: "/var/run/job-204" }
  );
  check("store path from workingDir", deps._calls.store[0], "/var/run/job-204/_videos-store");
}

// ─── failure path ─────────────────────────────────────────────────────────

group("handler — render returns failed artifact → handler returns it");
{
  const reg = makeRegistry();
  const deps = buildStubs({ failure: true });
  registerTrainingVideoRenderHandler(reg, deps);
  const result = await reg.get(TRAINING_VIDEO_RENDER_KIND)({
    id: "JOB-205",
    payload: { project_id: "p", script_id: "s", phase17: PHASE17_SAMPLE },
  });
  check("status = failed", result.status, "failed");
  check("video_id from failed artifact", result.video_id, "VID-FAILED");
  check("error preserved", result.error, "stub failure");
}

// ─── error paths ──────────────────────────────────────────────────────────

group("handler — missing payload fields → throws");
{
  const reg = makeRegistry();
  registerTrainingVideoRenderHandler(reg, buildStubs());
  const fn = reg.get(TRAINING_VIDEO_RENDER_KIND);
  let cnt = 0;
  try { await fn({ id: "JOB-X1", payload: {} }); } catch { cnt += 1; }
  try { await fn({ id: "JOB-X2", payload: { project_id: "p" } }); } catch { cnt += 1; }
  try { await fn({ id: "JOB-X3", payload: { project_id: "p", script_id: "s" } }); } catch { cnt += 1; }
  ok("3 missing-field variants all throw", cnt === 3);
}

group("handler — no defaults + no store_root + no workingDir → throws");
{
  const reg = makeRegistry();
  const deps = { ...buildStubs(), defaultStoreRoot: undefined };
  registerTrainingVideoRenderHandler(reg, deps);
  let threw = false;
  try {
    await reg.get(TRAINING_VIDEO_RENDER_KIND)({
      id: "JOB-X4", payload: { project_id: "p", script_id: "s", phase17: PHASE17_SAMPLE },
    });
  } catch { threw = true; }
  ok("throws when store_root unresolvable", threw);
}

// ─── dep validation ──────────────────────────────────────────────────────

group("registerTrainingVideoRenderHandler — dep validation");
{
  let cnt = 0;
  try { registerTrainingVideoRenderHandler(); }                                                                 catch { cnt += 1; }
  try { registerTrainingVideoRenderHandler(makeRegistry()); }                                                   catch { cnt += 1; }
  try { registerTrainingVideoRenderHandler(makeRegistry(), { createVideoStore: () => {} }); }                   catch { cnt += 1; }
  try { registerTrainingVideoRenderHandler(makeRegistry(), { createVideoStore: () => {}, createProviderRegistry: () => {} }); } catch { cnt += 1; }
  ok("4 missing-dep variants all throw", cnt === 4);
}

// ─── DEFAULT_PROVIDER_CHOICE shape ────────────────────────────────────────

group("DEFAULT_PROVIDER_CHOICE constant");
{
  check("tts = null",      DEFAULT_PROVIDER_CHOICE.tts, "null");
  check("capture = null",  DEFAULT_PROVIDER_CHOICE.capture, "null");
  check("stitcher = null", DEFAULT_PROVIDER_CHOICE.stitcher, "null");
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
