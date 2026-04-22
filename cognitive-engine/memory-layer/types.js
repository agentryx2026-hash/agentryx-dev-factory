/**
 * Memory Layer — Observation types and scope conventions.
 *
 * An observation is a durable note the factory captures (or a human writes)
 * about a project, agent behavior, pattern, decision, or mistake.
 * Observations are broader than `memory.js` skill-synthesis: not tied to code/success,
 * may be written by humans via the Verify portal, surface via Obsidian.
 */

/**
 * @typedef {"observation"|"lesson"|"pattern"|"decision"|"user_note"} ObservationKind
 *
 * - observation: raw fact ("the model returned 402 after 4097-token prompt")
 * - lesson:      generalized rule ("include EXAMPLE_OUTPUT when requesting structured JSON")
 * - pattern:     recurring shape ("auth failures correlate with missing CORS config")
 * - decision:    active choice rationale ("went with gemini-flash over sonnet for intake due to cost")
 * - user_note:   human-written note via Verify portal or direct file edit
 */

/**
 * Scope convention:
 *   "global"             — applies to the whole factory
 *   "agent:<agent_id>"   — specific to one named agent (troi, picard, genovi, ...)
 *   "project:<proj_id>"  — specific to one project (the agent-workspace subdir name)
 *
 * Prefer the narrowest accurate scope. A lesson that applies to Troi on React projects
 * would be "agent:troi" with tags like ["react"], not two separate observations.
 */

/**
 * @typedef {Object} ObservationRefs
 * @property {string[]} [artifact_ids]     e.g. ["ART-0042", "ART-0043"]
 * @property {string} [run_id]             pipeline run correlation
 * @property {string} [project_dir]        absolute or relative path
 */

/**
 * @typedef {Object} ObservationProvenance
 * @property {string} [agent]              e.g. "qa_reviewer", "human:subhash"
 * @property {string} [model]              LLM model id, if auto-generated
 * @property {string} [source]             e.g. "post_dev_graph", "verify_portal", "cli"
 */

/**
 * @typedef {Object} Observation
 * @property {string} id                            e.g. "OBS-0042"
 * @property {ObservationKind} kind
 * @property {number} schema_version                default 1
 * @property {string} scope                         "global" | "agent:<id>" | "project:<id>"
 * @property {string} content                       the actual text of the observation (markdown allowed)
 * @property {string[]} [tags]                      flat list, no hierarchy
 * @property {ObservationRefs} [refs]
 * @property {ObservationProvenance} [produced_by]
 * @property {string} produced_at                   ISO 8601 UTC
 */

/**
 * @typedef {Object} AddObservationInput
 * @property {ObservationKind} kind
 * @property {string} scope
 * @property {string} content
 * @property {string[]} [tags]
 * @property {ObservationRefs} [refs]
 * @property {ObservationProvenance} [produced_by]
 */

/**
 * @typedef {Object} RecallFilter
 * @property {string} [scope]                       exact match, or prefix like "project:"
 * @property {ObservationKind} [kind]
 * @property {string[]} [tags]                      AND semantics — all listed tags must be present
 * @property {string} [text]                        substring match on content (case-insensitive)
 * @property {number} [limit]                       default 20
 */

export const SCHEMA_VERSION = 1;

export const OBSERVATION_KINDS = Object.freeze([
  "observation",
  "lesson",
  "pattern",
  "decision",
  "user_note",
]);

export function isValidKind(k) {
  return OBSERVATION_KINDS.includes(k);
}

export function isValidScope(s) {
  if (typeof s !== "string" || !s) return false;
  if (s === "global") return true;
  return /^(agent|project):[A-Za-z0-9._-]+$/.test(s);
}
