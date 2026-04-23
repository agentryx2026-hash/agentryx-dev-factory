/**
 * Self-improvement engine — types for the proposal lifecycle.
 *
 * A Proposal is a structured, reviewable suggestion to change the factory
 * (prompt, model assignment, config, graph topology). Proposals flow through
 * a state machine: draft → evaluating → ready → approved|rejected → applied.
 *
 * Phase 15-A ships the substrate (state machine, heuristic proposer, evaluator
 * harness, applier for config-only changes). Phase 15-B will swap the heuristic
 * proposer for an LLM-backed brain.
 */

/**
 * @typedef {"prompt_change"|"model_change"|"config_change"|"graph_change"} ProposalKind
 *
 * - prompt_change:  edit a prompt template for a named agent
 * - model_change:   change the model assigned to a task tier
 * - config_change:  update a value in a registry-known JSON config (Phase 12-A)
 * - graph_change:   reorder, add, or remove a node in a graph (NOT applied in 15-A)
 */

/**
 * @typedef {"draft"|"evaluating"|"ready"|"approved"|"rejected"|"applied"} ProposalState
 *
 * Linear progression. From any state can also move to "rejected".
 *   draft        — proposer created it; not yet evaluated
 *   evaluating   — replay-based evaluator running
 *   ready        — evaluation done; awaiting human review
 *   approved     — Super Admin approved; awaiting application
 *   rejected     — Super Admin rejected (terminal)
 *   applied      — applier wrote the change (terminal)
 */

/**
 * @typedef {Object} ProposalRationale
 * @property {string} summary                    one-sentence reason
 * @property {string[]} supporting_observations  e.g. ["OBS-0042", "OBS-0058"]
 * @property {Record<string, any>} [meta]
 */

/**
 * @typedef {Object} ProposalChange
 *  Discriminated by kind. For 15-A, simple shape:
 * @property {string} target                     e.g. "agent:troi.system_prompt", "config:cost_thresholds", "task:architect.primary_model"
 * @property {string} from                       current value (for diff/audit)
 * @property {string} to                         proposed new value
 */

/**
 * @typedef {Object} EvaluationResult
 * @property {number} sample_size                replays attempted
 * @property {number} cost_delta_usd             new average minus original average
 * @property {number} latency_delta_ms
 * @property {number} success_rate_delta         -1.0 to +1.0 (positive = improvement)
 * @property {string} [comparison_note]
 * @property {string} evaluated_at               ISO 8601 UTC
 */

/**
 * @typedef {Object} Proposal
 * @property {string} id                         e.g. "PROP-0042"
 * @property {ProposalKind} kind
 * @property {ProposalState} state
 * @property {number} schema_version             default 1
 * @property {string} created_at                 ISO 8601 UTC
 * @property {string} created_by                 e.g. "proposer:heuristic", "proposer:llm:opus", "human:subhash"
 * @property {ProposalChange} change
 * @property {ProposalRationale} rationale
 * @property {EvaluationResult} [evaluation]
 * @property {string} [reviewer]                 super_admin email when approved/rejected
 * @property {string} [reviewed_at]
 * @property {string} [review_note]
 * @property {string} [applied_at]
 * @property {Record<string, any>} [apply_result]
 */

export const SCHEMA_VERSION = 1;

export const PROPOSAL_KINDS = Object.freeze([
  "prompt_change", "model_change", "config_change", "graph_change",
]);

export const PROPOSAL_STATES = Object.freeze([
  "draft", "evaluating", "ready", "approved", "rejected", "applied",
]);

export const TERMINAL_STATES = Object.freeze(["rejected", "applied"]);

const VALID_TRANSITIONS = Object.freeze({
  draft:      ["evaluating", "rejected"],
  evaluating: ["ready", "rejected"],
  ready:      ["approved", "rejected"],
  approved:   ["applied", "rejected"],
  rejected:   [],
  applied:    [],
});

export function isValidKind(k) { return PROPOSAL_KINDS.includes(k); }
export function isValidState(s) { return PROPOSAL_STATES.includes(s); }
export function canTransition(from, to) {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

export function nowIso() { return new Date().toISOString(); }
