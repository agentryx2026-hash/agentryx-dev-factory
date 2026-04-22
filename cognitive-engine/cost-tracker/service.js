import { rollupFromArtifacts } from "./artifact-source.js";
import { rollupFromDb } from "./db-source.js";

/**
 * Unified rollup entry point. Reads COST_TRACKER_SOURCE env to choose source:
 *   "artifacts" (default) | "db" | "merged"
 *
 * @param {import("./types.js").RollupFilter} [filter]
 * @param {object} [opts]
 * @param {string} [opts.workspaceRoot]
 * @param {import("pg").Pool} [opts.pool]
 * @param {"artifacts"|"db"|"merged"} [opts.source]
 * @returns {Promise<import("./types.js").CostRollup>}
 */
export async function getRollup(filter = {}, opts = {}) {
  const source = opts.source || process.env.COST_TRACKER_SOURCE || "artifacts";
  if (source === "artifacts") {
    if (!opts.workspaceRoot) throw new Error("getRollup: workspaceRoot required for artifact source");
    return rollupFromArtifacts(opts.workspaceRoot, filter);
  }
  if (source === "db") {
    if (!opts.pool) throw new Error("getRollup: pool required for db source");
    return rollupFromDb(opts.pool, filter);
  }
  if (source === "merged") {
    if (!opts.workspaceRoot || !opts.pool) throw new Error("getRollup: both workspaceRoot and pool required for merged");
    const [artifactsRollup, dbRollup] = await Promise.all([
      rollupFromArtifacts(opts.workspaceRoot, filter),
      rollupFromDb(opts.pool, filter),
    ]);
    return mergeRollups(artifactsRollup, dbRollup);
  }
  throw new Error(`unknown COST_TRACKER_SOURCE: ${source}`);
}

/**
 * Merge two rollups — prefers DB values when present (DB has full token data
 * that artifacts don't), falls back to artifacts for projects the DB missed.
 */
export function mergeRollups(a, b) {
  const keys = new Set([...Object.keys(a.by_project || {}), ...Object.keys(b.by_project || {})]);
  const mergedByProject = {};
  for (const k of keys) {
    const av = a.by_project[k];
    const bv = b.by_project[k];
    mergedByProject[k] = bv || av; // prefer b (db)
  }
  return {
    period: { from: a.period.from < b.period.from ? a.period.from : b.period.from, to: a.period.to > b.period.to ? a.period.to : b.period.to },
    totals: b.totals.calls >= a.totals.calls ? b.totals : a.totals,
    by_project: mergedByProject,
    by_agent:   { ...a.by_agent,   ...b.by_agent },
    by_model:   { ...a.by_model,   ...b.by_model },
    by_day:     { ...a.by_day,     ...b.by_day },
    source: "merged",
  };
}

export function isEnabled() {
  return process.env.USE_COST_TRACKER === "true";
}
