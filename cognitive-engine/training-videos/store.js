import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { SCHEMA_VERSION, nowIso } from "./types.js";

/**
 * Video artifact store.
 *
 * D153: Layout under `<workspace>/_videos/<project_id>/VID-NNNN/` with:
 *   video.mp4            final (or fake) video container
 *   audio/BEAT-*.wav     per-beat TTS outputs
 *   capture/BEAT-*.png   per-beat screen captures
 *   captions.srt         SRT caption track
 *   manifest.json        VideoArtifact record + asset map
 *   render-log.jsonl     append-only per-beat render events
 *   _seq                 per-project monotonic counter
 *
 * The manifest is the authoritative VideoArtifact. Asset files are references.
 */

const SEQ_FILE = "_seq";
const MANIFEST_FILE = "manifest.json";
const RENDER_LOG_FILE = "render-log.jsonl";

export function createVideoStore(rootDir) {
  const baseDir = path.join(rootDir, "_videos");

  function projectDir(projectId) {
    if (!projectId || typeof projectId !== "string") {
      throw new Error("store: project_id required");
    }
    if (!/^[A-Za-z0-9._-]+$/.test(projectId)) {
      throw new Error(`store: invalid project_id "${projectId}"`);
    }
    return path.join(baseDir, projectId);
  }

  async function ensureProject(projectId) {
    const dir = projectDir(projectId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async function nextId(projectId) {
    const dir = projectDir(projectId);
    await ensureProject(projectId);
    const seqPath = path.join(dir, SEQ_FILE);
    let n = 0;
    try { n = parseInt(await fs.readFile(seqPath, "utf-8"), 10) || 0; } catch {}
    n += 1;
    await fs.writeFile(seqPath, String(n), "utf-8");
    return `VID-${String(n).padStart(4, "0")}`;
  }

  async function atomicWrite(destPath, body) {
    const tmp = destPath + ".tmp." + crypto.randomBytes(4).toString("hex");
    await fs.writeFile(tmp, body, "utf-8");
    await fs.rename(tmp, destPath);
  }

  return {
    rootDir, baseDir,

    /**
     * Reserve a VID-NNNN id + render dir for a new video. The renderer writes
     * assets into `renderDir` during execution, then calls `commit(...)` with
     * the final manifest.
     *
     * @returns {Promise<{id, renderDir, subdirs: {audio, capture}, logPath}>}
     */
    async reserve(projectId) {
      const id = await nextId(projectId);
      const renderDir = path.join(projectDir(projectId), id);
      const audioDir = path.join(renderDir, "audio");
      const captureDir = path.join(renderDir, "capture");
      await fs.mkdir(audioDir, { recursive: true });
      await fs.mkdir(captureDir, { recursive: true });
      const logPath = path.join(renderDir, RENDER_LOG_FILE);
      await fs.writeFile(logPath, "", "utf-8");
      return {
        id,
        renderDir,
        subdirs: { audio: audioDir, capture: captureDir },
        logPath,
      };
    },

    /**
     * Append one render-log event. Safe to call concurrently from the
     * renderer loop — JSONL append semantics.
     */
    async appendLog(renderDir, entry) {
      const stamped = { at: nowIso(), ...entry };
      await fs.appendFile(path.join(renderDir, RENDER_LOG_FILE), JSON.stringify(stamped) + "\n", "utf-8");
    },

    /**
     * Write the final manifest. Called by the pipeline once the renderer
     * finishes (success or failure).
     */
    async commit(projectId, record) {
      const dir = projectDir(projectId);
      const renderDir = path.join(dir, record.id);
      const manifest = {
        schema_version: SCHEMA_VERSION,
        ...record,
      };
      await atomicWrite(path.join(renderDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
      return manifest;
    },

    async readManifest(projectId, id) {
      const dir = projectDir(projectId);
      const manifestPath = path.join(dir, id, MANIFEST_FILE);
      try {
        const raw = await fs.readFile(manifestPath, "utf-8");
        return JSON.parse(raw);
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },

    async readLog(projectId, id) {
      const dir = projectDir(projectId);
      const logPath = path.join(dir, id, RENDER_LOG_FILE);
      try {
        const raw = await fs.readFile(logPath, "utf-8");
        if (!raw.trim()) return [];
        return raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
    },

    /**
     * List VIDs for a project (newest-first).
     */
    async list(projectId) {
      const dir = projectDir(projectId);
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); }
      catch (err) { if (err.code === "ENOENT") return []; throw err; }
      const ids = entries.filter(e => e.isDirectory() && /^VID-\d+$/.test(e.name)).map(e => e.name);
      ids.sort((a, b) => b.localeCompare(a));
      const out = [];
      for (const id of ids) {
        const m = await this.readManifest(projectId, id);
        if (m) out.push(m);
      }
      return out;
    },

    async stats(projectId) {
      const manifests = await this.list(projectId);
      const by_status = { queued: 0, rendering: 0, done: 0, failed: 0, degraded: 0 };
      let total_cost_usd = 0;
      let total_duration_ms = 0;
      for (const m of manifests) {
        by_status[m.status] = (by_status[m.status] || 0) + 1;
        total_cost_usd += m.cost_usd || 0;
        total_duration_ms += m.duration_ms || 0;
      }
      return {
        total: manifests.length,
        by_status,
        total_cost_usd: Math.round(total_cost_usd * 1_000_000) / 1_000_000,
        total_duration_ms,
      };
    },
  };
}
