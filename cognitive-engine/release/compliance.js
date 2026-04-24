import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  isValidComplianceKind, nowIso,
} from "./types.js";

/**
 * Compliance service — GDPR export / delete / audit.
 *
 * D176: every request is itself audited to `_release/compliance-audit.jsonl`.
 * D174: requests key off tenant_id = customer_id from Phase 19-A.
 *
 * export: walks all tenant data across known stores, produces a manifest
 *         (one JSON describing every file + sha256 + size). 20-B reads the
 *         manifest to produce a tarball.
 * delete: requires `confirmed: true`. Purges tenant directories across all
 *         known per-tenant stores. Writes to audit before deleting.
 * audit:  returns a dated report with counts per store for a tenant (no
 *         mutation).
 *
 * Design decision: tenant-data-discovery is DI'd. `createComplianceService`
 * accepts a `tenantDirs(rootDir, tenantId) → [{class, path}]` resolver so
 * future phases that add per-tenant storage only register their resolver
 * shape once and join the flow.
 */

const COMPLIANCE_FILE = "compliance-audit.jsonl";
const SEQ_FILE = "_seq";

/**
 * Default resolver — returns the known per-tenant directories from Phases 6-19.
 * Phases add their dirs here when their store is tenant-aware.
 */
export function defaultTenantDirs(rootDir, tenantId) {
  return [
    { data_class: "customer_portal", rel_path: path.join("_customer-portal", "customers", tenantId) },
    { data_class: "videos",          rel_path: path.join("_videos", tenantId) },
    { data_class: "training",        rel_path: path.join("_training", tenantId) },
    { data_class: "artifacts",       rel_path: path.join("_artifacts", tenantId) },
    { data_class: "memory",          rel_path: path.join("_factory-memory", "projects", tenantId) },
  ];
}

async function sha256File(p) {
  const data = await fs.readFile(p);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function walkFiles(absDir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(absDir, { withFileTypes: true }); }
  catch (err) { if (err.code === "ENOENT") return []; throw err; }
  for (const e of entries) {
    const full = path.join(absDir, e.name);
    if (e.isDirectory()) out.push(...await walkFiles(full));
    else if (e.isFile()) {
      try {
        const st = await fs.stat(full);
        out.push({ full, size: st.size, mtime: st.mtime });
      } catch { /* raced */ }
    }
  }
  return out;
}

