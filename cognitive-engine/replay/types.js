/**
 * Replay engine — types for time-traveling through past LangGraph runs.
 *
 * Built on Phase 6-A artifact store: every artifact's `produced_by.run_id` is
 * the join key, and `parent_ids` is the dependency edge set. Replay walks
 * those edges to identify what to re-execute when a single node is changed.
 */

/**
 * @typedef {Object} RunArtifact
 * @property {string} id
 * @property {string} kind
 * @property {string} run_id
 * @property {string} agent
 * @property {string} [model]
 * @property {string} [node]
 * @property {string[]} parent_ids
 * @property {string} produced_at
 * @property {number} [cost_usd]
 * @property {number} [latency_ms]
 */

/**
 * @typedef {Object} RunSnapshot
 * @property {string} run_id
 * @property {string} project_id
 * @property {RunArtifact[]} artifacts
 * @property {string[]} agents              ordered list (by produced_at) of agents that produced artifacts
 * @property {{from: string, to: string}} window
 */

/**
 * @typedef {Object} ReplayPlan
 * @property {string} source_run_id
 * @property {string} new_run_id
 * @property {string} project_id
 * @property {string} replay_from_artifact_id     pivot point: this artifact's producing-node is the first to re-execute
 * @property {string[]} frozen_artifact_ids       upstream of pivot — provided to replay as inputs
 * @property {string[]} replay_artifact_ids       pivot + descendants — to be re-executed
 * @property {Record<string, string>} [substitutions]   artifact_id → replacement artifact id (for "what if I swap THIS one")
 */

/**
 * @typedef {Object} NodeStubInput
 * @property {RunArtifact} original                 the artifact this stub is replacing
 * @property {RunArtifact[]} parents                resolved parent artifacts (frozen or substituted or just-produced in this replay)
 * @property {string} new_run_id
 * @property {string} project_id
 */

/**
 * @typedef {Object} NodeStubOutput
 * @property {string|object} content
 * @property {string} kind
 * @property {string} agent
 * @property {string} [model]
 * @property {string} [node]
 * @property {number} [cost_usd]
 * @property {number} [latency_ms]
 */

/**
 * @typedef {(input: NodeStubInput) => Promise<NodeStubOutput>} NodeStub
 */

/**
 * @typedef {Object} ReplayResult
 * @property {boolean} ok
 * @property {string} new_run_id
 * @property {string[]} new_artifact_ids
 * @property {Array<{original_id: string, new_id: string, agent: string}>} produced
 * @property {string} [error]
 * @property {number} duration_ms
 */

export const SCHEMA_VERSION = 1;

export function deriveReplayRunId(sourceRunId, sequenceNumber = 1) {
  if (!sourceRunId) throw new Error("sourceRunId required");
  return `${sourceRunId}.replay.${sequenceNumber}`;
}

export function nextReplaySequence(existingRunIds, sourceRunId) {
  const prefix = `${sourceRunId}.replay.`;
  let max = 0;
  for (const id of existingRunIds || []) {
    if (typeof id !== "string" || !id.startsWith(prefix)) continue;
    const n = parseInt(id.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}
