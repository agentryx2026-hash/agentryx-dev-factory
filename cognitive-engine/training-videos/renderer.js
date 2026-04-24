import path from "node:path";
import { nowIso } from "./types.js";

/**
 * Renderer — orchestrates TTS × beats + capture × beats + stitch for one
 * Phase-17-payload (the output of Phase 16-A's renderVoiceoverForPhase17).
 *
 * Failure-tolerant at beat level (D156): one bad beat doesn't kill the render.
 * Failed beats are logged and excluded from the stitch stage. If ≥1 beat
 * succeeds, the render completes in "degraded" status; if zero succeed, it
 * fails hard.
 *
 * Progress events fire via `onProgress` if supplied:
 *   { type: "start" }
 *   { type: "beat", beat_id, stage, progress }           progress = 0..1
 *   { type: "stitch" }
 *   { type: "end", status }
 *
 * Returns `{ status, beats, duration_ms, cost_usd, mp4_ref, thumbnail_ref, captions_ref, error? }`.
 */

function cueForBeat(phase17, beatId) {
  return (phase17.capture_plan || []).find(c => c.beat_id === beatId) || null;
}

function transitionForBeat(phase17, beatId) {
  const t = (phase17.transitions || []).find(t => t.beat_id === beatId);
  return t?.transition;
}

export async function renderVideo({
  phase17,
  providers,
  renderDir,
  subdirs,
  appendLog = async () => {},
  onProgress = () => {},
}) {
  if (!phase17) throw new Error("renderVideo: phase17 payload required");
  if (!providers?.tts?.synth) throw new Error("renderVideo: providers.tts required");
  if (!providers?.capture?.capture) throw new Error("renderVideo: providers.capture required");
  if (!providers?.stitcher?.assemble) throw new Error("renderVideo: providers.stitcher required");
  if (!renderDir) throw new Error("renderVideo: renderDir required");
  if (!subdirs?.audio || !subdirs?.capture) throw new Error("renderVideo: subdirs.{audio,capture} required");

  const narrations = phase17.narration || [];
  if (narrations.length === 0) {
    return {
      status: "failed",
      error: "empty narration",
      beats: [],
      duration_ms: 0,
      cost_usd: 0,
    };
  }

  const t0 = Date.now();
  onProgress({ type: "start", detail: { beat_count: narrations.length } });

  const beatResults = [];
  let aggCost = 0;

  for (let i = 0; i < narrations.length; i++) {
    const narration = narrations[i];
    const beatId = narration.id;
    const fraction = narrations.length ? (i + 1) / narrations.length : 1;

    const beat = {
      id: beatId,
      ok: true,
      duration_ms: 0,
      audio_ref: null,
      capture_ref: null,
    };

    // Stage 1: TTS
    try {
      const ttsStart = Date.now();
      const ttsResult = await providers.tts.synth(
        { id: beatId, narrator_text: narration.text, target_duration_ms: narration.target_duration_ms },
        { out_dir: subdirs.audio, beat_id: beatId }
      );
      beat.audio_ref = path.posix.join("audio", ttsResult.audio_ref);
      beat.duration_ms = ttsResult.actual_duration_ms || narration.target_duration_ms || 0;
      aggCost += ttsResult.cost_usd || 0;
      await appendLog({
        beat_id: beatId, stage: "tts", ok: true,
        duration_ms: Date.now() - ttsStart,
        cost_usd: ttsResult.cost_usd || 0,
        details: { actual_duration_ms: beat.duration_ms, provider: providers.tts.id },
      });
      onProgress({ type: "beat", beat_id: beatId, stage: "tts", progress: fraction });
    } catch (err) {
      beat.ok = false;
      beat.error = `tts: ${err?.message || String(err)}`;
      await appendLog({
        beat_id: beatId, stage: "tts", ok: false, error: err?.message || String(err),
      });
      beatResults.push(beat);
      continue;
    }

    // Stage 2: Capture (only if beat has a screen_capture cue)
    const cue = cueForBeat(phase17, beatId);
    if (cue) {
      try {
        const capStart = Date.now();
        const capResult = await providers.capture.capture(cue, {
          out_dir: subdirs.capture,
          beat_id: beatId,
        });
        beat.capture_ref = path.posix.join("capture", capResult.image_ref);
        aggCost += capResult.cost_usd || 0;
        await appendLog({
          beat_id: beatId, stage: "capture", ok: true,
          duration_ms: Date.now() - capStart,
          cost_usd: capResult.cost_usd || 0,
          details: {
            provider: providers.capture.id,
            width: capResult.width, height: capResult.height,
            url: cue.url,
          },
        });
        onProgress({ type: "beat", beat_id: beatId, stage: "capture", progress: fraction });
      } catch (err) {
        beat.ok = false;
        beat.error = `capture: ${err?.message || String(err)}`;
        await appendLog({
          beat_id: beatId, stage: "capture", ok: false, error: err?.message || String(err),
        });
      }
    }

    beatResults.push(beat);
  }

  const successful = beatResults.filter(b => b.ok);
  if (successful.length === 0) {
    await appendLog({ stage: "stitch", ok: false, error: "no successful beats" });
    onProgress({ type: "end", detail: { status: "failed" } });
    return {
      status: "failed",
      error: "no successful beats",
      beats: beatResults,
      duration_ms: 0,
      cost_usd: aggCost,
    };
  }

  // Stage 3: Stitch
  onProgress({ type: "stitch" });
  const stitchStart = Date.now();
  let stitchOut;
  try {
    stitchOut = await providers.stitcher.assemble({
      beats: successful.map(b => ({ id: b.id, audio_ref: b.audio_ref, capture_ref: b.capture_ref, duration_ms: b.duration_ms })),
      transitions: (phase17.transitions || []).filter(t => successful.find(b => b.id === t.beat_id)),
      captions_srt: phase17.captions_srt,
      output_dir: renderDir,
    });
  } catch (err) {
    await appendLog({
      stage: "stitch", ok: false, error: err?.message || String(err),
    });
    onProgress({ type: "end", detail: { status: "failed" } });
    return {
      status: "failed",
      error: `stitch: ${err?.message || String(err)}`,
      beats: beatResults,
      duration_ms: 0,
      cost_usd: aggCost,
    };
  }

  aggCost += stitchOut.cost_usd || 0;
  await appendLog({
    stage: "stitch", ok: true,
    duration_ms: Date.now() - stitchStart,
    cost_usd: stitchOut.cost_usd || 0,
    details: {
      provider: providers.stitcher.id,
      total_duration_ms: stitchOut.duration_ms,
      successful_beats: successful.length,
    },
  });

  const degraded = successful.length < narrations.length;
  const status = degraded ? "degraded" : "done";
  onProgress({ type: "end", detail: { status, wall_ms: Date.now() - t0 } });

  return {
    status,
    beats: beatResults,
    duration_ms: stitchOut.duration_ms,
    cost_usd: Math.round(aggCost * 1_000_000) / 1_000_000,
    mp4_ref: stitchOut.mp4_ref,
    thumbnail_ref: stitchOut.thumbnail_ref,
    captions_ref: phase17.captions_srt ? "captions.srt" : undefined,
    degraded,
  };
}
