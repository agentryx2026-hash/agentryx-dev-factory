import fs from "node:fs/promises";
import path from "node:path";

const ARTIFACTS_DIR = "_artifacts";
const INDEX_FILE = "index.jsonl";

/**
 * Walk all project subdirs under a workspace root, find their artifact indexes,
 * and return a flat list with project_id stamped on each record.
 *
 * @param {string} workspaceRoot  e.g. "/home/.../agent-workspace"
 * @returns {Promise<Array<object>>}
 */
export async function walkArtifacts(workspaceRoot) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;

    const indexPath = path.join(workspaceRoot, entry.name, ARTIFACTS_DIR, INDEX_FILE);
    try {
      const raw = await fs.readFile(indexPath, "utf-8");
      if (!raw.trim()) continue;
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        results.push({ project_id: entry.name, ...record });
      }
    } catch {
      // project has no artifact store — skip
    }
  }
  return results;
}

/**
 * Summarize artifact activity across all projects:
 * counts by kind, by project, total cost (sum of cost_usd).
 */
export async function summarizeArtifacts(workspaceRoot) {
  const all = await walkArtifacts(workspaceRoot);
  const byKind = {};
  const byProject = {};
  let totalCost = 0;

  for (const rec of all) {
    byKind[rec.kind] = (byKind[rec.kind] || 0) + 1;
    byProject[rec.project_id] = (byProject[rec.project_id] || 0) + 1;
    if (typeof rec.cost_usd === "number") totalCost += rec.cost_usd;
  }

  return {
    total_artifacts: all.length,
    total_projects: Object.keys(byProject).length,
    by_kind: byKind,
    by_project: byProject,
    total_cost_usd: Number(totalCost.toFixed(4)),
  };
}
