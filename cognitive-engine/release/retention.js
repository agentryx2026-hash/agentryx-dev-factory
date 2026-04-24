import fs from "node:fs/promises";
import path from "node:path";
import {
  DATA_CLASSES, DEFAULT_RETENTION_POLICIES,
  isValidDataClass, nowIso,
} from "./types.js";

/**
 * Retention engine — TTL policies per data class.
 *
 * D175: engine is dry-run-first. `dryRun()` enumerates candidates with
 * sizes; `apply({confirmed: true})` purges and writes an audit trail to
 * `_release/retention-audit.jsonl`. Without `confirmed: true`, apply()
 * refuses.
 *
 * Policies describe which dirs to walk and the `max_age_days` threshold.
 * The engine walks the filesystem, computes each file's age from its
 * mtime, and candidates anything older than the policy threshold.
 *
 * A "tenant_id" is extracted from the path when the directory structure
 * includes a `CUST-NNNN` / `customers/CUST-NNNN` segment; this lets
 * compliance reports attribute purges.
 */

const AUDIT_FILE = "retention-audit.jsonl";

function extractTenantId(relPath) {
  // Support both flat (customers/CUST-0042/...) and direct (CUST-0042/...) layouts.
  const m = relPath.match(/(?:^|\/)(CUST-\d+)(?:\/|$)/);
  return m ? m[1] : null;
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
      } catch { /* raced with deletion; skip */ }
    }
  }
  return out;
}

export function createRetentionEngine({ policies = DEFAULT_RETENTION_POLICIES, now = () => Date.now() } = {}) {
  const policiesById = new Map();
  for (const p of policies) {
    if (!isValidDataClass(p.data_class)) throw new Error(`invalid data_class: ${p.data_class}`);
    if (typeof p.max_age_days !== "number" || p.max_age_days < 0) {
      throw new Error(`invalid max_age_days for ${p.data_class}: ${p.max_age_days}`);
    }
    if (!Array.isArray(p.storage_dirs) || p.storage_dirs.length === 0) {
      throw new Error(`storage_dirs required for ${p.data_class}`);
    }
    policiesById.set(p.data_class, { ...p });
  }

  async function collectCandidates(rootDir) {
    const nowMs = now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const candidates = [];

    for (const policy of policiesById.values()) {
      for (const dir of policy.storage_dirs) {
        const absDir = path.join(rootDir, dir);
        const files = await walkFiles(absDir);
        for (const f of files) {
          const ageDays = (nowMs - f.mtime.getTime()) / MS_PER_DAY;
          if (ageDays < policy.max_age_days) continue;
          const relPath = path.relative(rootDir, f.full);
          candidates.push({
            data_class: policy.data_class,
            rel_path: relPath,
            age_days: Math.round(ageDays * 100) / 100,
            size_bytes: f.size,
            tenant_id: extractTenantId(relPath) || undefined,
          });
        }
      }
    }
    return candidates;
  }

  async function appendAudit(rootDir, entry) {
    const auditDir = path.join(rootDir, "_release");
    await fs.mkdir(auditDir, { recursive: true });
    await fs.appendFile(path.join(auditDir, AUDIT_FILE), JSON.stringify({ at: nowIso(), ...entry }) + "\n", "utf-8");
  }

  return {
    /**
     * Enumerate retention candidates without deleting anything.
     *
     * @returns {Promise<import("./types.js").RetentionResult>}
     */
    async dryRun(rootDir) {
      const candidates = await collectCandidates(rootDir);
      return {
        dry_run: true,
        candidate_count: candidates.length,
        purged_count: 0,
        total_bytes_freed: 0,
        candidates,
        computed_at: nowIso(),
      };
    },

    /**
     * Purge candidates older than policy threshold. Requires `confirmed: true`.
     *
     * @param {string} rootDir
     * @param {Object} [opts]
     * @param {boolean} [opts.confirmed=false]
     * @param {import("./types.js").DataClass} [opts.only_data_class]  scope to one class
     * @returns {Promise<import("./types.js").RetentionResult>}
     */
    async apply(rootDir, { confirmed = false, only_data_class } = {}) {
      if (!confirmed) {
        const err = new Error("retention.apply: { confirmed: true } required to purge");
        err.code = "CONFIRMATION_REQUIRED";
        throw err;
      }

      let candidates = await collectCandidates(rootDir);
      if (only_data_class) {
        if (!isValidDataClass(only_data_class)) throw new Error(`invalid data_class: ${only_data_class}`);
        candidates = candidates.filter(c => c.data_class === only_data_class);
      }

      const errors = [];
      let purged = 0;
      let bytes = 0;

      for (const c of candidates) {
        const abs = path.join(rootDir, c.rel_path);
        const policy = policiesById.get(c.data_class);
        if (policy?.dry_run_only) {
          errors.push(`${c.rel_path}: policy dry_run_only; skipped`);
          continue;
        }
        try {
          await fs.unlink(abs);
          purged += 1;
          bytes += c.size_bytes;
        } catch (err) {
          errors.push(`${c.rel_path}: ${err.message}`);
        }
      }

      await appendAudit(rootDir, {
        action: "retention_apply",
        candidate_count: candidates.length,
        purged_count: purged,
        total_bytes_freed: bytes,
        only_data_class: only_data_class || null,
        error_count: errors.length,
      });

      return {
        dry_run: false,
        candidate_count: candidates.length,
        purged_count: purged,
        total_bytes_freed: bytes,
        candidates,
        errors: errors.length ? errors : undefined,
        computed_at: nowIso(),
      };
    },

    /**
     * Return the currently configured policy set (for admin UI inspection).
     */
    listPolicies() {
      return [...policiesById.values()].map(p => ({ ...p }));
    },

    /**
     * Read the audit log (newest-first).
     */
    async readAudit(rootDir, { limit = 100 } = {}) {
      const p = path.join(rootDir, "_release", AUDIT_FILE);
      try {
        const raw = await fs.readFile(p, "utf-8");
        if (!raw.trim()) return [];
        const rows = raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
        return rows.slice(-limit).reverse();
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
    },
  };
}
