import { renderVideo } from "./renderer.js";
import { nowIso } from "./types.js";

/**
 * Training-videos pipeline.
 *
 * `renderFromPhase17Payload` takes a Phase 16-A Phase-17 payload directly.
 * `renderFromScript` takes a training-store record + content, calls
 * `renderVoiceoverForPhase17` via an injected function, and delegates.
 *
 * Both return a full VideoArtifact manifest and commit it to the store.
 */

/**
 * @param {Object} args
 * @param {string} args.project_id
 * @param {string} args.script_id
 * @param {Object} args.phase17                output of renderVoiceoverForPhase17
 * @param {{ tts, capture, stitcher }} args.providerChoice  provider ids
 * @param {Object} args.store                  createVideoStore instance
 * @param {Object} args.registry               createProviderRegistry instance
 * @param {string} [args.storyboard_id]
 * @param {Record<string, any>} [args.meta]
 * @param {(evt: object) => void} [args.onProgress]
 * @returns {Promise<import("./types.js").VideoArtifact>}
 */
export async function renderFromPhase17Payload({
  project_id, script_id, storyboard_id, phase17, providerChoice,
  store, registry, meta, onProgress,
}) {
  if (!project_id) throw new Error("pipeline: project_id required");
  if (!script_id) throw new Error("pipeline: script_id required");
  if (!phase17) throw new Error("pipeline: phase17 payload required");
  if (!providerChoice?.tts || !providerChoice?.capture || !providerChoice?.stitcher) {
    throw new Error("pipeline: providerChoice { tts, capture, stitcher } required");
  }
  if (!store?.reserve) throw new Error("pipeline: store required");
  if (!registry?.resolve) throw new Error("pipeline: registry required");

  const providers = registry.resolve(providerChoice);
  const reservation = await store.reserve(project_id);
  const { id, renderDir, subdirs } = reservation;

  const created_at = nowIso();
  await store.appendLog(renderDir, {
    stage: "pipeline", ok: true, details: {
      action: "start",
      video_id: id,
      providers: providerChoice,
      beat_count: phase17.narration?.length || 0,
      total_duration_ms: phase17.total_duration_ms || 0,
    },
  });

  let result;
  try {
    result = await renderVideo({
      phase17,
      providers,
      renderDir,
      subdirs,
      appendLog: (entry) => store.appendLog(renderDir, entry),
      onProgress: onProgress || (() => {}),
    });
  } catch (err) {
    const record = {
      id,
      project_id,
      script_id,
      storyboard_id,
      status: "failed",
      providers: providerChoice,
      beats: [],
      mp4_ref: null,
      duration_ms: 0,
      cost_usd: 0,
      error: err?.message || String(err),
      created_at,
      rendered_at: nowIso(),
      meta,
    };
    await store.appendLog(renderDir, { stage: "pipeline", ok: false, error: record.error });
    return store.commit(project_id, record);
  }

  const record = {
    id,
    project_id,
    script_id,
    storyboard_id,
    status: result.status,
    providers: providerChoice,
    beats: result.beats,
    mp4_ref: result.mp4_ref,
    thumbnail_ref: result.thumbnail_ref,
    captions_ref: result.captions_ref,
    duration_ms: result.duration_ms,
    cost_usd: result.cost_usd,
    degraded: result.degraded,
    error: result.error,
    created_at,
    rendered_at: nowIso(),
    meta,
  };
  await store.appendLog(renderDir, {
    stage: "pipeline", ok: result.status !== "failed", details: {
      action: "end",
      status: result.status,
      duration_ms: result.duration_ms,
      cost_usd: result.cost_usd,
    },
  });
  return store.commit(project_id, record);
}

/**
 * Convenience: pass a training-gen store record + content + the
 * Phase-16-A renderer function. The pipeline extracts the Phase-17 payload
 * and delegates.
 *
 * @param {Object} args
 * @param {Object} args.scriptRecord                  training-gen voiceover_script record (id used as script_id)
 * @param {Object} args.scriptContent                 training-gen voiceover_script content
 * @param {(record: object, content: object) => object} args.renderVoiceoverForPhase17
 * @param {Object} [args.storyboardRecord]            training-gen video_storyboard record
 * @param {{ tts, capture, stitcher }} args.providerChoice
 * @param {Object} args.store
 * @param {Object} args.registry
 * @param {(evt: object) => void} [args.onProgress]
 */
export async function renderFromScript({
  scriptRecord, scriptContent, renderVoiceoverForPhase17,
  storyboardRecord, providerChoice, store, registry, onProgress,
}) {
  if (!scriptRecord || !scriptContent) throw new Error("pipeline: scriptRecord + scriptContent required");
  if (typeof renderVoiceoverForPhase17 !== "function") {
    throw new Error("pipeline: renderVoiceoverForPhase17 fn required (inject from training-gen/renderer.js)");
  }
  const phase17 = renderVoiceoverForPhase17(scriptRecord, scriptContent);
  return renderFromPhase17Payload({
    project_id: scriptRecord.project_id,
    script_id: scriptRecord.id,
    storyboard_id: storyboardRecord?.id,
    phase17,
    providerChoice,
    store,
    registry,
    onProgress,
  });
}
