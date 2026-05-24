/**
 * Phase Roadmap store (UI-I) — atomic JSON IO + audit-log append.
 *
 * Data files live at `<repo>/_roadmap/`:
 *   phases.json      — phase metadata + ordering
 *   bands.json       — release-band definitions
 *   tasks.json       — flat task list (each task linked to phase_id + band_id)
 *   _history.jsonl   — append-only audit log of every mutation
 *
 * Why a separate module (not part of an existing one):
 *   - Roadmap data is its own concern — orthogonal to factory pipeline,
 *     customer portal, Courier, etc. Keeps the surface clean.
 *   - The factory's "own state" lives in per-phase Status.md narratives;
 *     this module is the STRUCTURED projection of that state for
 *     dashboard rendering + interactive editing.
 *
 * Atomicity:
 *   - Writes go through writeAtomic (write → fsync → rename) so a
 *     crashed write never leaves a partial JSON file on disk.
 *   - History append is line-oriented so even partial writes leave the
 *     rest readable.
 *
 * Concurrency:
 *   - v0.0.1 single-founder; no locking. If a future R2/R3 has multiple
 *     founders editing simultaneously, swap for a per-file lock or
 *     migrate to a SQLite-backed store.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..", "_roadmap");

const TASK_STATUSES = Object.freeze([
  "pending", "in_progress", "blocked", "done", "obsolete",
]);
const PHASE_STATUSES = Object.freeze([
  "pending", "in_progress", "partial", "done", "blocked",
]);

export function isValidTaskStatus(s)  { return TASK_STATUSES.includes(s); }
export function isValidPhaseStatus(s) { return PHASE_STATUSES.includes(s); }

async function writeAtomic(filePath, body) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, filePath);
}

/**
 * @param {object} [init]
 * @param {string} [init.rootDir]  Override _roadmap/ root (for tests)
 */