async function rimraf(absPath) {
  try {
    await fs.rm(absPath, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function createComplianceService({ tenantDirs = defaultTenantDirs } = {}) {
  async function ensureDir(rootDir) {
    await fs.mkdir(path.join(rootDir, "_release"), { recursive: true });
  }

  async function nextRequestId(rootDir) {
    await ensureDir(rootDir);
    const seqPath = path.join(rootDir, "_release", SEQ_FILE);
    let n = 0;
    try { n = parseInt(await fs.readFile(seqPath, "utf-8"), 10) || 0; } catch {}
    n += 1;
    await fs.writeFile(seqPath, String(n), "utf-8");
    return `CREQ-${String(n).padStart(4, "0")}`;
  }

  async function appendAudit(rootDir, entry) {
    await ensureDir(rootDir);
    await fs.appendFile(
      path.join(rootDir, "_release", COMPLIANCE_FILE),
      JSON.stringify({ at: nowIso(), ...entry }) + "\n", "utf-8",
    );
  }

  async function handleExport(rootDir, request) {
    const dirs = tenantDirs(rootDir, request.tenant_id);
    const entries = [];
    for (const d of dirs) {
      const absDir = path.join(rootDir, d.rel_path);
      const files = await walkFiles(absDir);
      for (const f of files) {
        entries.push({
          data_class: d.data_class,
          rel_path: path.relative(rootDir, f.full),
          size_bytes: f.size,
          sha256: await sha256File(f.full),
          mtime: f.mtime.toISOString(),
        });
      }
    }

    const manifest = {
      schema_version: 1,
      request_id: request.id,
      tenant_id: request.tenant_id,
      exported_at: nowIso(),
      entry_count: entries.length,
      total_bytes: entries.reduce((a, e) => a + e.size_bytes, 0),
      entries,
    };

    const manifestDir = path.join(rootDir, "_release", "exports");
    await fs.mkdir(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, `${request.id}.json`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

    return {
      manifest_ref: path.relative(rootDir, manifestPath),
      summary: {
        entry_count: manifest.entry_count,
        total_bytes: manifest.total_bytes,
        data_classes: [...new Set(entries.map(e => e.data_class))].sort(),
      },
    };
  }

  async function handleDelete(rootDir, request) {
    if (!request.confirmed) {
      const err = new Error("compliance.delete: { confirmed: true } required");
      err.code = "CONFIRMATION_REQUIRED";
      throw err;
    }
    const dirs = tenantDirs(rootDir, request.tenant_id);
    const results = [];
    let totalDeleted = 0;
    let totalErrors = 0;
    for (const d of dirs) {
      const absDir = path.join(rootDir, d.rel_path);
      // Count files + size before rmraf for audit summary
      const files = await walkFiles(absDir);
      const bytes = files.reduce((a, f) => a + f.size, 0);
      const res = await rimraf(absDir);
      results.push({
        data_class: d.data_class,
        rel_path: d.rel_path,
        file_count: files.length,
        bytes,
        ok: res.ok,
        error: res.error,
      });
      if (res.ok) totalDeleted += files.length;
      else totalErrors += 1;
    }
    return {
      summary: {
        deleted_file_count: totalDeleted,
        class_results: results,
        errored_classes: totalErrors,
      },
    };
  }

  async function handleAudit(rootDir, request) {
    const dirs = tenantDirs(rootDir, request.tenant_id);
    const classes = [];
    let totalFiles = 0;
    let totalBytes = 0;
    for (const d of dirs) {
      const absDir = path.join(rootDir, d.rel_path);
      const files = await walkFiles(absDir);
      const bytes = files.reduce((a, f) => a + f.size, 0);
      classes.push({
        data_class: d.data_class,
        rel_path: d.rel_path,
        file_count: files.length,
        bytes,
      });
      totalFiles += files.length;
      totalBytes += bytes;
    }
    return {
      summary: {
        tenant_id: request.tenant_id,
        audited_at: nowIso(),
        total_files: totalFiles,
        total_bytes: totalBytes,
        classes,
      },
    };
  }

  return {
    defaultTenantDirs: (rootDir, tenantId) => tenantDirs(rootDir, tenantId),

    /**
     * Handle one compliance request end-to-end. Returns ComplianceReport.
     *
     * @param {string} rootDir
     * @param {Object} input
     * @param {import("./types.js").ComplianceRequestKind} input.kind
     * @param {string} input.tenant_id
     * @param {string} input.requested_by
     * @param {boolean} [input.confirmed]       required for "delete"
     * @param {string} [input.reason]
     * @returns {Promise<import("./types.js").ComplianceReport>}
     */
    async handleRequest(rootDir, input) {
      if (!isValidComplianceKind(input?.kind)) {
        throw new Error(`invalid compliance kind: ${input?.kind}`);
      }
      if (!input.tenant_id || typeof input.tenant_id !== "string") {
        throw new Error("compliance: tenant_id required");
      }
      if (!input.requested_by) {
        throw new Error("compliance: requested_by required");
      }

      const id = await nextRequestId(rootDir);
      const request = {
        id,
        kind: input.kind,
        tenant_id: input.tenant_id,
        requested_by: input.requested_by,
        requested_at: nowIso(),
        confirmed: input.confirmed === true,
        reason: input.reason,
      };

      await appendAudit(rootDir, { action: "received", ...request });

      const base = {
        request_id: id,
        kind: input.kind,
        tenant_id: input.tenant_id,
        produced_at: nowIso(),
      };

      try {
        let detail;
        if (input.kind === "export") detail = await handleExport(rootDir, request);
        else if (input.kind === "audit") detail = await handleAudit(rootDir, request);
        else if (input.kind === "delete") detail = await handleDelete(rootDir, request);
        else throw new Error(`unhandled kind: ${input.kind}`);

        const report = {
          ...base,
          outcome: "succeeded",
          summary: detail.summary,
          manifest_ref: detail.manifest_ref,
        };
        await appendAudit(rootDir, {
          action: "succeeded", request_id: id, kind: input.kind,
          tenant_id: input.tenant_id, summary: report.summary,
        });
        return report;
      } catch (err) {
        if (err.code === "CONFIRMATION_REQUIRED") {
          const report = { ...base, outcome: "refused", summary: { reason: err.message } };
          await appendAudit(rootDir, {
            action: "refused", request_id: id, kind: input.kind,
            tenant_id: input.tenant_id, reason: err.message,
          });
          return report;
        }
        const report = { ...base, outcome: "failed", summary: {}, error: err.message };
        await appendAudit(rootDir, {
          action: "failed", request_id: id, kind: input.kind,
          tenant_id: input.tenant_id, error: err.message,
        });
        return report;
      }
    },

    async readAudit(rootDir, { tenant_id, kind, limit = 100 } = {}) {
      const p = path.join(rootDir, "_release", COMPLIANCE_FILE);
      try {
        const raw = await fs.readFile(p, "utf-8");
        if (!raw.trim()) return [];
        let rows = raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
        if (tenant_id) rows = rows.filter(e => e.tenant_id === tenant_id);
        if (kind) rows = rows.filter(e => e.kind === kind);
        return rows.slice(-limit).reverse();
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
    },
  };
}
