import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  SCHEMA_VERSION, SUBMISSION_STATUSES, TERMINAL_STATUSES,
  isValidStatus, isValidCustomerId, isValidSubmissionId, isTerminal,
  canTransition, nowIso,
} from "./types.js";

/**
 * Submission store — per-customer isolated.
 *
 * Layout: `<root>/_customer-portal/customers/<customer_id>/submissions/`
 *   _seq                      per-customer monotonic counter
 *   index.jsonl               newest-last manifest of this customer's submissions
 *   SUB-0001.json             full record (one file per submission)
 *
 * D167: strict per-customer isolation — no submission ever references another
 * customer's customer_id, and all store operations require customer_id so
 * cross-tenant reads are impossible by construction.
 */

const INDEX_FILE = "index.jsonl";
const SEQ_FILE = "_seq";

async function atomicWriteJSON(destPath, data) {
  const tmp = destPath + ".tmp." + crypto.randomBytes(4).toString("hex");
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, destPath);
}

export function createSubmissionStore(rootDir) {
  const baseDir = path.join(rootDir, "_customer-portal");

  function customerDir(customerId) {
    if (!isValidCustomerId(customerId)) throw new Error(`invalid customer_id: ${customerId}`);
    return path.join(baseDir, "customers", customerId);
  }

  function submissionsDir(customerId) {
    return path.join(customerDir(customerId), "submissions");
  }

  function submissionPath(customerId, submissionId) {
    if (!isValidSubmissionId(submissionId)) throw new Error(`invalid submission_id: ${submissionId}`);
    return path.join(submissionsDir(customerId), `${submissionId}.json`);
  }

  async function ensureCustomer(customerId) {
    await fs.mkdir(submissionsDir(customerId), { recursive: true });
    const indexPath = path.join(submissionsDir(customerId), INDEX_FILE);
    try { await fs.access(indexPath); } catch { await fs.writeFile(indexPath, "", "utf-8"); }
  }

  async function nextId(customerId) {
    await ensureCustomer(customerId);
    const seqPath = path.join(submissionsDir(customerId), SEQ_FILE);
    let n = 0;
    try { n = parseInt(await fs.readFile(seqPath, "utf-8"), 10) || 0; } catch {}
    n += 1;
    await fs.writeFile(seqPath, String(n), "utf-8");
    return `SUB-${String(n).padStart(4, "0")}`;
  }

  async function readIndex(customerId) {
    await ensureCustomer(customerId);
    try {
      const raw = await fs.readFile(path.join(submissionsDir(customerId), INDEX_FILE), "utf-8");
      if (!raw.trim()) return [];
      return raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
    } catch (err) { if (err.code === "ENOENT") return []; throw err; }
  }

  async function appendIndex(customerId, entry) {
    await ensureCustomer(customerId);
    await fs.appendFile(
      path.join(submissionsDir(customerId), INDEX_FILE),
      JSON.stringify(entry) + "\n", "utf-8",
    );
  }

  async function rewriteIndex(customerId, entries) {
    await ensureCustomer(customerId);
    const lines = entries.map(e => JSON.stringify(e)).join("\n");
    await fs.writeFile(
      path.join(submissionsDir(customerId), INDEX_FILE),
      lines + (entries.length ? "\n" : ""), "utf-8",
    );
  }

  return {
    rootDir, baseDir,

    /**
     * Store a new ProjectSubmission.
     *
     * @param {Object} input
     * @param {string} input.customer_id
     * @param {string} input.project_title
     * @param {string} input.intake_payload
     * @param {number} input.budget_cap_usd
     * @param {string} input.target_delivery_at
     * @param {string[]} [input.tags]
     * @param {Record<string, any>} [input.meta]
     * @returns {Promise<import("./types.js").ProjectSubmission>}
     */
    async create(input) {
      if (!input || typeof input !== "object") throw new Error("submission.create: input required");
      if (!isValidCustomerId(input.customer_id)) throw new Error(`invalid customer_id: ${input.customer_id}`);
      if (!input.project_title) throw new Error("submission.create: project_title required");
      if (!input.intake_payload) throw new Error("submission.create: intake_payload required");
      if (typeof input.budget_cap_usd !== "number" || input.budget_cap_usd < 0) {
        throw new Error("submission.create: budget_cap_usd must be a non-negative number");
      }
      if (!input.target_delivery_at) throw new Error("submission.create: target_delivery_at required");

      const id = await nextId(input.customer_id);
      const record = {
        id,
        customer_id: input.customer_id,
        project_title: input.project_title,
        intake_payload: input.intake_payload,
        status: "submitted",
        submitted_at: nowIso(),
        budget_cap_usd: input.budget_cap_usd,
        target_delivery_at: input.target_delivery_at,
        schema_version: SCHEMA_VERSION,
      };
      if (input.tags?.length) record.tags = input.tags.slice();
      if (input.meta) record.meta = { ...input.meta };

      await atomicWriteJSON(submissionPath(input.customer_id, id), record);
      await appendIndex(input.customer_id, {
        id, project_title: record.project_title, status: record.status,
        submitted_at: record.submitted_at, target_delivery_at: record.target_delivery_at,
      });

      return record;
    },

    async get(customerId, submissionId) {
      try {
        const raw = await fs.readFile(submissionPath(customerId, submissionId), "utf-8");
        return JSON.parse(raw);
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },

    async list(customerId, { status } = {}) {
      const all = await readIndex(customerId);
      let out = all;
      if (status) {
        if (!isValidStatus(status)) throw new Error(`invalid status: ${status}`);
        out = out.filter(r => r.status === status);
      }
      // Newest-first
      return out.slice().reverse();
    },

    async countActive(customerId) {
      const all = await readIndex(customerId);
      return all.filter(r => !isTerminal(r.status)).length;
    },

    /**
     * State-machine-enforced transition. Validates via canTransition before
     * writing. Optional patch fields merge onto the record.
     */
    async transition(customerId, submissionId, to, { patch = {}, note } = {}) {
      if (!isValidStatus(to)) throw new Error(`invalid target status: ${to}`);
      const record = await this.get(customerId, submissionId);
      if (!record) throw new Error(`submission not found: ${submissionId}`);
      if (!canTransition(record.status, to)) {
        throw new Error(`illegal transition ${record.status} → ${to} for ${submissionId}`);
      }
      const updated = { ...record, ...patch, status: to };
      if (to === "accepted" && !updated.accepted_at) updated.accepted_at = nowIso();
      if (isTerminal(to) && !updated.completed_at) updated.completed_at = nowIso();
      if (note) updated.last_note = note;

      await atomicWriteJSON(submissionPath(customerId, submissionId), updated);

      // Rewrite index entry
      const entries = await readIndex(customerId);
      const patched = entries.map(e => e.id === submissionId
        ? { ...e, status: to, completed_at: updated.completed_at }
        : e);
      await rewriteIndex(customerId, patched);

      return updated;
    },

    async addCost(customerId, submissionId, costDeltaUsd) {
      if (typeof costDeltaUsd !== "number") throw new Error("addCost: number required");
      const record = await this.get(customerId, submissionId);
      if (!record) throw new Error(`submission not found: ${submissionId}`);
      const updated = {
        ...record,
        consumed_cost_usd: Math.round(((record.consumed_cost_usd || 0) + costDeltaUsd) * 1_000_000) / 1_000_000,
      };
      await atomicWriteJSON(submissionPath(customerId, submissionId), updated);
      return updated;
    },

    async stats(customerId) {
      const all = await readIndex(customerId);
      const by_status = Object.fromEntries(SUBMISSION_STATUSES.map(s => [s, 0]));
      for (const r of all) by_status[r.status] = (by_status[r.status] || 0) + 1;
      return { total: all.length, by_status };
    },
  };
}
