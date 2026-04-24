import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { nowIso } from "./types.js";

/**
 * Backup service — workspace backup manifest generator.
 *
 * D178: walks `_*` prefixed dirs under the workspace, computes SHA-256 per
 * file, emits a BackupManifest with every entry + a manifest-level SHA
 * (hash of the serialised manifest body). A restore script (20-B) reads
 * the manifest and rebuilds from a tarball or object store.
 *
 * Layout under `<rootDir>/_release/backups/`:
 *   BKP-0001.json              one manifest per snapshot
 *   _seq                       counter
 *
 * 20-A produces the manifest; 20-B adds the actual tar + offsite copy.
 */

const BACKUPS_DIR = "backups";
const SEQ_FILE = "_seq";

async function sha256File(p) {
  const data = await fs.readFile(p);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function sha256String(s) {
  return crypto.createHash("sha256").update(String(s), "utf-8").digest("hex");
}

async function walkFiles(absDir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(absDir, { withFileTypes: true }); }
  catch (err) { if (err.code === "ENOENT") return []; throw err; }
  for (const e of entries) {
    const full = path.join(absDir, e.name);
    if (e.isDirectory()) {
      out.push(...await walkFiles(full));
    } else if (e.isFile()) {
      try {
        const st = await fs.stat(full);
        out.push({ full, size: st.size, mtime: st.mtime });
      } catch { /* raced */ }
    }
  }
  return out;
}

export function createBackupService({ exclude = [] } = {}) {
  // excluded dir basenames (relative to rootDir) — e.g. "_release/backups" to avoid backing up backups
  const excludeSet = new Set([...exclude, "_release/backups"]);

  async function listUnderscoreDirs(rootDir) {
    let entries;
    try { entries = await fs.readdir(rootDir, { withFileTypes: true }); }
    catch { return []; }
    return entries
      .filter(e => e.isDirectory() && e.name.startsWith("_"))
      .map(e => e.name)
      .filter(name => !excludeSet.has(name))
      .sort();
  }

  async function nextBackupId(rootDir) {
    const dir = path.join(rootDir, "_release", BACKUPS_DIR);
    await fs.mkdir(dir, { recursive: true });
    const seqPath = path.join(dir, SEQ_FILE);
    let n = 0;
    try { n = parseInt(await fs.readFile(seqPath, "utf-8"), 10) || 0; } catch {}
    n += 1;
    await fs.writeFile(seqPath, String(n), "utf-8");
    return `BKP-${String(n).padStart(4, "0")}`;
  }

  return {
    /**
     * Snapshot the current workspace state. Walks `_*` dirs, hashes every
     * file, writes a manifest. Does NOT write any tar/archive — that's 20-B.
     *
     * @param {string} rootDir
     * @returns {Promise<import("./types.js").BackupManifest>}
     */
    async snapshot(rootDir) {
      const includedDirs = await listUnderscoreDirs(rootDir);
      const id = await nextBackupId(rootDir);

      const entries = [];
      let totalBytes = 0;

      for (const dirName of includedDirs) {
        const absDir = path.join(rootDir, dirName);
        const files = await walkFiles(absDir);
        for (const f of files) {
          const rel = path.relative(rootDir, f.full);
          // Skip anything excluded by rel path (nested excludes)
          if ([...excludeSet].some(ex => rel.startsWith(ex))) continue;
          const sha = await sha256File(f.full);
          entries.push({
            rel_path: rel,
            size_bytes: f.size,
            sha256: sha,
            mtime: f.mtime.toISOString(),
          });
          totalBytes += f.size;
        }
      }

      // Newest first by mtime for readability
      entries.sort((a, b) => b.mtime.localeCompare(a.mtime));

      const manifest = {
        id,
        created_at: nowIso(),
        workspace_root: rootDir,
        included_dirs: includedDirs,
        entry_count: entries.length,
        total_bytes: totalBytes,
        entries,
      };
      // Hash of the manifest body (without the manifest_sha256 field itself)
      manifest.manifest_sha256 = sha256String(JSON.stringify({ ...manifest, manifest_sha256: undefined }));

      const manifestPath = path.join(rootDir, "_release", BACKUPS_DIR, `${id}.json`);
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
      return manifest;
    },

    /**
     * Verify a manifest against the live workspace. Returns mismatches.
     *
     * @param {string} rootDir
     * @param {import("./types.js").BackupManifest} manifest
     */
    async verify(rootDir, manifest) {
      const missing = [];
      const altered = [];
      for (const e of manifest.entries) {
        const abs = path.join(rootDir, e.rel_path);
        try {
          const actual = await sha256File(abs);
          if (actual !== e.sha256) altered.push({ rel_path: e.rel_path, expected: e.sha256, actual });
        } catch (err) {
          if (err.code === "ENOENT") missing.push(e.rel_path);
          else altered.push({ rel_path: e.rel_path, error: err.message });
        }
      }
      // Verify the manifest body hash itself
      const expectedBodyHash = manifest.manifest_sha256;
      const recomputed = sha256String(JSON.stringify({ ...manifest, manifest_sha256: undefined }));
      const manifest_body_ok = expectedBodyHash === recomputed;

      return {
        ok: missing.length === 0 && altered.length === 0 && manifest_body_ok,
        manifest_body_ok,
        checked_count: manifest.entries.length,
        missing_count: missing.length,
        altered_count: altered.length,
        missing,
        altered,
      };
    },

    /**
     * List prior backup manifests (newest-first).
     */
    async list(rootDir) {
      const dir = path.join(rootDir, "_release", BACKUPS_DIR);
      let entries;
      try { entries = await fs.readdir(dir); }
      catch (err) { if (err.code === "ENOENT") return []; throw err; }
      const manifestFiles = entries.filter(n => /^BKP-\d+\.json$/.test(n));
      manifestFiles.sort((a, b) => b.localeCompare(a));
      const out = [];
      for (const f of manifestFiles) {
        try {
          const raw = await fs.readFile(path.join(dir, f), "utf-8");
          const m = JSON.parse(raw);
          out.push({ id: m.id, created_at: m.created_at, entry_count: m.entry_count, total_bytes: m.total_bytes, included_dirs: m.included_dirs });
        } catch { /* skip */ }
      }
      return out;
    },

    async read(rootDir, id) {
      const p = path.join(rootDir, "_release", BACKUPS_DIR, `${id}.json`);
      try { return JSON.parse(await fs.readFile(p, "utf-8")); }
      catch (err) { if (err.code === "ENOENT") return null; throw err; }
    },
  };
}
