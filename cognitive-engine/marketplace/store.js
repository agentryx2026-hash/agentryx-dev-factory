import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  SCHEMA_VERSION, MODULE_CATEGORIES, MODULE_STATUSES,
  isValidCategory, isValidStatus, nowIso,
} from "./types.js";

/**
 * Marketplace store — tracks installed modules + append-only audit log.
 *
 * D164: append-only JSONL audit log. State of "what is installed now" lives
 * in memory (per-category Maps); it can be reconstructed from the log at any
 * time. Disk state (`manifests.jsonl`) is the durable snapshot of currently
 * installed manifests — written atomically after every state change.
 *
 * Layout under `<workspace>/_marketplace/`:
 *   manifests.jsonl      one JSON line per currently-installed module (no manifest function refs)
 *   audit.jsonl          append-only install/uninstall/disable events
 *
 * The factory closures are NOT serialised — they live in memory. A store
 * restored from disk holds only the metadata; re-install is required to
 * bring factories back. That's the point of a marketplace: modules are
 * installable again from their catalogue entry.
 */

const MANIFESTS_FILE = "manifests.jsonl";
const AUDIT_FILE = "audit.jsonl";

export function createMarketplaceStore(rootDir) {
  const baseDir = path.join(rootDir, "_marketplace");
  const byId = new Map();                          // id → { manifest, instance }
  const byCategory = new Map();                    // category → Set<id>

  for (const c of MODULE_CATEGORIES) byCategory.set(c, new Set());

  async function ensureDir() {
    await fs.mkdir(baseDir, { recursive: true });
  }

  async function writeManifests() {
    await ensureDir();
    const lines = [...byId.values()].map(({ manifest, instance }) => JSON.stringify({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      category: manifest.category,
      capabilities: manifest.capabilities || [],
      owning_phase: manifest.owning_phase,
      description: manifest.description,
      author: manifest.author,
      dependencies: manifest.dependencies,
      config_entries: manifest.config_entries,
      feature_flag: manifest.feature_flag,
      status: instance?.status || "installed",
      metadata: instance?.metadata,
    }));
    const body = lines.join("\n") + (lines.length ? "\n" : "");
    const tmp = path.join(baseDir, MANIFESTS_FILE + ".tmp." + crypto.randomBytes(4).toString("hex"));
    await fs.writeFile(tmp, body, "utf-8");
    await fs.rename(tmp, path.join(baseDir, MANIFESTS_FILE));
  }

  async function appendAudit(event) {
    await ensureDir();
    const entry = { at: nowIso(), ...event };
    await fs.appendFile(path.join(baseDir, AUDIT_FILE), JSON.stringify(entry) + "\n", "utf-8");
    return entry;
  }

  return {
    rootDir, baseDir,

    /**
     * Record a successful install. `manifest` is the full manifest (kept in
     * memory, not serialised — the function reference stays alive). `instance`
     * is the return value of the factory.
     */
    async recordInstall(manifest, instance) {
      if (!manifest?.id) throw new Error("store.recordInstall: manifest.id required");
      if (byId.has(manifest.id)) throw new Error(`store.recordInstall: module ${manifest.id} already installed`);
      if (!isValidCategory(manifest.category)) throw new Error(`store.recordInstall: invalid category ${manifest.category}`);
      if (!instance || !isValidStatus(instance.status)) {
        throw new Error(`store.recordInstall: instance.status must be valid ModuleStatus`);
      }
      byId.set(manifest.id, { manifest, instance });
      byCategory.get(manifest.category).add(manifest.id);
      await writeManifests();
      await appendAudit({
        action: "install",
        id: manifest.id,
        category: manifest.category,
        version: manifest.version,
        status: instance.status,
        metadata: instance.metadata,
      });
    },

    /**
     * Record a failed install attempt. Kept for audit visibility but does not
     * enter the byId map (so other modules can install).
     */
    async recordFailedInstall(manifest, error) {
      await appendAudit({
        action: "install_failed",
        id: manifest?.id || "<unknown>",
        category: manifest?.category,
        version: manifest?.version,
        error: String(error?.message ?? error),
      });
    },

    async uninstall(id) {
      const entry = byId.get(id);
      if (!entry) return null;
      byId.delete(id);
      byCategory.get(entry.manifest.category).delete(id);
      await writeManifests();
      await appendAudit({
        action: "uninstall",
        id,
        category: entry.manifest.category,
        version: entry.manifest.version,
      });
      return entry;
    },

    async setStatus(id, status) {
      if (!isValidStatus(status)) throw new Error(`store.setStatus: invalid status ${status}`);
      const entry = byId.get(id);
      if (!entry) throw new Error(`store.setStatus: unknown module ${id}`);
      entry.instance = { ...entry.instance, status };
      await writeManifests();
      await appendAudit({ action: "status_change", id, status });
      return entry.instance;
    },

    /** In-memory lookup. */
    get(id) {
      const entry = byId.get(id);
      return entry ? { manifest: entry.manifest, instance: entry.instance } : null;
    },

    has(id) { return byId.has(id); },

    /**
     * List installed modules with optional filters.
     */
    list({ category, status, capability } = {}) {
      let out = [...byId.values()];
      if (category) {
        if (!isValidCategory(category)) throw new Error(`store.list: invalid category ${category}`);
        out = out.filter(e => e.manifest.category === category);
      }
      if (status) {
        if (!isValidStatus(status)) throw new Error(`store.list: invalid status ${status}`);
        out = out.filter(e => e.instance?.status === status);
      }
      if (capability) {
        out = out.filter(e => (e.manifest.capabilities || []).includes(capability));
      }
      out.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
      return out.map(e => ({ manifest: e.manifest, instance: e.instance }));
    },

    listIds(category) {
      if (!category) return [...byId.keys()].sort();
      if (!isValidCategory(category)) throw new Error(`store.listIds: invalid category ${category}`);
      return [...byCategory.get(category)].sort();
    },

    async readAudit({ id, action, limit = 200 } = {}) {
      try {
        const raw = await fs.readFile(path.join(baseDir, AUDIT_FILE), "utf-8");
        if (!raw.trim()) return [];
        let entries = raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
        if (id) entries = entries.filter(e => e.id === id);
        if (action) entries = entries.filter(e => e.action === action);
        return entries.slice(-limit).reverse();
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
    },

    stats() {
      const by_category = Object.fromEntries(MODULE_CATEGORIES.map(c => [c, 0]));
      const by_status = Object.fromEntries(MODULE_STATUSES.map(s => [s, 0]));
      for (const { manifest, instance } of byId.values()) {
        by_category[manifest.category] = (by_category[manifest.category] || 0) + 1;
        by_status[instance?.status || "installed"] = (by_status[instance?.status || "installed"] || 0) + 1;
      }
      return { total: byId.size, by_category, by_status };
    },

    /** Reset in-memory state (useful for tests; does not touch audit log on disk). */
    _reset() {
      byId.clear();
      for (const c of MODULE_CATEGORIES) byCategory.set(c, new Set());
    },

    get schema_version() { return SCHEMA_VERSION; },
  };
}
