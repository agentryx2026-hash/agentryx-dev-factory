import { walkArtifacts } from "../memory-layer/artifact-walker.js";
import { emptyBucket, addToBucket, roundBucket } from "./types.js";

/**
 * Build a CostRollup from artifact stores on disk. No DB required.
 *
 * @param {string} workspaceRoot
 * @param {import("./types.js").RollupFilter} [filter]
 * @returns {Promise<import("./types.js").CostRollup>}
 */
export async function rollupFromArtifacts(workspaceRoot, filter = {}) {
  const all = await walkArtifacts(workspaceRoot);
  const from = filter.from ? new Date(filter.from).getTime() : -Infinity;
  const to = filter.to ? new Date(filter.to).getTime() : Infinity;
  const projectSet = filter.project_ids ? new Set(filter.project_ids) : null;
  const agentSet = filter.agents ? new Set(filter.agents) : null;
  const modelSet = filter.models ? new Set(filter.models) : null;

  const totals = emptyBucket();
  const by_project = {};
  const by_agent = {};
  const by_model = {};
  const by_day = {};
  let minTs = null, maxTs = null;

  for (const record of all) {
    const ts = new Date(record.produced_at).getTime();
    if (isNaN(ts) || ts < from || ts > to) continue;
    if (projectSet && !projectSet.has(record.project_id)) continue;
    const agent = record.produced_by?.agent;
    if (agentSet && (!agent || !agentSet.has(agent))) continue;
    const model = record.produced_by?.model;
    if (modelSet && (!model || !modelSet.has(model))) continue;

    minTs = minTs == null ? ts : Math.min(minTs, ts);
    maxTs = maxTs == null ? ts : Math.max(maxTs, ts);

    const delta = {
      cost_usd: typeof record.cost_usd === "number" ? record.cost_usd : 0,
      calls: 1,
    };

    addToBucket(totals, delta);
    addToBucket((by_project[record.project_id] ||= emptyBucket()), delta);
    if (agent) addToBucket((by_agent[agent] ||= emptyBucket()), delta);
    if (model) addToBucket((by_model[model] ||= emptyBucket()), delta);
    const dayKey = new Date(ts).toISOString().slice(0, 10);
    addToBucket((by_day[dayKey] ||= emptyBucket()), delta);
  }

  const periodFrom = filter.from || (minTs != null ? new Date(minTs).toISOString() : new Date(0).toISOString());
  const periodTo = filter.to || (maxTs != null ? new Date(maxTs).toISOString() : new Date().toISOString());

  return {
    period: { from: periodFrom, to: periodTo },
    totals: roundBucket(totals),
    by_project: Object.fromEntries(Object.entries(by_project).map(([k, v]) => [k, roundBucket(v)])),
    by_agent: Object.fromEntries(Object.entries(by_agent).map(([k, v]) => [k, roundBucket(v)])),
    by_model: Object.fromEntries(Object.entries(by_model).map(([k, v]) => [k, roundBucket(v)])),
    by_day: Object.fromEntries(Object.entries(by_day).map(([k, v]) => [k, roundBucket(v)])),
    source: "artifacts",
  };
}
