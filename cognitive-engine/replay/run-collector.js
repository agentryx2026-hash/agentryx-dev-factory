import path from "node:path";
import { walkArtifacts } from "../memory-layer/artifact-walker.js";

/**
 * Collect every artifact for a given run_id, scanning all projects under workspaceRoot.
 *
 * @param {string} workspaceRoot
 * @param {string} runId
 * @returns {Promise<import("./types.js").RunSnapshot|null>}
 */
export async function collectRun(workspaceRoot, runId) {
  if (!workspaceRoot) throw new Error("collectRun: workspaceRoot required");
  if (!runId) throw new Error("collectRun: runId required");

  const all = await walkArtifacts(workspaceRoot);
  const matched = all
    .filter(a => a.produced_by?.run_id === runId)
    .map(a => ({
      id: a.id,
      kind: a.kind,
      run_id: runId,
      agent: a.produced_by?.agent || "",
      model: a.produced_by?.model,
      node: a.produced_by?.node,
      parent_ids: a.parent_ids || [],
      produced_at: a.produced_at,
      cost_usd: a.cost_usd,
      latency_ms: a.latency_ms,
      project_id: a.project_id,
    }));

  if (matched.length === 0) return null;

  // All artifacts of one run should belong to the same project
  const projectIds = [...new Set(matched.map(a => a.project_id))];
  if (projectIds.length > 1) {
    throw new Error(`run ${runId} spans multiple projects: ${projectIds.join(", ")} — replay assumes single-project runs`);
  }

  matched.sort((a, b) => a.produced_at < b.produced_at ? -1 : 1);
  const agents = [...new Set(matched.map(a => a.agent).filter(Boolean))];

  return {
    run_id: runId,
    project_id: projectIds[0],
    artifacts: matched.map(({ project_id, ...rest }) => rest),
    agents,
    window: {
      from: matched[0].produced_at,
      to: matched[matched.length - 1].produced_at,
    },
  };
}

/**
 * List all known run_ids in a workspace (across all projects).
 */
export async function listRunIds(workspaceRoot) {
  const all = await walkArtifacts(workspaceRoot);
  const seen = new Set();
  for (const a of all) {
    const r = a.produced_by?.run_id;
    if (r) seen.add(r);
  }
  return [...seen].sort();
}