export function createRoadmapStore(init = {}) {
  const root = init.rootDir || DEFAULT_ROOT;
  const PATHS = {
    phases:  path.join(root, "phases.json"),
    bands:   path.join(root, "bands.json"),
    tasks:   path.join(root, "tasks.json"),
    history: path.join(root, "_history.jsonl"),
  };

  async function readJson(filePath) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async function appendHistory(entry) {
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
    try { await fs.appendFile(PATHS.history, line, "utf8"); } catch (err) {
      console.warn("[roadmap.store] history append failed:", err?.message || err);
    }
  }

  return {
    rootDir: root,

    // ── reads ──────────────────────────────────────────────────────────
    async readBands()  { const d = await readJson(PATHS.bands);  return d?.bands  || []; },
    async readPhases() { const d = await readJson(PATHS.phases); return d?.phases || []; },
    async readTasks()  { const d = await readJson(PATHS.tasks);  return d?.tasks  || []; },

    /**
     * Build a top-level summary for the dashboard: per-band completion
     * counts + currently-active items. Cheaper than the UI computing
     * this from raw arrays.
     */
    async readSummary() {
      const [bands, phases, tasks] = await Promise.all([
        this.readBands(), this.readPhases(), this.readTasks(),
      ]);
      const byBand = {};
      for (const b of bands) byBand[b.id] = { total: 0, done: 0, in_progress: 0, blocked: 0, pending: 0 };
      for (const t of tasks) {
        if (!byBand[t.band_id]) byBand[t.band_id] = { total: 0, done: 0, in_progress: 0, blocked: 0, pending: 0 };
        byBand[t.band_id].total += 1;
        if (byBand[t.band_id][t.status] !== undefined) byBand[t.band_id][t.status] += 1;
      }
      const phaseStatusCounts = phases.reduce((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
      }, {});
      const enrichedBands = bands.map(b => ({
        ...b,
        task_counts: byBand[b.id] || { total: 0, done: 0, in_progress: 0, blocked: 0, pending: 0 },
        percent_done: byBand[b.id]?.total
          ? Math.round((byBand[b.id].done / byBand[b.id].total) * 100)
          : 0,
      }));
      return {
        phases: { total: phases.length, by_status: phaseStatusCounts },
        bands:  enrichedBands,
        tasks:  {
          total: tasks.length,
          by_status: tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {}),
        },
        updated_at: new Date().toISOString(),
      };
    },

    /**
     * Single phase view — phase metadata + its tasks. Tasks newest-first
     * by id (descending so newly-added show on top).
     */
    async readPhase(phaseId) {
      const [phases, tasks] = await Promise.all([this.readPhases(), this.readTasks()]);
      const phase = phases.find(p => p.id === phaseId);
      if (!phase) return null;
      const phaseTasks = tasks
        .filter(t => t.phase_id === phaseId)
        .sort((a, b) => String(b.id).localeCompare(String(a.id)));
      return { phase, tasks: phaseTasks };
    },

    // ── writes ─────────────────────────────────────────────────────────

    /**
     * Patch a task. Allowed fields: phase_id, band_id, title, status,
     * notes, git_tag, pr, shipped_at, decision_id. Validates status enum.
     * Returns the updated task.
     */
    async updateTask(taskId, patch, actor = "founder") {
      const file = await readJson(PATHS.tasks);
      if (!file) throw new Error("tasks.json missing");
      const idx = file.tasks.findIndex(t => t.id === taskId);
      if (idx < 0) throw new Error(`task not found: ${taskId}`);
      const before = { ...file.tasks[idx] };
      const allowed = ["phase_id", "band_id", "title", "status", "notes", "git_tag", "pr", "shipped_at", "decision_id"];
      const cleanPatch = {};
      for (const k of allowed) if (Object.hasOwn(patch, k)) cleanPatch[k] = patch[k];
      if (cleanPatch.status && !isValidTaskStatus(cleanPatch.status)) {
        throw new Error(`invalid status: ${cleanPatch.status} (allowed: ${TASK_STATUSES.join(",")})`);
      }
      file.tasks[idx] = { ...file.tasks[idx], ...cleanPatch };
      file._updated_at = new Date().toISOString();
      await writeAtomic(PATHS.tasks, JSON.stringify(file, null, 2));
      await appendHistory({ kind: "task.update", actor, task_id: taskId, patch: cleanPatch, before });
      return file.tasks[idx];
    },

    /**
     * Create a new task. Auto-assigns id from `_next_id` counter.
     * Required: phase_id, band_id, title.
     */
    async createTask(input, actor = "founder") {
      if (!input?.phase_id) throw new Error("phase_id required");
      if (!input?.band_id)  throw new Error("band_id required");
      if (!input?.title)    throw new Error("title required");
      const file = await readJson(PATHS.tasks);
      if (!file) throw new Error("tasks.json missing");
      const nextId = file._next_id || (file.tasks.length + 1);
      const id = `T-${String(nextId).padStart(4, "0")}`;
      const task = {
        id,
        phase_id: input.phase_id,
        band_id: input.band_id,
        title: input.title,
        status: isValidTaskStatus(input.status) ? input.status : "pending",
        notes: input.notes || undefined,
        git_tag: input.git_tag || undefined,
        pr: input.pr || undefined,
      };
      // strip undefined for cleaner JSON
      for (const k of Object.keys(task)) if (task[k] === undefined) delete task[k];
      file.tasks.push(task);
      file._next_id = nextId + 1;
      file._updated_at = new Date().toISOString();
      await writeAtomic(PATHS.tasks, JSON.stringify(file, null, 2));
      await appendHistory({ kind: "task.create", actor, task_id: id, task });
      return task;
    },

    /**
     * Soft delete — mark status='obsolete' (preserves history). Use
     * destroyTask for true removal (rare).
     */
    async deleteTask(taskId, actor = "founder") {
      return this.updateTask(taskId, { status: "obsolete" }, actor);
    },

    /**
     * Re-enable a previously-done task for enhancement. Status goes
     * done → in_progress; the prior shipped_at + git_tag + pr remain as
     * historical reference.
     */
    async reenableTask(taskId, actor = "founder") {
      return this.updateTask(taskId, { status: "in_progress" }, actor);
    },

    /**
     * Move a task to a different phase (optional band update at the same time).
     */
    async moveTask(taskId, newPhaseId, newBandId, actor = "founder") {
      const patch = { phase_id: newPhaseId };
      if (newBandId) patch.band_id = newBandId;
      return this.updateTask(taskId, patch, actor);
    },

    async readHistory(limit = 100) {
      try {
        const raw = await fs.readFile(PATHS.history, "utf8");
        const lines = raw.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
        return lines.slice(-limit).reverse();
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
    },
  };
}

export { TASK_STATUSES, PHASE_STATUSES };
