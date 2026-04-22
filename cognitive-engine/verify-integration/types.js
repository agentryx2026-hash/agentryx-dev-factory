/**
 * Verify portal integration types.
 *
 * Defines the boundary contract between the factory and verify-stg.agentryx.dev:
 * factory pushes BuildBundles; Verify returns FeedbackPayloads via webhook.
 */

/**
 * @typedef {Object} ReviewItem
 * @property {string} id                         e.g. "RI-0001"
 * @property {string} requirement_id             link back to A1/A2/FRS requirement id if available
 * @property {string} title
 * @property {string} [description]
 * @property {string} [artifact_id]              link to Phase 6-A artifact (ART-NNNN)
 * @property {"manual"|"automated"|"screenshot"|"smoke"} category
 * @property {string[]} [test_steps]             ordered steps for reviewer
 * @property {string} [expected_behavior]
 */

/**
 * @typedef {Object} BuildBundle
 * @property {string} build_id                   e.g. "pre-dev-2026-04-22-abc"
 * @property {string} project_id                 project dir name under agent-workspace
 * @property {string} version                    semver or run-id tag
 * @property {string} produced_at                ISO 8601 UTC
 * @property {string} [preview_url]              deployed staging instance
 * @property {string} [agent_trace_url]          Langfuse link
 * @property {string} [release_notes]
 * @property {ReviewItem[]} review_items
 * @property {string[]} [screenshot_artifact_ids]   artifact ids that are screenshots
 * @property {Record<string,any>} [meta]
 */

/**
 * @typedef {"pass"|"partial"|"fail"} ReviewDecision
 */

/**
 * @typedef {Object} FeedbackPayload
 * @property {string} build_id
 * @property {string} [requirement_id]           if feedback is per-item rather than whole build
 * @property {string} [review_item_id]
 * @property {ReviewDecision} decision
 * @property {string} [comments]
 * @property {string[]} [screenshot_urls]        external URLs (Verify-hosted)
 * @property {string} reviewer                   human identifier (email / slug)
 * @property {string} reviewed_at                ISO 8601 UTC
 */

/**
 * @typedef {Object} FixRoute
 * @property {"code"|"tests"|"docs"|"triage"|"none"} lane
 * @property {string} [agent]                    e.g. "spock", "tuvok", "data"
 * @property {string} [reason]
 * @property {string[]} [evidence_artifact_ids]
 */

export const SCHEMA_VERSION = 1;

export const REVIEW_DECISIONS = Object.freeze(["pass", "partial", "fail"]);

export function isValidDecision(d) {
  return REVIEW_DECISIONS.includes(d);
}

export function validateFeedbackPayload(p) {
  if (!p || typeof p !== "object") return "payload must be an object";
  if (!p.build_id) return "build_id required";
  if (!isValidDecision(p.decision)) return `invalid decision: ${p.decision} (expected pass|partial|fail)`;
  if (!p.reviewer) return "reviewer required";
  if (!p.reviewed_at) return "reviewed_at required";
  return null;
}
