import { deriveReplayRunId, nextReplaySequence } from "./types.js";
import { listRunIds } from "./run-collector.js";

/**
 * Build a ReplayPlan from a recorded RunSnapshot.
 *
 * @param {import("./types.js").RunSnapshot} snapshot
 * @param {object} params
 * @param {string} params.replayFromArtifactId        pivot — this artifact and all its descendants get re-executed
 * @param {Record<string, string>} [params.substitutions]  optional artifact_id → replacement_id swap (the swap target is treated as frozen input)
 * @param {string} [params.newRunId]                  if omitted, derived as <source>.replay.<N>
 * @param {string[]} [params.existingRunIds]          for nextReplaySequence; defaults to []
 * @returns {import("./types.js").ReplayPlan}
 */
export function buildReplayPlan(snapshot, params) {
  if (!snapshot) throw new Error("buildReplayPlan: snapshot required");
  if (!params?.replayFromArtifactId) throw new Error("buildReplayPlan: replayFromArtifactId required");

  const pivot = snapshot.artifacts.find(a => a.id === params.replayFromArtifactId);
  if (!pivot) throw new Error(`pivot artifact ${params.replayFromArtifactId} not found in run ${snapshot.run_id}`);

  // Walk descendants from pivot using parent_ids edges (children-of relation).
  const childrenOf = new Map();
  for (const a of snapshot.artifacts) {
    for (const p of a.parent_ids) {
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p).push(a.id);
    }
  }

  const replaySet = new Set([pivot.id]);
  const queue = [pivot.id];
  while (queue.length) {
    const cur = queue.shift();
    for (const child of childrenOf.get(cur) || []) {
      if (!replaySet.has(child)) {
        replaySet.add(child);
        queue.push(child);
      }
    }
  }

  const frozenSet = new Set();
  for (const id of replaySet) {
    const a = snapshot.artifacts.find(x => x.id === id);
    for (const parent of a.parent_ids) {
      if (!replaySet.has(parent)) frozenSet.add(parent);
    }
  }

  let newRunId = params.newRunId;
  if (!newRunId) {
    const seq = nextReplaySequence(params.existingRunIds || [], snapshot.run_id);
    newRunId = deriveReplayRunId(snapshot.run_id, seq);
  }

  // Sort replay set by produced_at so executor runs in temporal order
  const replaySorted = snapshot.artifacts
    .filter(a => replaySet.has(a.id))
    .sort((a, b) => a.produced_at < b.produced_at ? -1 : 1)
    .map(a => a.id);

  return {
    source_run_id: snapshot.run_id,
    new_run_id: newRunId,
    project_id: snapshot.project_id,
    replay_from_artifact_id: pivot.id,
    frozen_artifact_ids: [...frozenSet].sort(),
    replay_artifact_ids: replaySorted,
    substitutions: params.substitutions || {},
  };
}
