import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  SCHEMA_VERSION, TRAINING_KINDS, TRANSITIONS, isValidKind, isValidTransition, formatFor,
} from "./types.js";
import { createTrainingStore } from "./store.js";
import {
  createGeneratorRegistry,
  userGuideTemplate, quickStartTemplate, howToTemplate, referenceDocTemplate,
  voiceoverScriptTemplate, videoStoryboardTemplate,
} from "./generators.js";
import { runPipeline } from "./pipeline.js";
import {
  summarize, renderMarkdown, renderVoiceoverForPhase17, captionsFromVoiceover,
} from "./renderer.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

async function setupTmpRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "training-gen-"));
}

function sampleCtx() {
  return {
    project_id: "demo-app",
    project_title: "Demo App",
    project_summary: "A tiny demo app used for smoke tests. It has two features.",
    features: [
      { id: "FEAT-auth", title: "Sign in", description: "OAuth-based sign in with Google.", entry_points: ["/login"] },
      { id: "FEAT-dash", title: "Dashboard", description: "Your projects at a glance.", entry_points: ["/dashboard"] },
    ],
    runtime: { base_url: "https://demo.example.com" },
    artifacts: {
      apis: [
        { method: "GET", path: "/api/projects", description: "List projects.", params: [{ name: "limit", type: "int" }] },
        { method: "POST", path: "/api/projects", description: "Create a project." },
      ],
      configs: [
        { id: "cost_thresholds", description: "Warn and hard-cap budgets per scope × window." },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
async function testTypes() {
  console.log("[types]");
  assert(SCHEMA_VERSION === 1, "schema_version is 1");
  assert(TRAINING_KINDS.length === 6, "6 training kinds");
  assert(TRANSITIONS.length === 4, "4 transitions");
  assert(isValidKind("user_guide"), "user_guide valid");
  assert(!isValidKind("movie_script"), "movie_script invalid");
  assert(isValidTransition("fade"), "fade valid");
  assert(!isValidTransition("spin"), "spin invalid");
  assert(formatFor("user_guide") === "markdown", "user_guide is markdown");
  assert(formatFor("voiceover_script") === "json", "voiceover_script is json");
  assert(formatFor("video_storyboard") === "json", "video_storyboard is json");
}

// ---------------------------------------------------------------------------
async function testStoreBasics() {
  console.log("[store basics]");
  const root = await setupTmpRoot();
  try {
    const store = createTrainingStore(root);

    const r1 = await store.write({
      project_id: "demo-app", kind: "user_guide",
      title: "Demo — User Guide",
      content: "# Demo\n\nHello.\n",
      produced_by: { generator_id: "generator:test" },
    });
    assert(r1.id === "TART-0001", "first id is TART-0001");
    assert(r1.content_ref.endsWith(".md"), "user_guide stored as .md");
    assert(r1.content_sha256.length === 64, "sha256 recorded");

    const r2 = await store.write({
      project_id: "demo-app", kind: "voiceover_script",
      title: "Demo — Voiceover",
      content: { schema_version: 1, beats: [] },
      produced_by: { generator_id: "generator:test" },
    });
    assert(r2.id === "TART-0002", "second id is TART-0002");
    assert(r2.content_ref.endsWith(".json"), "voiceover_script stored as .json");

    const list = await store.list("demo-app");
    assert(list.length === 2, "2 records listed");
    assert(list[0].id === "TART-0002", "list is newest-first");

    const onlyGuide = await store.list("demo-app", { kind: "user_guide" });
    assert(onlyGuide.length === 1 && onlyGuide[0].kind === "user_guide", "kind filter works");

    const stats = await store.stats("demo-app");
    assert(stats.total === 2, "stats.total=2");
    assert(stats.by_kind.user_guide === 1 && stats.by_kind.voiceover_script === 1, "stats by_kind correct");

    const latest = await store.latest("demo-app");
    assert(latest.user_guide === "TART-0001", "latest.user_guide pointer set");
    assert(latest.voiceover_script === "TART-0002", "latest.voiceover_script pointer set");

    const { record, content } = await store.read("demo-app", "TART-0001");
    assert(record.id === "TART-0001", "round-trip record id");
    assert(typeof content === "string" && content.includes("Hello."), "round-trip markdown content");

    const voiceRead = await store.read("demo-app", "TART-0002");
    assert(typeof voiceRead.content === "object", "voiceover content parsed as JSON");

    // verify on-disk sha matches index
    const verify = await store.verify("demo-app");
    assert(verify.ok && verify.mismatched.length === 0, "verify passes; no tampering");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testStoreValidation() {
  console.log("[store validation]");
  const root = await setupTmpRoot();
  try {
    const store = createTrainingStore(root);
    try { await store.write({ project_id: "x", kind: "bogus", title: "t", content: "c", produced_by: { generator_id: "g" } }); throw new Error("should reject"); }
    catch (e) { assert(/invalid kind/.test(e.message), "invalid kind rejected"); }
    try { await store.write({ project_id: "x", kind: "user_guide", content: "c", produced_by: { generator_id: "g" } }); throw new Error("should reject"); }
    catch (e) { assert(/title required/.test(e.message), "missing title rejected"); }
    try { await store.write({ project_id: "x", kind: "user_guide", title: "t", produced_by: { generator_id: "g" } }); throw new Error("should reject"); }
    catch (e) { assert(/content required/.test(e.message), "missing content rejected"); }
    try { await store.write({ project_id: "x", kind: "user_guide", title: "t", content: "c" }); throw new Error("should reject"); }
    catch (e) { assert(/generator_id required/.test(e.message), "missing generator_id rejected"); }
    try { await store.write({ project_id: "bad id!", kind: "user_guide", title: "t", content: "c", produced_by: { generator_id: "g" } }); throw new Error("should reject"); }
    catch (e) { assert(/invalid project_id/.test(e.message), "bad project_id rejected"); }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testStoreAppendOnlyAndLatest() {
  console.log("[store append-only + latest pointer]");
  const root = await setupTmpRoot();
  try {
    const store = createTrainingStore(root);
    const r1 = await store.write({ project_id: "p", kind: "user_guide", title: "v1", content: "v1 body", produced_by: { generator_id: "g" } });
    const r2 = await store.write({ project_id: "p", kind: "user_guide", title: "v2", content: "v2 body", produced_by: { generator_id: "g" } });
    assert(r1.id !== r2.id, "regeneration gets a new id");
    const all = await store.list("p", { kind: "user_guide" });
    assert(all.length === 2, "both versions retained (append-only)");
    const latest = await store.readLatest("p", "user_guide");
    assert(latest.record.id === r2.id, "readLatest returns v2");
    assert(typeof latest.content === "string" && latest.content.includes("v2 body"), "readLatest returns v2 content");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function testGeneratorsEach() {
  console.log("[generators — each produces valid output]");
  const ctx = sampleCtx();

  const ug = await userGuideTemplate(ctx);
  assert(ug.title.includes("Demo App"), "user_guide title includes project title");
  assert(typeof ug.content === "string" && ug.content.includes("## Features"), "user_guide markdown includes Features section");
  assert(ug.meta.feature_count === 2, "user_guide meta.feature_count=2");

  const qs = await quickStartTemplate(ctx);
  assert(qs.content.includes("## Steps"), "quick_start has Steps");
  assert(qs.meta.step_count >= 1, "quick_start.step_count ≥ 1");

  const ht = await howToTemplate(ctx, { feature: ctx.features[1] });
  assert(ht.title.includes("Dashboard"), "how_to target feature respected");
  assert(ht.meta.feature_id === "FEAT-dash", "how_to.feature_id=FEAT-dash");

  const rd = await referenceDocTemplate(ctx);
  assert(rd.content.includes("## API"), "reference_doc has API section");
  assert(rd.content.includes("## Configuration"), "reference_doc has Configuration section");
  assert(rd.meta.api_count === 2 && rd.meta.config_count === 1, "reference_doc meta counts");

  const vo = await voiceoverScriptTemplate(ctx);
  assert(typeof vo.content === "object" && Array.isArray(vo.content.beats), "voiceover content is an object with beats");
  assert(vo.content.beats.length >= 3, `voiceover has ≥3 beats (got ${vo.content.beats.length})`);
  vo.content.beats.forEach(b => {
    assert(typeof b.id === "string" && b.id.startsWith("BEAT-"), `voiceover beat ${b.id} id shape`);
    assert(typeof b.target_duration_ms === "number", `voiceover beat ${b.id} has target_duration_ms`);
    assert(typeof b.narrator_text === "string" && b.narrator_text.length > 0, `voiceover beat ${b.id} narrator_text non-empty`);
  });
  assert(vo.meta.target_duration_total_ms > 0, "voiceover total duration > 0");

  const sb = await videoStoryboardTemplate(ctx, { voiceover: { record: { id: "TART-0007" }, content: vo.content } });
  assert(sb.parent_ids.includes("TART-0007"), "storyboard parent_ids includes voiceover TART id");
  assert(sb.content.beats.length === vo.content.beats.length, "storyboard beats count matches voiceover");
  assert(sb.content.beats[0].title === "Scene 1", "storyboard first beat title is Scene 1");
}

async function testGeneratorRegistry() {
  console.log("[generator registry]");
  const reg = createGeneratorRegistry();
  assert(reg.list().length === 6, "defaults registers 6 kinds");
  assert(reg.has("user_guide"), "has user_guide");
  assert(reg.get("user_guide").id === "generator:template:user_guide", "id convention");

  // Custom swap
  reg.register("user_guide", { id: "generator:test:custom", fn: async () => ({ title: "custom", content: "custom body" }) });
  const out = await reg.get("user_guide").fn({});
  assert(out.title === "custom", "custom generator swapped in");

  try { reg.register("bogus", { id: "x", fn: async () => ({}) }); throw new Error("should reject"); }
  catch (e) { assert(/invalid kind/.test(e.message), "register: invalid kind rejected"); }
  try { reg.register("how_to", { id: "y" }); throw new Error("should reject"); }
  catch (e) { assert(/fn required/.test(e.message), "register: missing fn rejected"); }

  const empty = createGeneratorRegistry({ defaults: false });
  assert(empty.list().length === 0, "defaults:false gives empty registry");
}

// ---------------------------------------------------------------------------
async function testPipeline() {
  console.log("[pipeline — full flow]");
  const root = await setupTmpRoot();
  try {
    const store = createTrainingStore(root);
    const registry = createGeneratorRegistry();
    const ctx = sampleCtx();

    const result = await runPipeline({ ctx, store, registry });
    assert(result.errors.length === 0, `no errors (got ${result.errors.length})`);
    assert(result.produced.length === 6, `6 artifacts produced (got ${result.produced.length})`);

    const stats = await store.stats(ctx.project_id);
    assert(stats.total === 6, "6 records in store");
    assert(TRAINING_KINDS.every(k => stats.by_kind[k] === 1), "each kind appears exactly once");

    // Storyboard should be parented to voiceover
    const latestSb = await store.readLatest(ctx.project_id, "video_storyboard");
    const latestVo = await store.readLatest(ctx.project_id, "voiceover_script");
    assert(latestSb.record.parent_ids.includes(latestVo.record.id), "storyboard parent_ids contains voiceover id");
    assert(latestSb.record.parent_ids.length === 1, "storyboard has exactly one parent (the voiceover)");

    // Verify disk integrity
    const verify = await store.verify(ctx.project_id);
    assert(verify.ok, "verify: all sha256 match");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testPipelineSubset() {
  console.log("[pipeline — subset of kinds]");
  const root = await setupTmpRoot();
  try {
    const store = createTrainingStore(root);
    const registry = createGeneratorRegistry();
    const ctx = sampleCtx();

    const result = await runPipeline({
      ctx, store, registry,
      kinds: ["voiceover_script", "video_storyboard"],
    });
    assert(result.produced.length === 2, "2 artifacts for subset");
    const kinds = result.produced.map(p => p.kind);
    assert(kinds[0] === "voiceover_script" && kinds[1] === "video_storyboard",
      "pipeline orders voiceover before storyboard regardless of request order");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testPipelineGeneratorFailure() {
  console.log("[pipeline — isolates generator failures]");
  const root = await setupTmpRoot();
  try {
    const store = createTrainingStore(root);
    const registry = createGeneratorRegistry();
    const ctx = sampleCtx();

    registry.register("user_guide", {
      id: "generator:failing",
      fn: async () => { throw new Error("intentional failure"); },
    });

    const result = await runPipeline({ ctx, store, registry });
    assert(result.errors.length === 1, "1 error for failing generator");
    assert(result.errors[0].kind === "user_guide" && /intentional/.test(result.errors[0].error),
      "error is captured with kind + message");
    assert(result.produced.length === 5, "other 5 kinds still produced");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function testRenderer() {
  console.log("[renderer]");
  const ctx = sampleCtx();
  const vo = await voiceoverScriptTemplate(ctx);

  const voRecord = {
    id: "TART-0001", kind: "voiceover_script", title: vo.title,
    format: "json", project_id: ctx.project_id,
  };

  // Phase 17 payload
  const payload = renderVoiceoverForPhase17(voRecord, vo.content);
  assert(payload.narration.length === vo.content.beats.length, "Phase-17 narration length matches beats");
  assert(payload.capture_plan.length >= 1, "Phase-17 capture_plan has at least one cue");
  assert(payload.transitions.length >= 1, "Phase-17 transitions recorded");
  assert(payload.total_duration_ms === vo.meta.target_duration_total_ms, "Phase-17 total_duration_ms matches meta");
  assert(payload.captions_srt.includes("-->"), "Phase-17 captions_srt is SRT-shaped");
  assert(payload.captions_srt.split("\n\n").length >= vo.content.beats.length, "captions block per beat");

  // Markdown rendering
  const md = renderMarkdown(voRecord, vo.content);
  assert(md.startsWith("# "), "voiceover renderMarkdown has h1 title");
  assert(md.includes("| Beat |"), "voiceover renderMarkdown is a table");

  const guideRecord = {
    id: "TART-0002", kind: "user_guide", title: "Demo — User Guide",
    format: "markdown", project_id: ctx.project_id,
  };
  const ugContent = (await userGuideTemplate(ctx)).content;
  const ugMd = renderMarkdown(guideRecord, ugContent);
  assert(ugMd === ugContent, "markdown kinds passthrough");

  // Summaries
  const voSummary = summarize(voRecord, vo.content);
  assert(/beats/.test(voSummary) && /s$/.test(voSummary), "voiceover summary mentions beats + seconds");

  // Invalid kind
  try { renderMarkdown({ id: "X", kind: "bogus" }, "x"); throw new Error("should reject"); }
  catch (e) { assert(/invalid kind/.test(e.message), "renderMarkdown rejects invalid kind"); }
}

async function testRendererSrtTiming() {
  console.log("[renderer — SRT timing continuous]");
  const beats = [
    { id: "BEAT-1", narrator_text: "A",  target_duration_ms: 1000 },
    { id: "BEAT-2", narrator_text: "B",  target_duration_ms: 2000 },
    { id: "BEAT-3", narrator_text: "C",  target_duration_ms: 3500 },
  ];
  const srt = captionsFromVoiceover({ beats });
  assert(srt.includes("00:00:00,000 --> 00:00:01,000"), "BEAT-1 timing correct");
  assert(srt.includes("00:00:01,000 --> 00:00:03,000"), "BEAT-2 timing correct");
  assert(srt.includes("00:00:03,000 --> 00:00:06,500"), "BEAT-3 timing correct");
}

// ---------------------------------------------------------------------------
async function testEndToEnd() {
  console.log("[end-to-end: pipeline → renderer → Phase 17 payload]");
  const root = await setupTmpRoot();
  try {
    const store = createTrainingStore(root);
    const registry = createGeneratorRegistry();
    const ctx = sampleCtx();

    await runPipeline({ ctx, store, registry });
    const latestVo = await store.readLatest(ctx.project_id, "voiceover_script");
    const payload = renderVoiceoverForPhase17(latestVo.record, latestVo.content);

    // What Phase 17 needs:
    //   1. narration text per beat (for ElevenLabs)
    //   2. screen-capture plan (for headless browser)
    //   3. transitions (for the final stitching)
    //   4. captions file (for video subtitles)
    //   5. total duration (for cost estimate)
    assert(payload.narration.every(n => n.text.length > 0), "every narration has text");
    assert(payload.narration.every(n => n.target_duration_ms > 0), "every narration has duration");
    assert(payload.capture_plan.every(c => c.url), "every capture entry has url");
    assert(payload.captions_srt.length > 0, "captions_srt non-empty");
    assert(payload.total_duration_ms > 0, "total_duration_ms > 0");

    // Confirm storyboard references voiceover by TART id
    const latestSb = await store.readLatest(ctx.project_id, "video_storyboard");
    assert(latestSb.record.parent_ids.includes(latestVo.record.id), "E2E: storyboard parents voiceover");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function main() {
  try {
    await testTypes();                       console.log("");
    await testStoreBasics();                 console.log("");
    await testStoreValidation();             console.log("");
    await testStoreAppendOnlyAndLatest();    console.log("");
    await testGeneratorsEach();              console.log("");
    await testGeneratorRegistry();           console.log("");
    await testPipeline();                    console.log("");
    await testPipelineSubset();              console.log("");
    await testPipelineGeneratorFailure();    console.log("");
    await testRenderer();                    console.log("");
    await testRendererSrtTiming();           console.log("");
    await testEndToEnd();
    console.log("\n[smoke] OK");
  } catch (e) {
    console.error(`\n[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
