/**
 * Phase 17-B Tier B — `training_video_render` queue handler.
 *
 * Wraps Phase 17-A's `renderFromPhase17Payload({project_id, script_id,
 * phase17, providerChoice, store, registry, ...})` so video-render jobs
 * flow through the Phase 14-A queue. Same registration pattern as
 * D211 (factory handlers), D217 (architect_research), D219 (training_gen).
 *
 * Today the provider registry uses Phase 17-A's NULL + STUB backends:
 *   - TTS:      null / stub-elevenlabs / stub-openai (no API calls; $0)
 *   - capture:  null / stub-puppeteer / stub-playwright (synthetic PNGs)
 *   - stitcher: null / stub-ffmpeg (synthetic mp4 manifest)
 *
 * Full 17-B swaps real ElevenLabs / Puppeteer / Playwright / ffmpeg
 * behind the same interface — the handler doesn't change. Same DI seam.
 *
 * Payload shape:
 *   {
 *     project_id:    string,                 // required
 *     script_id:     string,                 // required (training-gen voiceover artifact id)
 *     phase17:       Phase17Payload,         // required (output of renderVoiceoverForPhase17)
 *     providerChoice?: { tts, capture, stitcher },  // defaults to all-null backends
 *     storyboard_id?: string,
 *     store_root?:   string,                 // defaults to deps.defaultStoreRoot
 *     meta?:         object,
 *   }
 *
 * Returns the committed VideoArtifact id + status + duration + cost.
 *
 * Why default providerChoice to all-nulls:
 *   - Substrate ship must work at $0 with no credentials. NULL backends
 *     produce a valid manifest + zero-byte audio/video so downstream
 *     consumers (Phase 19-B customer portal preview, Phase 7-E memory
 *     synthesis) see the full record shape without us spending money.
 *   - Real backends become opt-in per-job via payload.providerChoice
 *     (e.g. "stub-elevenlabs" → flip to "elevenlabs" when keys land).
 */

import path from "node:path";

const TRAINING_VIDEO_RENDER_KIND = "training_video_render";

const DEFAULT_PROVIDER_CHOICE = Object.freeze({
  tts: "null",
  capture: "null",
  stitcher: "null",
});

/**
 * Register the training_video_render handler on a Phase 14-A registry.
 *
 * @param {object} registry
 * @param {object} deps
 * @param {Function} deps.createVideoStore             Phase 17-A `createVideoStore(rootDir)`
 * @param {Function} deps.createProviderRegistry       Phase 17-A `createProviderRegistry({defaults?})`
 * @param {Function} deps.renderFromPhase17Payload     Phase 17-A pipeline entry point
 * @param {string} [deps.defaultStoreRoot]             default video-store root if payload doesn't override
 * @param {(line: string, jobId: string) => void} [deps.onLog]
 */
export function registerTrainingVideoRenderHandler(registry, deps = {}) {
  if (!registry?.register) throw new Error("registerTrainingVideoRenderHandler: registry required");
  if (typeof deps.createVideoStore !== "function") throw new Error("registerTrainingVideoRenderHandler: deps.createVideoStore required");
  if (typeof deps.createProviderRegistry !== "function") throw new Error("registerTrainingVideoRenderHandler: deps.createProviderRegistry required");
  if (typeof deps.renderFromPhase17Payload !== "function") throw new Error("registerTrainingVideoRenderHandler: deps.renderFromPhase17Payload required");

  registry.register(TRAINING_VIDEO_RENDER_KIND, async (job, ctx /* { workingDir, worker_id } */) => {
    const payload = job.payload || {};
    if (!payload.project_id) throw new Error(`${TRAINING_VIDEO_RENDER_KIND} job ${job.id}: payload.project_id required`);
    if (!payload.script_id)  throw new Error(`${TRAINING_VIDEO_RENDER_KIND} job ${job.id}: payload.script_id required`);
    if (!payload.phase17)    throw new Error(`${TRAINING_VIDEO_RENDER_KIND} job ${job.id}: payload.phase17 required`);

    const storeRoot = payload.store_root
      || deps.defaultStoreRoot
      || (ctx?.workingDir ? path.join(ctx.workingDir, "_videos-store") : null);
    if (!storeRoot) throw new Error(`${TRAINING_VIDEO_RENDER_KIND} job ${job.id}: store_root not resolvable`);

    const providerChoice = { ...DEFAULT_PROVIDER_CHOICE, ...(payload.providerChoice || {}) };
    const store = deps.createVideoStore(storeRoot);
    const providerRegistry = deps.createProviderRegistry({ defaults: true });

    if (deps.onLog) {
      try {
        deps.onLog(
          `video_render start: ${payload.project_id} / script=${payload.script_id} providers=${providerChoice.tts}/${providerChoice.capture}/${providerChoice.stitcher}`,
          job.id
        );
      } catch {}
    }

    const onProgress = deps.onLog
      ? (evt) => {
          try {
            // Phase 17-A emits stage events (beat_started / beat_done / tts_done / etc).
            // Forward a one-liner per event into Live Trace.
            const tag = evt.stage || evt.event || "progress";
            const detail = evt.beat_id ? ` beat=${evt.beat_id}` : "";
            deps.onLog(`  ${tag}${detail}${evt.ok === false ? " ⚠️ " + (evt.error || "") : ""}`, job.id);
          } catch {}
        }
      : undefined;

    const artifact = await deps.renderFromPhase17Payload({
      project_id: payload.project_id,
      script_id: payload.script_id,
      storyboard_id: payload.storyboard_id,
      phase17: payload.phase17,
      providerChoice,
      store,
      registry: providerRegistry,
      meta: payload.meta,
      onProgress,
    });

    if (deps.onLog) {
      try {
        deps.onLog(
          `video_render done: ${artifact.id} status=${artifact.status} duration=${artifact.duration_ms || 0}ms cost=$${(artifact.cost_usd || 0).toFixed(4)}`,
          job.id
        );
      } catch {}
    }

    return {
      video_id: artifact.id,
      status: artifact.status,
      duration_ms: artifact.duration_ms || 0,
      cost_usd: artifact.cost_usd || 0,
      mp4_ref: artifact.mp4_ref || null,
      thumbnail_ref: artifact.thumbnail_ref || null,
      captions_ref: artifact.captions_ref || null,
      degraded: artifact.degraded || false,
      error: artifact.error || null,
      providers: providerChoice,
    };
  });

  return registry;
}

export { TRAINING_VIDEO_RENDER_KIND, DEFAULT_PROVIDER_CHOICE };
