import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  SCHEMA_VERSION, TRAINING_KINDS, isValidKind, formatFor, nowIso,
} from "./types.js";

/**
 * Filesystem-backed training-artifact store.
 *
 * D147: Standalone under `<workspace>/_training/<project_id>/`, not fused
 * with Phase 6-A `_artifacts/`. Dual-write into the artifact store is a
 * 16-B concern; isolating keeps 16-A rollback to one directory.
 *
 * D150: Each artifact is two files:
 *   - content file  (.md or .json, depending on kind)
 *   - index entry   (one JSONL row in project-local index.jsonl)
 * Content hash (sha256) stored in the index for integrity.
 *
 * D151: Append-only. Regenerating a kind produces a new `TART-NNNN`; the
 * old entry remains. The store maintains a per-(project,kind) `latest`
 * pointer for convenient lookup (`latest.json`).
 *
 * Layout:
 *   <root>/_training/
 *     <project_id>/
 *       index.jsonl
 *       latest.json                         { "<kind>": "<TART-id>" }
 *       _seq                                monotonic id counter (per project)
 *       TART-0001-<slug>.md
 *       TART-0002-<slug>.json
 *       ...
 */

const INDEX_FILE = "index.jsonl";
const LATEST_FILE = "latest.json";
const SEQ_FILE = "_seq";

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function extFor(kind) {
  return formatFor(kind) === "json" ? "json" : "md";
}

