/**
 * Cross-phase composition smoke — exercises all 16 A-tier modules in a single
 * end-to-end story, in a single workspace, with one customer journey.
 *
 * What this validates (that per-module smokes don't):
 *   1. Data flow correctness across module boundaries — the customer_id from
 *      Phase 19-A flows into Phase 20-A's metering/retention/compliance;
 *      Phase 16-A's voiceover_script flows into Phase 17-A's renderer; etc.
 *   2. Storage layout coexistence — every module's `_*` dir lives in the same
 *      workspace without colliding.
 *   3. Decoupling preservation — modules talk through their declared
 *      interfaces, not by reaching into each other's internals.
 *
 * Per-module smokes prove each module works in isolation. This smoke proves
 * they compose. Run alongside per-module smokes in CI; this is the broader
 * regression net.
 *
 * Cost: $0. No external API calls. Deterministic.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// Phase 6-A — Artifacts
import { writeArtifact, listArtifacts } from "../artifacts/store.js";

// Phase 7-A — Memory layer
import { getMemoryService } from "../memory-layer/service.js";

// Phase 9-A — Verify integration
import { createMockClient } from "../verify-integration/client.js";
import { buildBundle } from "../verify-integration/bundle-builder.js";

// Phase 10-A — Courier
import { getCourier } from "../courier/service.js";

// Phase 11-A — Cost tracker
import { getRollup } from "../cost-tracker/service.js";

// Phase 12-A — Admin substrate
import { FEATURE_FLAGS, CONFIG_ENTRIES } from "../admin-substrate/registry.js";

// Phase 13-A — Replay
import { collectRun } from "../replay/run-collector.js";

// Phase 14-A — Concurrency
import { createQueue } from "../concurrency/queue.js";
import { createHandlerRegistry } from "../concurrency/handler-registry.js";

// Phase 15-A — Self-improvement
import { createProposalStore } from "../self-improvement/store.js";
import { createHeuristicProposer, runProposerIntoStore } from "../self-improvement/proposer.js";

// Phase 16-A — Training generation
import { createTrainingStore } from "../training-gen/store.js";
import { createGeneratorRegistry } from "../training-gen/generators.js";
import { runPipeline as runTrainingPipeline } from "../training-gen/pipeline.js";
import { renderVoiceoverForPhase17 } from "../training-gen/renderer.js";

// Phase 17-A — Training videos
import { createVideoStore } from "../training-videos/store.js";
import { createProviderRegistry } from "../training-videos/providers/registry.js";
import { renderFromScript } from "../training-videos/pipeline.js";

// Phase 18-A — Marketplace
import { createMarketplaceStore } from "../marketplace/store.js";
import { installAllBuiltins, listInstalled, queryCapabilities } from "../marketplace/pipeline.js";

// Phase 19-A — Customer portal
import { createCustomerPortal } from "../customer-portal/portal.js";

// Phase 20-A — Public Release
import { createReleaseOrchestrator } from "../release/release.js";
import { staticProbe } from "../release/readiness.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

async function setupTmpRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "agentryx-integration-"));
}

// ---------------------------------------------------------------------------
async function main() {
  const root = await setupTmpRoot();
  console.log(`workspace: ${root}\n`);

  try {
    // -----------------------------------------------------------------------
    console.log("[1/16] register customer (Phase 19-A)");
    const portal = createCustomerPortal({ rootDir: root });
    const { account, token } = await portal.registerCustomer({
      email: "alice@example.com", display_name: "Alice", tier: "starter",
    });
    assert(account.id === "CUST-0001", "first customer is CUST-0001");
    assert(account.tier === "starter", "tier=starter");
    const TENANT = account.id;

    // -----------------------------------------------------------------------
    console.log("\n[2/16] customer submits project (Phase 19-A)");
    const receipt = await portal.submitProject(token, {
      project_title: "Todo App",
      intake_payload: "I want a todo list app with offline sync and collaboration features.",
      tags: ["react", "sync", "demo"],
    });
    const SUB = receipt.submission_id;
    assert(receipt.tier === "starter", "receipt records tier");
    assert(receipt.budget_cap_usd === 100, "starter budget_cap=$100");

    // -----------------------------------------------------------------------
    console.log("\n[3/16] enqueue intake job (Phase 14-A)");
    const queue = createQueue(root);
    const handlers = createHandlerRegistry();
    let intakeFired = false;
    handlers.register("project_intake", async (job) => {
      intakeFired = true;
      return { ok: true, customer_id: job.payload.customer_id, submission_id: job.payload.submission_id };
    });
    const job = await queue.enqueue({
      project_id: SUB,
      kind: "project_intake",
      payload: { customer_id: TENANT, submission_id: SUB },
      priority: 50,
    });
    assert(job.id === "JOB-0001", "first job queued");
    const stats = await queue.stats();
    assert(stats.queue === 1, "1 in queue");

    // Lease + complete the job (simulating what the worker pool does)
    const leased = await queue.lease(job.id, "test-worker");
    assert(leased.id === job.id, "job leased");
    const handler = handlers.get("project_intake");
    const result = await handler(leased, { workingDir: root, worker_id: "test-worker" });
    assert(result.ok && intakeFired, "handler invoked + flagged");
    await queue.complete(job.id, { result });
    const statsDone = await queue.stats();
    assert(statsDone.done === 1 && statsDone.queue === 0, "queue drained to done");

    // -----------------------------------------------------------------------
    console.log("\n[4/16] platform transitions submission (Phase 19-A)");
    await portal.transitionSubmission(TENANT, SUB, "accepted");
    await portal.recordTimelineEvent(TENANT, SUB, { kind: "accepted", note: "queued" });
    await portal.transitionSubmission(TENANT, SUB, "in_progress");
    await portal.recordTimelineEvent(TENANT, SUB, { kind: "phase_started", phase: "pre_dev" });
    const status1 = await portal.getStatus(token, SUB);
    assert(status1.submission.status === "in_progress", "in_progress");
    assert(status1.timeline.length === 3, "3 events in timeline");

    // -----------------------------------------------------------------------
    console.log("\n[5/16] write artifacts during pre_dev (Phase 6-A)");
    // Layout artifacts under <root>/<project_id>/ to match memory-layer's walker convention
    const projectDir = path.join(root, SUB);
    await fs.mkdir(projectDir, { recursive: true });
    const a1 = await writeArtifact(projectDir, {
      kind: "raw_extraction",
      content: { features: ["lists", "sync", "share"], stack: "react+postgres" },
      produced_by: { agent: "genovi", model: "haiku-4-5", run_id: SUB, iteration: 1 },
      cost_usd: 0.02,
      latency_ms: 800,
    });
    const a2 = await writeArtifact(projectDir, {
      kind: "pmd_doc",
      content: "# A1 Solution Brief\n\nA todo app with offline sync.",
      produced_by: { agent: "picard", model: "sonnet-4-6", run_id: SUB, iteration: 1 },
      parent_ids: [a1.id],
      cost_usd: 0.18,
      latency_ms: 2200,
    });
    assert(a1.id === "ART-0001" && a2.id === "ART-0002", "artifacts ART-0001 + ART-0002");
    assert(a2.parent_ids.includes(a1.id), "artifact lineage preserved");

    const allArtifacts = await listArtifacts(projectDir);
    assert(allArtifacts.length === 2, "listArtifacts returns 2");

    // -----------------------------------------------------------------------
    console.log("\n[6/16] cost-tracker rolls up per-project (Phase 11-A)");
    // The artifact source rolls up by walking <workspaceRoot>/<project>/_artifacts/
    const rollup = await getRollup(
      { project_ids: [SUB] },
      { workspaceRoot: root, source: "artifacts" },
    );
    const rollupCost = rollup.totals?.cost_usd ?? 0;
    assert(rollupCost > 0, "cost rollup > 0");
    assert(Math.abs(rollupCost - 0.20) < 0.01,
      `rollup matches sum of artifact costs (~$0.20, got ${rollupCost})`);

    // -----------------------------------------------------------------------
    console.log("\n[7/16] memory observations recorded during dev (Phase 7-A)");
    process.env.FACTORY_MEMORY_ROOT = path.join(root, "_factory-memory");
    const memory = getMemoryService({ rootDir: process.env.FACTORY_MEMORY_ROOT });
    await memory.addObservation({
      kind: "lesson", scope: "agent:troi",
      content: "missed CORS in auth setup for offline-sync flow",
      tags: ["auth", "react", "sync"],
    });
    await memory.addObservation({
      kind: "lesson", scope: "agent:troi",
      content: "session refresh missed in offline-recovery path",
      tags: ["auth", "react"],
    });
    await memory.addObservation({
      kind: "pattern", scope: "agent:spock",
      content: "opus tier overkill for boilerplate React components; haiku produces equivalent",
      tags: ["cost_high"],
    });
    await memory.addObservation({
      kind: "pattern", scope: "agent:spock",
      content: "opus 5x cost vs haiku for tailwind class generation",
      tags: ["cost_high"],
    });
    const recalled = await memory.recall({});
    assert(recalled.length === 4, `4 observations recorded (got ${recalled.length})`);

    // -----------------------------------------------------------------------
    console.log("\n[8/16] verify integration accepts the bundle (Phase 9-A)");
    const verify = createMockClient();
    const bundle = await buildBundle(projectDir, {
      build_id: `${SUB}-build-1`,
      version: "1.0.0",
    });
    assert(bundle.build_id === `${SUB}-build-1`, "bundle build_id stamped");
    assert(bundle.review_items.length >= 1, "bundle has review_items from artifacts");

    const published = await verify.publishBuild(bundle);
    assert(published.ok === true, "verify publish ok");
    assert(published.portal_url.includes("mock://"), "mock portal url returned");

    // -----------------------------------------------------------------------
    console.log("\n[9/16] courier dispatches delivery_ready event (Phase 10-A)");
    const courier = await getCourier({ backend: "fake" });
    const dispatched = await courier.dispatch({
      type: "project.delivery_ready",
      title: "Todo App build ready for review",
      project_id: SUB,
      severity: "info",
    });
    assert(dispatched.ok === true, "courier dispatch ok");
    assert(dispatched.channels_used.length > 0, "at least one channel routed");

    // -----------------------------------------------------------------------
    console.log("\n[10/16] training-gen produces all 6 kinds (Phase 16-A)");
    const trainingStore = createTrainingStore(root);
    const generators = createGeneratorRegistry();
    const trainingResult = await runTrainingPipeline({
      ctx: {
        project_id: SUB,
        project_title: "Todo App",
        project_summary: "A todo list app with offline sync.",
        features: [
          { id: "FEAT-lists", title: "Lists", description: "Create + manage lists.", entry_points: ["/lists"] },
          { id: "FEAT-sync",  title: "Sync",  description: "Offline-first sync.",   entry_points: ["/sync"] },
        ],
        runtime: { base_url: "https://todo.example.com" },
      },
      store: trainingStore,
      registry: generators,
    });
    assert(trainingResult.errors.length === 0, "training-gen no errors");
    assert(trainingResult.produced.length === 6, "all 6 training kinds produced");

    const latestVoiceover = await trainingStore.readLatest(SUB, "voiceover_script");
    const latestStoryboard = await trainingStore.readLatest(SUB, "video_storyboard");
    assert(latestVoiceover.record.kind === "voiceover_script", "voiceover stored");
    assert(latestStoryboard.record.parent_ids.includes(latestVoiceover.record.id),
      "storyboard parents voiceover (16-A → 17-A handoff stable)");

    // -----------------------------------------------------------------------
    console.log("\n[11/16] training-videos renders the voiceover (Phase 17-A)");
    const videoStore = createVideoStore(root);
    const providers = createProviderRegistry();
    const video = await renderFromScript({
      scriptRecord: latestVoiceover.record,
      scriptContent: latestVoiceover.content,
      storyboardRecord: latestStoryboard.record,
      renderVoiceoverForPhase17,                // injected from training-gen
      providerChoice: {
        tts: "tts:stub:elevenlabs:rachel",
        capture: "capture:stub:puppeteer:1280x720",
        stitcher: "stitcher:stub:ffmpeg:1280x720",
      },
      store: videoStore,
      registry: providers,
    });
    assert(video.status === "done", "video render done");
    assert(video.script_id === latestVoiceover.record.id, "video references voiceover TART id");
    assert(video.storyboard_id === latestStoryboard.record.id, "video references storyboard TART id");
    assert(video.duration_ms > 0, "video has duration");
    assert(video.cost_usd > 0, "stub providers report non-zero simulated cost");

    // -----------------------------------------------------------------------
    console.log("\n[12/16] self-improvement extracts proposals from observations (Phase 15-A)");
    const proposals = createProposalStore(root);
    const proposer = createHeuristicProposer({ minSupport: 2 });
    const drafts = await runProposerIntoStore({
      proposer, store: proposals,
      ctx: { memory, registry: { CONFIG_ENTRIES: [] } },
    });
    assert(drafts.length >= 2, `≥2 proposals from observations (got ${drafts.length})`);
    const promptDraft = drafts.find(p => p.kind === "prompt_change");
    const modelDraft  = drafts.find(p => p.kind === "model_change");
    assert(promptDraft && promptDraft.change.target.startsWith("agent:troi"),
      "prompt_change targets agent:troi (matches lesson scope)");
    assert(modelDraft && modelDraft.change.target.startsWith("task:spock"),
      "model_change targets task:spock (matches pattern scope)");

    // -----------------------------------------------------------------------
    console.log("\n[13/16] marketplace catalogue installs cleanly (Phase 18-A)");
    const market = createMarketplaceStore(root);
    const installResult = await installAllBuiltins({ store: market });
    assert(installResult.failed.length === 0, "all 15 built-in modules install cleanly");
    assert(installResult.installed.length === 15, "15 installed");

    const generatorMods = listInstalled(market, { category: "generator" });
    assert(generatorMods.length === 1 && generatorMods[0].manifest.id === "training-gen.template-generators",
      "training-gen catalogue entry resolvable");

    const voiceoverProviders = queryCapabilities(market, "voiceover_script");
    assert(voiceoverProviders.length === 1, "voiceover_script capability resolves");

    // -----------------------------------------------------------------------
    console.log("\n[14/16] release: metering captures spend, rollup matches artifact costs (Phase 20-A)");
    const orch = createReleaseOrchestrator();
    await orch.recordUsage(root, {
      tenant_id: TENANT,
      request_count: 2,
      cost_usd: rollupCost,
      duration_ms: 3000,
      tokens: 1200,
    });
    await orch.recordUsage(root, {
      tenant_id: TENANT,
      request_count: 1,
      cost_usd: video.cost_usd,
      duration_ms: video.duration_ms,
    });
    const dailyRollups = await orch.runDailyMetering(root, { tenant_id: TENANT });
    assert(dailyRollups.length === 1, "1 daily rollup for tenant");
    assert(dailyRollups[0].request_count === 3, "request_count rolls up = 3");
    assert(Math.abs(dailyRollups[0].cost_usd - (rollupCost + video.cost_usd)) < 1e-6,
      "rollup cost matches artifact + video sum");

    // -----------------------------------------------------------------------
    console.log("\n[15/16] release: compliance audit + backup snapshot + readiness (Phase 20-A)");
    // Mark submission delivered
    await portal.transitionSubmission(TENANT, SUB, "delivered");
    await portal.recordTimelineEvent(TENANT, SUB, { kind: "delivered" });

    const compliance = await orch.handleComplianceRequest(root, {
      kind: "audit",
      tenant_id: TENANT,
      requested_by: "ops@agentryx.io",
    });
    assert(compliance.outcome === "succeeded", "compliance audit succeeded");
    assert(compliance.summary.total_files >= 1, "at least 1 tenant file found");

    // Register module probes + assemble health
    orch.registerProbe("queue", staticProbe("healthy", "drained"));
    orch.registerProbe("memory", staticProbe("healthy"));
    orch.registerProbe("portal", staticProbe("healthy"));
    orch.registerProbe("training", staticProbe("healthy"));
    orch.registerProbe("video", staticProbe("healthy"));
    const health = await orch.assembleHealthReport();
    assert(health.overall === "healthy", "all probes healthy → overall healthy");
    assert(health.probes.length === 5, "5 probes registered");

    // Backup snapshot + verify
    const backupManifest = await orch.snapshotBackup(root);
    assert(backupManifest.id === "BKP-0001", "first backup snapshot");
    assert(backupManifest.entry_count > 10,
      `backup includes ≥10 entries (got ${backupManifest.entry_count}) — covers all _* dirs`);
    const includes = backupManifest.included_dirs;
    assert(includes.includes("_customer-portal"), "backup includes customer-portal");
    assert(includes.includes("_videos"), "backup includes videos");
    assert(includes.includes("_proposals"), "backup includes proposals");
    assert(includes.includes("_training"), "backup includes training");
    assert(includes.includes("_marketplace"), "backup includes marketplace");
    assert(includes.includes("_factory-memory"), "backup includes memory layer");
    assert(includes.includes("_release"), "backup includes release dir");
    assert(!includes.some(d => d === "_release/backups"),
      "backup excludes its own backups subdir");

    const verifyResult = await orch.verifyBackup(root, backupManifest);
    assert(verifyResult.ok === true, "backup verifies clean (no drift)");

    // -----------------------------------------------------------------------
    console.log("\n[16/16] replay: collect run snapshot from artifacts (Phase 13-A)");
    const snapshot = await collectRun(root, SUB);
    assert(snapshot && snapshot.run_id === SUB, "snapshot run_id matches");
    assert(snapshot.artifacts.length === 2, "snapshot enumerates both artifacts");
    assert(snapshot.agents.includes("genovi") && snapshot.agents.includes("picard"),
      "snapshot tracks agents");

    // Admin substrate inspection (Phase 12-A)
    assert(FEATURE_FLAGS.length === 14, "14 feature flags catalogued");
    assert(FEATURE_FLAGS.every(f => f.default_when_unset === "off"),
      "all 14 flags default OFF (production behavior unchanged)");
    assert(CONFIG_ENTRIES.length >= 7, "≥7 admin config entries catalogued");

    // -----------------------------------------------------------------------
    console.log("\n[final] cross-module data-flow assertions");

    // 19-A submission timeline now spans the full lifecycle
    const finalStatus = await portal.getStatus(token, SUB);
    assert(finalStatus.submission.status === "delivered", "submission delivered");
    const eventKinds = new Set(finalStatus.timeline.map(e => e.kind));
    assert(eventKinds.has("submitted") && eventKinds.has("phase_started") && eventKinds.has("delivered"),
      "timeline spans full lifecycle");

    // 20-A metering tenant_id matches 19-A account customer_id
    const meterTenants = await orch.meter(root).listTenants();
    assert(meterTenants.includes(TENANT), "metering tenant_id matches portal customer_id");

    // 17-A video.script_id references 16-A voiceover TART id
    const videoManifest = await videoStore.readManifest(SUB, video.id);
    assert(videoManifest.script_id === latestVoiceover.record.id,
      "video → voiceover lineage preserved (16-A/17-A boundary)");

    // 6-A artifact lineage preserved through 13-A snapshot view
    const a2InSnapshot = snapshot.artifacts.find(a => a.id === a2.id);
    assert(a2InSnapshot.parent_ids.includes(a1.id),
      "artifact lineage preserved via 13-A snapshot view");

    // 18-A marketplace catalogues every Phase-17-A provider pack
    const providerMods = market.list({ category: "provider" });
    assert(providerMods.length === 3,
      "marketplace lists 3 provider modules (Phase 17-A tts/capture/stitcher packs)");

    // 20-A compliance can find tenant data across multiple stores
    const exportReport = await orch.handleComplianceRequest(root, {
      kind: "export", tenant_id: TENANT, requested_by: "alice@example.com",
    });
    assert(exportReport.outcome === "succeeded", "export request succeeds");
    assert(exportReport.summary.entry_count >= 1, "export found tenant files");

    // 9-A bundle was built from 6-A artifacts
    assert(bundle.review_items.some(ri => ri.artifact_id === a2.id),
      "verify bundle includes review item for pmd_doc artifact (9-A ← 6-A boundary)");

    // 14-A queue handler key matches 19-A submission shape
    const droveByQueue = await queue.listInFlight();
    assert(droveByQueue.length === 0, "no jobs left in flight (queue fully drained)");

    // -----------------------------------------------------------------------
    console.log("\n[smoke] OK — all 16 A-tier modules compose end-to-end");
  } catch (err) {
    console.error(`\n[smoke] FAILED: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main();
