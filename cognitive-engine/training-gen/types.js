/**
 * Training-generation types.
 *
 * A TrainingArtifact is a typed, versioned training output produced by a
 * generator. 16-A ships 6 kinds; generators are dependency-injected per kind.
 *
 * The voiceover_script and video_storyboard kinds define the contract that
 * Phase 17 (Training Videos) consumes — structure stable even while prose
 * quality evolves through 16-B LLM integration.
 */

/**
 * @typedef {"user_guide"|"quick_start"|"how_to"|"reference_doc"|"voiceover_script"|"video_storyboard"} TrainingKind
 *
 * - user_guide:        long-form feature walkthrough (end user)
 * - quick_start:       5-minute task-focused onboarding (new user)
 * - how_to:            one specific task, explicit steps (task-focused user)
 * - reference_doc:     API / config reference (integrator)
 * - voiceover_script:  structured beats with narrator text + pacing + cues (Phase 17)
 * - video_storyboard:  ordered beats with screen-capture + camera plan (Phase 17)
 */

/**
 * @typedef {"cut"|"fade"|"zoom"|"highlight"} Transition
 */

/**
 * @typedef {Object} ScreenCaptureCue
 * @property {string} url              target URL for headless browser
 * @property {string} [selector]       CSS selector to interact with / focus
 * @property {string} [wait]           wait condition: "networkidle" | "selector:<css>" | "ms:<n>"
 * @property {"click"|"type"|"hover"|"scroll"|"none"} [action]
 * @property {string} [input]          payload for "type" action
 */

/**
 * @typedef {Object} VoiceoverBeat
 * @property {string} id               stable beat id (BEAT-1, BEAT-2, ...)
 * @property {string} narrator_text    what the voice-over reads aloud
 * @property {number} target_duration_ms
 * @property {ScreenCaptureCue} [screen_capture]
 * @property {Transition} [transition]
 * @property {string} [note]           author note (not narrated)
 */

/**
 * @typedef {Object} StoryboardBeat
 * @property {string} id               matches corresponding VoiceoverBeat.id
 * @property {string} title            shown in storyboard view
 * @property {string} [camera_plan]    e.g. "full-screen app, then zoom to sidebar"
 * @property {string} [b_roll_hint]    e.g. "terminal output, blurred in background"
 * @property {string} [on_screen_text] overlay/caption text
 */

/**
 * @typedef {Object} FeatureManifestEntry
 * @property {string} id               e.g. "FEAT-auth", "FEAT-dashboard"
 * @property {string} title
 * @property {string} [description]
 * @property {string[]} [entry_points] URLs / CLI commands exposing the feature
 * @property {string[]} [tags]
 */

/**
 * @typedef {Object} ProjectContext
 * The input that generators consume. 16-A tests inject synthetic contexts;
 * 16-B wires real discovery (walk PMD docs + parse feature manifest + read
 * test results).
 *
 * @property {string} project_id                 e.g. "todo-app"
 * @property {string} project_title              display name for docs
 * @property {string} [project_summary]          one-paragraph description
 * @property {FeatureManifestEntry[]} [features] canonical feature list
 * @property {string[]} [pmd_doc_ids]            IDs of relevant PMD docs (B2, B5, C2...)
 * @property {Object} [artifacts]                pointers into Phase 6-A store (ignored in 16-A)
 * @property {Object} [runtime]                  base_url / auth_method / etc. for screen capture
 */

/**
 * @typedef {Object} TrainingProvenance
 * @property {string} generator_id     e.g. "generator:template:user_guide"
 * @property {string} [model]          set when 16-B LLM generator is used
 * @property {string} [run_id]
 * @property {number} [iteration]
 */

/**
 * @typedef {Object} TrainingArtifact
 * @property {string} id                         e.g. "TART-0042"
 * @property {TrainingKind} kind
 * @property {number} schema_version             default 1
 * @property {string} project_id
 * @property {string} title
 * @property {string} content_ref                relative path inside the project's _training/ dir
 * @property {string} content_sha256             hex digest of file content
 * @property {"markdown"|"json"} format
 * @property {TrainingProvenance} produced_by
 * @property {string} produced_at                ISO 8601 UTC
 * @property {number} [cost_usd]                 0 for 16-A templates
 * @property {string[]} [parent_ids]             upstream TrainingArtifact ids (e.g. storyboard parents voiceover)
 * @property {string[]} [tags]
 * @property {Record<string,any>} [meta]         kind-specific: beat_count, target_duration_total_ms, feature_ids, ...
 */

export const SCHEMA_VERSION = 1;

export const TRAINING_KINDS = Object.freeze([
  "user_guide",
  "quick_start",
  "how_to",
  "reference_doc",
  "voiceover_script",
  "video_storyboard",
]);

export const TRANSITIONS = Object.freeze(["cut", "fade", "zoom", "highlight"]);

/**
 * Each TrainingKind defines its default on-disk format:
 *   markdown — human-consumable prose
 *   json     — structured script/storyboard for Phase 17
 */
export const KIND_FORMAT = Object.freeze({
  user_guide:       "markdown",
  quick_start:      "markdown",
  how_to:           "markdown",
  reference_doc:    "markdown",
  voiceover_script: "json",
  video_storyboard: "json",
});

export function isValidKind(k) { return TRAINING_KINDS.includes(k); }
export function isValidTransition(t) { return TRANSITIONS.includes(t); }
export function formatFor(kind) { return KIND_FORMAT[kind] || "markdown"; }

export function nowIso() { return new Date().toISOString(); }