export function createTrainingStore(rootDir) {
  const baseDir = path.join(rootDir, "_training");

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
    const indexPath = path.join(dir, INDEX_FILE);
    try { await fs.access(indexPath); }
    catch { await fs.writeFile(indexPath, "", "utf-8"); }
    return dir;
  }

  async function nextId(projectId) {
    const dir = projectDir(projectId);
    const seqPath = path.join(dir, SEQ_FILE);
    let n = 0;
    try { n = parseInt(await fs.readFile(seqPath, "utf-8"), 10) || 0; } catch {}
    n += 1;
    await fs.writeFile(seqPath, String(n), "utf-8");
    return `TART-${String(n).padStart(4, "0")}`;
  }

  async function readIndex(projectId) {
    const dir = projectDir(projectId);
    let raw;
    try { raw = await fs.readFile(path.join(dir, INDEX_FILE), "utf-8"); }
    catch (err) { if (err.code === "ENOENT") return []; throw err; }
    if (!raw.trim()) return [];
    return raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
  }

  async function readLatest(projectId) {
    const dir = projectDir(projectId);
    try {
      const raw = await fs.readFile(path.join(dir, LATEST_FILE), "utf-8");
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === "ENOENT") return {};
      throw err;
    }
  }

  async function writeLatest(projectId, data) {
    const dir = projectDir(projectId);
    const tmp = path.join(dir, LATEST_FILE + ".tmp." + crypto.randomBytes(4).toString("hex"));
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
    await fs.rename(tmp, path.join(dir, LATEST_FILE));
  }

  return {
    rootDir, baseDir,

    /**
     * Write a new training artifact for a project.
     *
     * @param {Object} input
     * @param {string} input.project_id
     * @param {import("./types.js").TrainingKind} input.kind
     * @param {string} input.title
     * @param {string|object} input.content       string → .md; object → .json
     * @param {import("./types.js").TrainingProvenance} input.produced_by
     * @param {string[]} [input.parent_ids]
     * @param {string[]} [input.tags]
     * @param {number} [input.cost_usd]
     * @param {Record<string,any>} [input.meta]
     * @returns {Promise<import("./types.js").TrainingArtifact>}
     */
    async write(input) {
      if (!input) throw new Error("store.write: input required");
      if (!isValidKind(input.kind)) throw new Error(`store.write: invalid kind ${input.kind}`);
      if (!input.title) throw new Error("store.write: title required");
      if (input.content == null) throw new Error("store.write: content required");
      if (!input.produced_by?.generator_id) {
        throw new Error("store.write: produced_by.generator_id required");
      }

      await ensureProject(input.project_id);
      const id = await nextId(input.project_id);
      const ext = extFor(input.kind);

      const format = formatFor(input.kind);
      let serialized;
      if (format === "json") {
        const obj = typeof input.content === "string"
          ? { body: input.content }
          : input.content;
        serialized = JSON.stringify(obj, null, 2) + "\n";
      } else {
        serialized = typeof input.content === "string"
          ? (input.content.endsWith("\n") ? input.content : input.content + "\n")
          : JSON.stringify(input.content, null, 2) + "\n";
      }

      const slug = slugify(input.title);
      const filename = `${id}${slug ? "-" + slug : ""}.${ext}`;
      const dir = projectDir(input.project_id);
      const contentPath = path.join(dir, filename);

      // Atomic content write
      const tmpPath = contentPath + ".tmp." + crypto.randomBytes(4).toString("hex");
      await fs.writeFile(tmpPath, serialized, "utf-8");
      await fs.rename(tmpPath, contentPath);

      const record = {
        id,
        kind: input.kind,
        schema_version: SCHEMA_VERSION,
        project_id: input.project_id,
        title: input.title,
        content_ref: filename,
        content_sha256: sha256(serialized),
        format,
        produced_by: { ...input.produced_by },
        produced_at: nowIso(),
        cost_usd: typeof input.cost_usd === "number" ? input.cost_usd : 0,
      };
      if (input.parent_ids?.length) record.parent_ids = input.parent_ids.slice();
      if (input.tags?.length) record.tags = input.tags.slice();
      if (input.meta) record.meta = { ...input.meta };

      await fs.appendFile(path.join(dir, INDEX_FILE), JSON.stringify(record) + "\n", "utf-8");

      const latest = await readLatest(input.project_id);
      latest[input.kind] = id;
      await writeLatest(input.project_id, latest);

      return record;
    },

    /**
     * Return a single record + full content.
     */
    async read(projectId, id) {
      const all = await readIndex(projectId);
      const record = all.find(r => r.id === id);
      if (!record) return null;
      const dir = projectDir(projectId);
      const raw = await fs.readFile(path.join(dir, record.content_ref), "utf-8");
      const content = record.format === "json" ? JSON.parse(raw) : raw;
      return { record, content };
    },

    /**
     * List manifest rows with optional kind filter. Returns newest-first.
     */
    async list(projectId, { kind, limit } = {}) {
      const all = await readIndex(projectId);
      let out = all;
      if (kind) {
        if (!isValidKind(kind)) throw new Error(`store.list: invalid kind ${kind}`);
        out = out.filter(r => r.kind === kind);
      }
      out = out.slice().reverse();
      return typeof limit === "number" ? out.slice(0, limit) : out;
    },

    /**
     * Read the per-(project,kind) latest pointer map.
     */
    async latest(projectId) {
      return readLatest(projectId);
    },

    /**
     * Resolve the latest record + content for a (project, kind) pair.
     */
    async readLatest(projectId, kind) {
      if (!isValidKind(kind)) throw new Error(`store.readLatest: invalid kind ${kind}`);
      const map = await readLatest(projectId);
      const id = map[kind];
      if (!id) return null;
      return this.read(projectId, id);
    },

    /**
     * Verify the on-disk content's sha256 matches the index entry.
     * Returns { ok, mismatched: [{id, expected, actual}] }.
     */
    async verify(projectId) {
      const all = await readIndex(projectId);
      const dir = projectDir(projectId);
      const mismatched = [];
      for (const rec of all) {
        const raw = await fs.readFile(path.join(dir, rec.content_ref), "utf-8");
        const actual = sha256(raw);
        if (actual !== rec.content_sha256) {
          mismatched.push({ id: rec.id, expected: rec.content_sha256, actual });
        }
      }
      return { ok: mismatched.length === 0, total: all.length, mismatched };
    },

    /**
     * Count index entries by kind (useful for smoke + UI).
     */
    async stats(projectId) {
      const all = await readIndex(projectId);
      const by_kind = Object.fromEntries(TRAINING_KINDS.map(k => [k, 0]));
      for (const rec of all) by_kind[rec.kind] = (by_kind[rec.kind] || 0) + 1;
      return { total: all.length, by_kind };
    },
  };
}
