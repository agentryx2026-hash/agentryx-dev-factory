/**
 * Stitcher — Stitcher contract (D154, D155).
 *
 * Assembles per-beat audio + capture + transitions + captions into a single
 * video manifest.
 *
 * 17-A ships null (marker file) + stub-ffmpeg (writes a JSON manifest that
 * a real ffmpeg caller can translate into -filter_complex args). 17-B wires
 * a real ffmpeg invocation (child_process or fluent-ffmpeg) behind the same
 * interface.
 */

import fs from "node:fs/promises";
import path from "node:path";

async function writeAssetFile(outDir, filename, body) {
  await fs.mkdir(outDir, { recursive: true });
  const fullPath = path.join(outDir, filename);
  await fs.writeFile(fullPath, body, "utf-8");
  return path.basename(fullPath);
}

function totalDuration(beats) {
  return (beats || []).reduce((a, b) => a + (b.duration_ms || 0), 0);
}

/**
 * Null stitcher — writes a marker mp4 placeholder.
 */
export function createNullStitcher() {
  return {
    id: "stitcher:null",
    async assemble({ beats, captions_srt, output_dir } = {}) {
      const mp4Ref = await writeAssetFile(output_dir, "video.null.mp4", "null-video\n");
      const thumbRef = await writeAssetFile(output_dir, "thumbnail.null.png", "null-thumb\n");
      if (captions_srt) await writeAssetFile(output_dir, "captions.srt", captions_srt);
      return {
        mp4_ref: mp4Ref,
        thumbnail_ref: thumbRef,
        duration_ms: totalDuration(beats),
        cost_usd: 0,
      };
    },
  };
}

/**
 * Stub ffmpeg stitcher — no real encoding. Writes a JSON manifest shaped like
 * an ffmpeg command plan. 17-B swaps this for `child_process.spawn("ffmpeg",
 * …)` that reads the same manifest and executes.
 *
 * Opts:
 *   resolution       default "1280x720"
 *   format           default "mp4"
 *   price_per_sec_usd default 0 (local encoding is free)
 */
export function createStubFfmpegStitcher(init = {}) {
  const resolution = init.resolution || "1280x720";
  const format = init.format || "mp4";
  const pricePerSec = init.price_per_sec_usd ?? 0;

  return {
    id: `stitcher:stub:ffmpeg:${resolution}`,
    async assemble({ beats = [], transitions = [], captions_srt, output_dir } = {}) {
      const duration_ms = totalDuration(beats);
      const plan = {
        kind: "ffmpeg-plan",
        resolution,
        format,
        inputs: beats.map(b => ({
          beat_id: b.id,
          audio: b.audio_ref || null,
          capture: b.capture_ref || null,
          duration_ms: b.duration_ms || 0,
        })),
        transitions: transitions.slice(),
        total_duration_ms: duration_ms,
      };
      const mp4Ref = await writeAssetFile(output_dir, `video.stub.${format}.json`, JSON.stringify(plan, null, 2) + "\n");
      const thumbRef = await writeAssetFile(output_dir, "thumbnail.stub.png.json", JSON.stringify({
        kind: "stub-thumb",
        source_beat: beats[0]?.id || null,
        resolution,
      }, null, 2) + "\n");
      if (captions_srt) await writeAssetFile(output_dir, "captions.srt", captions_srt);
      const cost = Math.round((duration_ms / 1000) * pricePerSec * 1_000_000) / 1_000_000;
      return {
        mp4_ref: mp4Ref,
        thumbnail_ref: thumbRef,
        duration_ms,
        cost_usd: cost,
      };
    },
  };
}

export const DEFAULT_STITCHERS = Object.freeze({
  "stitcher:null":                    createNullStitcher,
  "stitcher:stub:ffmpeg:1280x720":    createStubFfmpegStitcher,
});
