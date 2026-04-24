import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
  SCHEMA_VERSION, RENDER_STATUSES, PROVIDER_CATEGORIES,
  isValidStatus, isValidCategory,
} from "./types.js";
import {
  createNullTtsProvider, createStubElevenLabsProvider, createStubOpenAiProvider,
} from "./providers/tts.js";
import {
  createNullCaptureBackend, createStubPuppeteerBackend, createStubPlaywrightBackend,
} from "./providers/capture.js";
import {
  createNullStitcher, createStubFfmpegStitcher,
} from "./providers/stitcher.js";
import { createProviderRegistry } from "./providers/registry.js";
import { createVideoStore } from "./store.js";
import { renderVideo } from "./renderer.js";
import { renderFromPhase17Payload, renderFromScript } from "./pipeline.js";

import { createTrainingStore } from "../training-gen/store.js";
import { createGeneratorRegistry } from "../training-gen/generators.js";
import { runPipeline as runTrainingPipeline } from "../training-gen/pipeline.js";
import { renderVoiceoverForPhase17 } from "../training-gen/renderer.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

async function setupTmpRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "training-videos-"));
}

function samplePhase17Payload() {
  return {
    narration: [
      { id: "BEAT-1", text: "Welcome to the demo app. It has two features.", target_duration_ms: 5000 },
      { id: "BEAT-2", text: "Sign in with Google. One click.", target_duration_ms: 4000 },
      { id: "BEAT-3", text: "Your dashboard shows all projects.", target_duration_ms: 4500 },
    ],
    capture_plan: [
      { beat_id: "BEAT-1", url: "https://demo.example.com",         wait: "networkidle", action: "none" },
      { beat_id: "BEAT-2", url: "https://demo.example.com/login",   wait: "networkidle", action: "none" },
      { beat_id: "BEAT-3", url: "https://demo.example.com/dashboard", wait: "networkidle", action: "none" },
    ],
    transitions: [
      { beat_id: "BEAT-1", transition: "fade" },
      { beat_id: "BEAT-2", transition: "cut" },
      { beat_id: "BEAT-3", transition: "fade" },
    ],
    captions_srt:
      "1\n00:00:00,000 --> 00:00:05,000\nWelcome to the demo app.\n\n" +
      "2\n00:00:05,000 --> 00:00:09,000\nSign in with Google.\n\n" +
      "3\n00:00:09,000 --> 00:00:13,500\nYour dashboard.\n\n",
    total_duration_ms: 13500,
  };
}

function sampleTrainingCtx() {
  return {
    project_id: "demo-video-app",
    project_title: "Demo",
    project_summary: "A tiny demo app used for video smoke tests.",
    features: [
      { id: "FEAT-auth", title: "Sign in", description: "OAuth sign in.", entry_points: ["https://demo.example.com/login"] },
      { id: "FEAT-dash", title: "Dashboard", description: "Your overview.", entry_points: ["https://demo.example.com/dashboard"] },
    ],
    runtime: { base_url: "https://demo.example.com" },
  };
}

// ---------------------------------------------------------------------------
async function testTypes() {
  console.log("[types]");
  assert(SCHEMA_VERSION === 1, "schema_version is 1");
  assert(RENDER_STATUSES.length === 5, "5 render statuses");
  assert(PROVIDER_CATEGORIES.length === 3, "3 provider categories");
  assert(isValidStatus("queued") && isValidStatus("degraded"), "queued/degraded are valid statuses");
  assert(!isValidStatus("processing"), "processing not a valid status");
  assert(isValidCategory("tts") && isValidCategory("capture") && isValidCategory("stitcher"), "3 valid categories");
  assert(!isValidCategory("mashup"), "mashup not a valid category");
}

