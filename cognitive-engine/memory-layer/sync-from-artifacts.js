/**
 * Phase 7-E — Memory observations from artifacts.
 *
 * After Phase 6-B activates and pipeline runs start writing artifacts,
 * this module walks them and produces durable memory-layer observations:
 *
 *   - One `lesson` per project run: which agents participated, total
 *     cost, total artifacts, run window. Scope = `project:<projectId>`.
 *   - One `pattern` per agent across the workspace: volume, avg cost,
 *     last-seen timestamp. Scope = `agent:<agentName>`.
 *
 * The sync is idempotent at the run-id level: a `_sync_state.json` next
 * to the memory vault tracks `synced_run_ids`, so re-running on the
 * same workspace doesn't double-write project lessons. Agent patterns
 * are append-only with `synced_at` so trend can be reconstructed.
 *
 * Founder triggers via the Memory Layer page "Sync from artifacts"
 * button (POST /api/factory-admin/memory/sync-from-artifacts). Future
 * Phase 7-E.2 wires this into the architect daemon's monthly cycle so
 * it runs automatically.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { walkArtifacts } from "./artifact-walker.js";

const SYNC_STATE_FILE = "_sync_state.json";

/**
 * @param {Object} init
 * @param {string} init.workspaceRoot         path to agent-workspace
 * @param {Object} init.memoryService         result of getMemoryService()
 * @param {string} [init.memoryRootDir]       where _sync_state.json lives (default: alongside the memory vault)
 */
export async function syncFromArtifacts(init) {
  if (!init?.workspaceRoot) throw new Error("syncFromArtifacts: workspaceRoot required");
  if (!init?.memoryService) throw new Error("syncFromArtifacts: memoryService required");

  const memoryRootDir = init.memoryRootDir || init.memoryService.rootDir || process.env.FACTORY_MEMORY_ROOT;
  const stateFile = memoryRootDir ? path.join(memoryRootDir, SYNC_STATE_FILE) : null;
  const priorState = await readSyncState(stateFile);

  const all = await walkArtifacts(init.workspaceRoot);
  if (all.length === 0) {
    return { ok: true, synced: 0, skipped: 0, reason: "no artifacts in workspace" };
  }

  // Group by run_id (a project may have multiple runs over time)
  const byRun = new Map();
  for (const a of all) {
    const runId = a.produced_by?.run_id;
    if (!runId) continue;
    if (!byRun.has(runId)) byRun.set(runId, { runId, project_id: a.project_id, artifacts: [] });
    byRun.get(runId).artifacts.push(a);
  }

  let observationsWritten = 0;
  let skipped = 0;
  const newSyncedRunIds = new Set(priorState.synced_run_ids || []);

  // Per-run project lessons (idempotent)
  for (const run of byRun.values()) {
    if (newSyncedRunIds.has(run.runId)) { skipped += 1; continue; }
    const agents = [...new Set(run.artifacts.map(a => a.produced_by?.agent).filter(Boolean))];
    const totalCost = run.artifacts.reduce((s, a) => s + (Number(a.cost_usd) || 0), 0);
    const totalLatency = run.artifacts.reduce((s, a) => s + (Number(a.latency_ms) || 0), 0);
    const window = {
      from: run.artifacts[0]?.produced_at,
      to: run.artifacts[run.artifacts.length - 1]?.produced_at,
    };
    const kindCounts = {};
    for (const a of run.artifacts) kindCounts[a.kind] = (kindCounts[a.kind] || 0) + 1;
    const kindsFmt = Object.entries(kindCounts).map(([k, n]) => `${k}=${n}`).join(", ");

    const content = [
      `Run ${run.runId} on project "${run.project_id}" produced ${run.artifacts.length} artifacts (${kindsFmt}).`,
      `Agents involved: ${agents.join(", ") || "(none tagged)"}.`,
      `Total cost: $${totalCost.toFixed(4)}; total latency: ${(totalLatency / 1000).toFixed(1)}s.`,
      `Window: ${window.from || "?"} → ${window.to || "?"}.`,
    ].join(" ");

    try {
      await init.memoryService.addObservation({
        kind: "lesson",
        scope: `project:${run.project_id}`,
        content,
        tags: ["sync-from-artifacts", "run-summary", ...agents.map(a => `agent:${a}`)],
        refs: { run_id: run.runId, artifact_count: run.artifacts.length },
        produced_by: "memory.sync-from-artifacts",
      });
      observationsWritten += 1;
      newSyncedRunIds.add(run.runId);
    } catch (err) {
      console.warn(`[sync-from-artifacts] addObservation failed for run ${run.runId}: ${err?.message}`);
    }
  }

  // Per-agent pattern observation (one fresh per sync)
  const byAgent = new Map();
  for (const a of all) {
    const ag = a.produced_by?.agent;
    if (!ag) continue;
    if (!byAgent.has(ag)) byAgent.set(ag, { agent: ag, count: 0, cost: 0, latency: 0, lastSeen: "" });
    const bucket = byAgent.get(ag);
    bucket.count += 1;
    bucket.cost += Number(a.cost_usd) || 0;
    bucket.latency += Number(a.latency_ms) || 0;
    if ((a.produced_at || "").localeCompare(bucket.lastSeen) > 0) bucket.lastSeen = a.produced_at;
  }

  for (const b of byAgent.values()) {
    const avgCost = b.count > 0 ? b.cost / b.count : 0;
    const avgLatency = b.count > 0 ? b.latency / b.count : 0;
    const content = [
      `Agent "${b.agent}" has produced ${b.count} artifact(s) across the workspace.`,
      `Avg cost per call: $${avgCost.toFixed(4)}; avg latency: ${avgLatency.toFixed(0)}ms.`,
      `Last seen: ${b.lastSeen || "?"}.`,
    ].join(" ");

    try {
      await init.memoryService.addObservation({
        kind: "pattern",
        scope: `agent:${b.agent}`,
        content,
        tags: ["sync-from-artifacts", "agent-volume"],
        refs: { count: b.count, avg_cost_usd: Number(avgCost.toFixed(4)) },
        produced_by: "memory.sync-from-artifacts",
      });
      observationsWritten += 1;
    } catch (err) {
      console.warn(`[sync-from-artifacts] addObservation failed for agent ${b.agent}: ${err?.message}`);
    }
  }

  // Persist sync state
  if (stateFile) {
    try {
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(
        stateFile,
        JSON.stringify({
          synced_run_ids: [...newSyncedRunIds],
          last_synced_at: new Date().toISOString(),
          last_observations_written: observationsWritten,
        }, null, 2),
        "utf-8",
      );
    } catch (err) {
      console.warn(`[sync-from-artifacts] failed to write sync state: ${err?.message}`);
    }
  }

  return {
    ok: true,
    synced: observationsWritten,
    skipped,
    runs_processed: byRun.size,
    agents_processed: byAgent.size,
    artifacts_scanned: all.length,
  };
}

async function readSyncState(stateFile) {
  if (!stateFile) return { synced_run_ids: [] };
  try {
    const raw = await fs.readFile(stateFile, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { synced_run_ids: [] };
  }
}
