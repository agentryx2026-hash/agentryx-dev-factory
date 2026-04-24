/**
 * Training-videos types.
 *
 * Consumes Phase 16-A voiceover_script + video_storyboard (both are JSON
 * training artifacts with a beats[] array) and produces VideoArtifacts —
 * rendered training videos plus per-beat asset manifests.
 *
 * Three provider categories, each dependency-injected (D154):
 *   - TtsProvider      narration beat → audio file + duration
 *   - CaptureBackend   screen-capture cue → image file
 *   - Stitcher         audio + capture + captions → final mp4 manifest
 *
 * 17-A ships null + stub variants per category. 17-B swaps in real backends.
 */

/**
 * @typedef {"queued"|"rendering"|"done"|"failed"|"degraded"} RenderStatus
 *
 * - queued:    created, not yet started
 * - rendering: renderer loop running
 * - done:      all beats rendered successfully
 * - degraded:  rendered with some failed beats (D156)
 * - failed:    fatal error; no usable output
 */

/**
 * @typedef {"cut"|"fade"|"zoom"|"highlight"} Transition  matches Phase 16-A
 */

/**
 * @typedef {Object} ProviderChoice
 * @property {string} tts         provider id for TTS (e.g. "tts:stub:generic")
 * @property {string} capture     provider id for capture (e.g. "capture:stub:chromium-720p")
 * @property {string} stitcher    provider id for stitcher (e.g. "stitcher:stub:ffmpeg")
 */

/**
 * @typedef {Object} RenderJobInput
 * @property {string} project_id
 * @property {string} script_id              the Phase 16-A voiceover_script TART id
 * @property {Object} phase17_payload        output of renderVoiceoverForPhase17
 * @property {ProviderChoice} providers
 * @property {string} [storyboard_id]        optional video_storyboard TART id for b-roll hints
 * @property {Object} [storyboard_content]   video_storyboard content if available
 * @property {Record<string, any>} [meta]
 */

/**
 * @typedef {Object} BeatRenderLog
 * @property {string} beat_id
 * @property {"tts"|"capture"|"stitch"} stage
 * @property {boolean} ok
 * @property {number} [duration_ms]
 * @property {number} [cost_usd]
 * @property {string} [error]
 * @property {string} at                     ISO 8601 UTC
 * @property {Record<string, any>} [details]
 */

/**
 * @typedef {Object} VideoArtifact
 * @property {string} id                       e.g. "VID-0001"
 * @property {number} schema_version
 * @property {string} project_id
 * @property {string} script_id                Phase 16-A voiceover TART id
 * @property {string} [storyboard_id]          Phase 16-A storyboard TART id
 * @property {RenderStatus} status
 * @property {string} mp4_ref                  relative path inside the render dir
 * @property {string} [thumbnail_ref]
 * @property {string} [captions_ref]           SRT file
 * @property {ProviderChoice} providers
 * @property {{id:string, audio_ref?:string, capture_ref?:string, duration_ms?:number, ok:boolean, error?:string}[]} beats
 * @property {number} duration_ms
 * @property {number} cost_usd
 * @property {boolean} [degraded]              true when some beats failed (D156)
 * @property {string} [error]                  fatal-failure message
 * @property {string} created_at               ISO 8601 UTC
 * @property {string} [rendered_at]
 * @property {string[]} [tags]
 * @property {Record<string, any>} [meta]
 */

/**
 * @typedef {Object} RendererProgressEvent
 * @property {"start"|"beat"|"stitch"|"end"} type
 * @property {string} [beat_id]
 * @property {"tts"|"capture"|"stitch"} [stage]
 * @property {number} [progress]               0.0 → 1.0
 * @property {Record<string, any>} [detail]
 */

export const SCHEMA_VERSION = 1;

export const RENDER_STATUSES = Object.freeze([
  "queued", "rendering", "done", "failed", "degraded",
]);

export const PROVIDER_CATEGORIES = Object.freeze(["tts", "capture", "stitcher"]);

export function isValidStatus(s) { return RENDER_STATUSES.includes(s); }
export function isValidCategory(c) { return PROVIDER_CATEGORIES.includes(c); }
export function nowIso() { return new Date().toISOString(); }