// ---------------------------------------------------------------------------
async function testTtsProviders() {
  console.log("[tts providers]");
  const root = await setupTmpRoot();
  try {
    const nullP = createNullTtsProvider();
    const elev = createStubElevenLabsProvider();
    const oai = createStubOpenAiProvider();

    assert(nullP.id === "tts:null", "null provider id");
    assert(elev.id.startsWith("tts:stub:elevenlabs:"), "elevenlabs stub id");
    assert(oai.id.startsWith("tts:stub:openai:"), "openai stub id");

    const beat = { id: "BEAT-1", narrator_text: "Hello world this is a test of five-ish seconds of audio.", target_duration_ms: 6000 };

    const nullOut = await nullP.synth(beat, { out_dir: root });
    assert(nullOut.cost_usd === 0, "null tts cost is 0");
    const nullBody = await fs.readFile(path.join(root, nullOut.audio_ref), "utf-8");
    assert(nullBody.includes("null-tts:BEAT-1"), "null tts writes marker");

    const elevOut = await elev.synth(beat, { out_dir: root });
    assert(elevOut.audio_ref.endsWith(".stub.json"), "elevenlabs stub writes json");
    assert(elevOut.cost_usd > 0, "elevenlabs stub has non-zero cost");
    assert(elevOut.actual_duration_ms > 0, "elevenlabs stub has actual_duration_ms");
    const elevBody = JSON.parse(await fs.readFile(path.join(root, elevOut.audio_ref), "utf-8"));
    assert(elevBody.provider === "elevenlabs", "elevenlabs payload tagged");

    const oaiOut = await oai.synth(beat, { out_dir: root });
    assert(oaiOut.cost_usd > 0, "openai stub has non-zero cost");
    assert(oaiOut.cost_usd < elevOut.cost_usd, "openai cheaper than elevenlabs per same text");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testCaptureBackends() {
  console.log("[capture backends]");
  const root = await setupTmpRoot();
  try {
    const nullC = createNullCaptureBackend();
    const pup = createStubPuppeteerBackend();
    const play = createStubPlaywrightBackend({ width: 1920, height: 1080 });

    assert(pup.id === "capture:stub:puppeteer:1280x720", "default puppeteer resolution in id");
    assert(play.id === "capture:stub:playwright:1920x1080", "playwright reads init opts");

    const cue = { url: "https://example.com", wait: "networkidle" };
    const out = await pup.capture(cue, { out_dir: root, beat_id: "BEAT-1" });
    assert(out.width === 1280 && out.height === 720, "puppeteer default dimensions");
    const body = JSON.parse(await fs.readFile(path.join(root, out.image_ref), "utf-8"));
    assert(body.backend === "puppeteer", "capture payload tagged puppeteer");
    assert(body.url === "https://example.com", "cue url stamped");

    const nullOut = await nullC.capture(cue, { out_dir: root, beat_id: "BEAT-2" });
    assert(nullOut.width === 0 && nullOut.height === 0, "null capture has 0 dimensions");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testStitchers() {
  console.log("[stitchers]");
  const root = await setupTmpRoot();
  try {
    const nullS = createNullStitcher();
    const ffmpeg = createStubFfmpegStitcher();
    const beats = [
      { id: "BEAT-1", audio_ref: "audio/a.json", capture_ref: "capture/c.json", duration_ms: 5000 },
      { id: "BEAT-2", audio_ref: "audio/b.json", capture_ref: null, duration_ms: 3000 },
    ];
    const srt = "1\n00:00:00,000 --> 00:00:05,000\nHi\n\n";

    const fOut = await ffmpeg.assemble({ beats, transitions: [{ beat_id: "BEAT-1", transition: "fade" }], captions_srt: srt, output_dir: root });
    assert(fOut.duration_ms === 8000, "ffmpeg total duration sum");
    const plan = JSON.parse(await fs.readFile(path.join(root, fOut.mp4_ref), "utf-8"));
    assert(plan.inputs.length === 2, "ffmpeg plan has both beats");
    assert(plan.transitions.length === 1, "ffmpeg plan transitions forwarded");
    const srtOnDisk = await fs.readFile(path.join(root, "captions.srt"), "utf-8");
    assert(srtOnDisk === srt, "captions.srt written");

    const nOut = await nullS.assemble({ beats, captions_srt: srt, output_dir: path.join(root, "null-out") });
    assert(nOut.cost_usd === 0 && nOut.duration_ms === 8000, "null stitcher still reports duration");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function testProviderRegistry() {
  console.log("[provider registry]");
  const reg = createProviderRegistry();
  assert(reg.categories().length === 3, "3 categories");
  assert(reg.list("tts").length === 3, "3 default tts providers");
  assert(reg.list("capture").length === 3, "3 default capture backends");
  assert(reg.list("stitcher").length === 2, "2 default stitchers");
  assert(reg.has("tts", "tts:null"), "tts:null registered");

  try { reg.register("wat", { id: "x", synth: async () => {} }); throw new Error("should reject"); }
  catch (e) { assert(/invalid category/.test(e.message), "invalid category rejected"); }

  try { reg.register("tts", { id: "tts:bad" }); throw new Error("should reject"); }
  catch (e) { assert(/synth/.test(e.message), "tts without synth rejected"); }

  try { reg.register("capture", { id: "capture:bad" }); throw new Error("should reject"); }
  catch (e) { assert(/capture/.test(e.message), "capture without capture() rejected"); }

  try { reg.register("stitcher", { id: "stitcher:bad" }); throw new Error("should reject"); }
  catch (e) { assert(/assemble/.test(e.message), "stitcher without assemble() rejected"); }

  const resolved = reg.resolve({
    tts: "tts:null",
    capture: "capture:null",
    stitcher: "stitcher:null",
  });
  assert(resolved.tts.id === "tts:null", "resolve returns instance");

  try { reg.resolve({ tts: "tts:nope", capture: "capture:null", stitcher: "stitcher:null" }); throw new Error("should fail"); }
  catch (e) { assert(/unknown tts provider/.test(e.message), "resolve missing provider throws"); }
}

// ---------------------------------------------------------------------------
async function testStoreReserveAndCommit() {
  console.log("[store reserve + commit + readManifest + readLog + stats]");
  const root = await setupTmpRoot();
  try {
    const store = createVideoStore(root);
    const r1 = await store.reserve("demo-video-app");
    assert(r1.id === "VID-0001", "first VID-0001");
    assert(r1.renderDir.endsWith("VID-0001"), "render dir path");

    const r2 = await store.reserve("demo-video-app");
    assert(r2.id === "VID-0002", "second VID-0002");

    try { await store.reserve("bad id!"); throw new Error("should reject"); }
    catch (e) { assert(/invalid project_id/.test(e.message), "bad project_id rejected"); }

    // commit
    const manifest = await store.commit("demo-video-app", {
      id: r1.id,
      project_id: "demo-video-app",
      script_id: "TART-0001",
      status: "done",
      providers: { tts: "tts:null", capture: "capture:null", stitcher: "stitcher:null" },
      beats: [{ id: "BEAT-1", ok: true }],
      mp4_ref: "video.null.mp4",
      duration_ms: 5000,
      cost_usd: 0,
      created_at: new Date().toISOString(),
    });
    assert(manifest.schema_version === 1, "manifest stamped with schema_version");

    const read = await store.readManifest("demo-video-app", "VID-0001");
    assert(read.status === "done", "manifest roundtrip");
    const missing = await store.readManifest("demo-video-app", "VID-9999");
    assert(missing === null, "missing returns null");

    await store.appendLog(r1.renderDir, { beat_id: "BEAT-1", stage: "tts", ok: true });
    await store.appendLog(r1.renderDir, { beat_id: "BEAT-1", stage: "capture", ok: true });
    const log = await store.readLog("demo-video-app", "VID-0001");
    assert(log.length === 2, "2 log entries");
    assert(log[0].stage === "tts" && log[1].stage === "capture", "log ordering preserved");

    const list = await store.list("demo-video-app");
    assert(list.length === 1, "1 committed manifest listed (VID-0002 still open)");
    assert(list[0].id === "VID-0001", "list newest-first / only committed");

    const stats = await store.stats("demo-video-app");
    assert(stats.total === 1 && stats.by_status.done === 1, "stats count + by_status correct");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function testRendererHappyPath() {
  console.log("[renderer — happy path end-to-end with stub providers]");
  const root = await setupTmpRoot();
  try {
    const store = createVideoStore(root);
    const reg = createProviderRegistry();
    const reservation = await store.reserve("demo-video-app");
    const phase17 = samplePhase17Payload();

    const events = [];
    const providers = reg.resolve({
      tts: "tts:stub:elevenlabs:rachel",
      capture: "capture:stub:puppeteer:1280x720",
      stitcher: "stitcher:stub:ffmpeg:1280x720",
    });
    const result = await renderVideo({
      phase17,
      providers,
      renderDir: reservation.renderDir,
      subdirs: reservation.subdirs,
      appendLog: (e) => store.appendLog(reservation.renderDir, e),
      onProgress: (e) => events.push(e),
    });

    assert(result.status === "done", `status is done (got ${result.status})`);
    assert(result.beats.length === 3, "3 beat results");
    assert(result.beats.every(b => b.ok), "all beats ok");
    assert(result.cost_usd > 0, "aggregate cost > 0 for stub providers");
    assert(result.duration_ms > 0, "duration > 0");
    assert(result.mp4_ref, "mp4_ref present");

    const auditLog = await store.readLog("demo-video-app", reservation.id);
    const ttsEvents = auditLog.filter(e => e.stage === "tts");
    const capEvents = auditLog.filter(e => e.stage === "capture");
    const stitchEvents = auditLog.filter(e => e.stage === "stitch");
    assert(ttsEvents.length === 3, "3 tts log entries");
    assert(capEvents.length === 3, "3 capture log entries");
    assert(stitchEvents.length === 1 && stitchEvents[0].ok, "1 stitch ok entry");

    const startEvents = events.filter(e => e.type === "start");
    const endEvents = events.filter(e => e.type === "end");
    assert(startEvents.length === 1, "onProgress emitted start");
    assert(endEvents.length === 1, "onProgress emitted end");
    assert(endEvents[0].detail.status === "done", "end event reports done");

    // Assets on disk
    for (const beat of phase17.narration) {
      const audioPath = path.join(reservation.subdirs.audio, `${beat.id}.stub.json`);
      const capturePath = path.join(reservation.subdirs.capture, `${beat.id}.stub.json`);
      await fs.access(audioPath);
      await fs.access(capturePath);
    }
    const mp4Path = path.join(reservation.renderDir, result.mp4_ref);
    await fs.access(mp4Path);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testRendererDegraded() {
  console.log("[renderer — degraded mode on per-beat tts failure]");
  const root = await setupTmpRoot();
  try {
    const store = createVideoStore(root);
    const reservation = await store.reserve("demo-video-app");
    const phase17 = samplePhase17Payload();

    let calls = 0;
    const flakyTts = {
      id: "tts:flaky",
      async synth(beat, opts) {
        calls += 1;
        if (calls === 2) throw new Error("simulated tts blip");
        return {
          audio_ref: `${beat.id}.ok.txt`,
          actual_duration_ms: beat.target_duration_ms || 4000,
          cost_usd: 0.01,
        };
      },
    };
    // write pretend asset files
    await fs.mkdir(reservation.subdirs.audio, { recursive: true });

    const reg = createProviderRegistry();
    reg.register("tts", flakyTts);
    const providers = {
      tts: flakyTts,
      capture: reg.get("capture", "capture:null"),
      stitcher: reg.get("stitcher", "stitcher:null"),
    };

    const result = await renderVideo({
      phase17, providers,
      renderDir: reservation.renderDir, subdirs: reservation.subdirs,
      appendLog: (e) => store.appendLog(reservation.renderDir, e),
    });
    assert(result.status === "degraded", `status is degraded (got ${result.status})`);
    assert(result.beats.length === 3, "3 beats recorded");
    const okBeats = result.beats.filter(b => b.ok);
    assert(okBeats.length === 2, "2 beats ok, 1 failed");
    assert(result.degraded === true, "degraded flag set");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testRendererAllBeatsFail() {
  console.log("[renderer — fails when every beat fails]");
  const root = await setupTmpRoot();
  try {
    const store = createVideoStore(root);
    const reservation = await store.reserve("demo-video-app");
    const phase17 = samplePhase17Payload();

    const alwaysFailTts = {
      id: "tts:broken",
      async synth() { throw new Error("always broken"); },
    };
    const reg = createProviderRegistry();
    const providers = {
      tts: alwaysFailTts,
      capture: reg.get("capture", "capture:null"),
      stitcher: reg.get("stitcher", "stitcher:null"),
    };

    const result = await renderVideo({
      phase17, providers,
      renderDir: reservation.renderDir, subdirs: reservation.subdirs,
      appendLog: (e) => store.appendLog(reservation.renderDir, e),
    });
    assert(result.status === "failed", "status is failed");
    assert(/no successful beats/i.test(result.error || ""), "error message names cause");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testRendererEmptyPayload() {
  console.log("[renderer — empty narration fails fast]");
  const root = await setupTmpRoot();
  try {
    const store = createVideoStore(root);
    const reservation = await store.reserve("demo-video-app");
    const reg = createProviderRegistry();
    const providers = reg.resolve({ tts: "tts:null", capture: "capture:null", stitcher: "stitcher:null" });
    const result = await renderVideo({
      phase17: { narration: [], capture_plan: [], transitions: [], captions_srt: "", total_duration_ms: 0 },
      providers, renderDir: reservation.renderDir, subdirs: reservation.subdirs,
      appendLog: (e) => store.appendLog(reservation.renderDir, e),
    });
    assert(result.status === "failed", "empty narration → failed");
    assert(/empty narration/i.test(result.error), "error message is 'empty narration'");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function testPipelineFromPayload() {
  console.log("[pipeline — renderFromPhase17Payload]");
  const root = await setupTmpRoot();
  try {
    const store = createVideoStore(root);
    const registry = createProviderRegistry();

    const events = [];
    const artifact = await renderFromPhase17Payload({
      project_id: "demo-video-app",
      script_id: "TART-0001",
      phase17: samplePhase17Payload(),
      providerChoice: {
        tts: "tts:stub:openai:tts-1:alloy",
        capture: "capture:stub:playwright:1280x720",
        stitcher: "stitcher:stub:ffmpeg:1280x720",
      },
      store, registry,
      onProgress: (e) => events.push(e),
    });

    assert(artifact.id === "VID-0001", "artifact id is VID-0001");
    assert(artifact.status === "done", "artifact status done");
    assert(artifact.providers.tts === "tts:stub:openai:tts-1:alloy", "providers recorded on manifest");
    assert(Array.isArray(artifact.beats) && artifact.beats.length === 3, "manifest has 3 beats");
    assert(artifact.cost_usd > 0, "manifest cost > 0 with stub providers");
    assert(artifact.created_at && artifact.rendered_at, "created_at + rendered_at stamped");

    const manifestOnDisk = await store.readManifest("demo-video-app", artifact.id);
    assert(manifestOnDisk.status === "done", "manifest roundtrips from disk");

    const log = await store.readLog("demo-video-app", artifact.id);
    const pipelineEvents = log.filter(e => e.stage === "pipeline");
    assert(pipelineEvents.length === 2, "pipeline start + end log entries");
    assert(pipelineEvents[1].details.action === "end", "pipeline end entry");

    // Progress events cover the expected phases
    const kinds = new Set(events.map(e => e.type));
    assert(kinds.has("start") && kinds.has("beat") && kinds.has("stitch") && kinds.has("end"),
      "progress events cover start/beat/stitch/end");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testPipelineFromScript() {
  console.log("[pipeline — renderFromScript wired to Phase 16-A training-gen]");
  const root = await setupTmpRoot();
  try {
    // Build a real Phase 16-A voiceover_script via the training-gen pipeline.
    const trainingRoot = path.join(root, "training");
    const trainingStore = createTrainingStore(trainingRoot);
    const trainingRegistry = createGeneratorRegistry();
    const ctx = sampleTrainingCtx();
    const out = await runTrainingPipeline({
      ctx, store: trainingStore, registry: trainingRegistry,
      kinds: ["voiceover_script", "video_storyboard"],
    });
    assert(out.produced.length === 2, "training-gen produced voiceover + storyboard");

    const scriptRec = await trainingStore.readLatest(ctx.project_id, "voiceover_script");
    assert(scriptRec && scriptRec.record.kind === "voiceover_script", "voiceover record fetched");

    const videoStore = createVideoStore(root);
    const registry = createProviderRegistry();
    const artifact = await renderFromScript({
      scriptRecord: scriptRec.record,
      scriptContent: scriptRec.content,
      renderVoiceoverForPhase17,
      providerChoice: {
        tts: "tts:null",
        capture: "capture:null",
        stitcher: "stitcher:null",
      },
      store: videoStore, registry,
    });
    assert(artifact.status === "done", "real-voiceover E2E status done");
    assert(artifact.script_id === scriptRec.record.id, "video references training TART id");
    assert(artifact.project_id === ctx.project_id, "project_id propagated");
    assert(artifact.cost_usd === 0, "null providers produce $0 cost");
    assert(artifact.beats.length === scriptRec.content.beats.length, "beat count matches script");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testPipelineValidation() {
  console.log("[pipeline — validation]");
  const root = await setupTmpRoot();
  try {
    const store = createVideoStore(root);
    const registry = createProviderRegistry();
    try {
      await renderFromPhase17Payload({
        project_id: "", script_id: "x", phase17: samplePhase17Payload(),
        providerChoice: { tts: "tts:null", capture: "capture:null", stitcher: "stitcher:null" },
        store, registry,
      });
      throw new Error("should reject");
    } catch (e) { assert(/project_id required/.test(e.message), "missing project_id rejected"); }

    try {
      await renderFromPhase17Payload({
        project_id: "demo", script_id: "x", phase17: samplePhase17Payload(),
        providerChoice: { tts: "tts:null", capture: "capture:null" },   // missing stitcher
        store, registry,
      });
      throw new Error("should reject");
    } catch (e) { assert(/providerChoice/.test(e.message), "missing stitcher in providerChoice rejected"); }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function main() {
  try {
    await testTypes();                  console.log("");
    await testTtsProviders();           console.log("");
    await testCaptureBackends();        console.log("");
    await testStitchers();              console.log("");
    await testProviderRegistry();       console.log("");
    await testStoreReserveAndCommit();  console.log("");
    await testRendererHappyPath();      console.log("");
    await testRendererDegraded();       console.log("");
    await testRendererAllBeatsFail();   console.log("");
    await testRendererEmptyPayload();   console.log("");
    await testPipelineFromPayload();    console.log("");
    await testPipelineFromScript();     console.log("");
    await testPipelineValidation();
    console.log("\n[smoke] OK");
  } catch (e) {
    console.error(`\n[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
