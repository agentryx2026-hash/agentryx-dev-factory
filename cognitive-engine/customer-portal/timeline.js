import fs from "node:fs/promises";
import path from "node:path";
import {
  isValidEventKind, isValidCustomerId, isValidSubmissionId, nowIso,
} from "./types.js";

/**
 * Timeline store — append-only JSONL per submission.
 *
 * D171: every status transition, every phase start/stop, every SLA signal,
 * every customer/admin note — all land as typed TimelineEvent rows.
 * Downstream dashboards read the log to render a timeline UI.
 *
 * Layout: `<root>/_customer-portal/customers/<customer_id>/timeline/<submission_id>.jsonl`
 * One file per submission. Read = readFile + JSON.parse per line.
 *
 * The append-only discipline means event order is preserved via fs.appendFile
 * semantics. No sequence numbers; `at` timestamps are sufficient at R&D scale.
 */

export function createTimelineStore(rootDir) {
  const baseDir = path.join(rootDir, "_customer-portal");

  function timelineDir(customerId) {
    if (!isValidCustomerId(customerId)) throw new Error(`invalid customer_id: ${customerId}`);
    return path.join(baseDir, "customers", customerId, "timeline");
  }

  function timelinePath(customerId, submissionId) {
    if (!isValidSubmissionId(submissionId)) throw new Error(`invalid submission_id: ${submissionId}`);
    return path.join(timelineDir(customerId), `${submissionId}.jsonl`);
  }

  async function ensureCustomerTimeline(customerId) {
    await fs.mkdir(timelineDir(customerId), { recursive: true });
  }

  return {
    rootDir, baseDir,

    /**
     * Append a TimelineEvent.
     *
     * @param {Object} event
     * @param {string} event.submission_id
     * @param {string} event.customer_id           required for per-customer isolation
     * @param {import("./types.js").TimelineEventKind} event.kind
     * @param {string} [event.phase]
     * @param {string} [event.note]
     * @param {number} [event.cost_delta_usd]
     * @param {string} [event.computed_eta_at]
     * @param {Record<string,any>} [event.meta]
     * @returns {Promise<import("./types.js").TimelineEvent>}
     */
    async append(event) {
      if (!event || typeof event !== "object") throw new Error("timeline.append: event required");
      if (!isValidCustomerId(event.customer_id)) throw new Error(`invalid customer_id: ${event.customer_id}`);
      if (!isValidSubmissionId(event.submission_id)) throw new Error(`invalid submission_id: ${event.submission_id}`);
      if (!isValidEventKind(event.kind)) throw new Error(`invalid event kind: ${event.kind}`);

      await ensureCustomerTimeline(event.customer_id);

      const stamped = {
        submission_id: event.submission_id,
        kind: event.kind,
        at: event.at || nowIso(),
      };
      if (event.phase) stamped.phase = event.phase;
      if (event.note) stamped.note = event.note;
      if (typeof event.cost_delta_usd === "number") stamped.cost_delta_usd = event.cost_delta_usd;
      if (event.computed_eta_at) stamped.computed_eta_at = event.computed_eta_at;
      if (event.meta) stamped.meta = event.meta;

      await fs.appendFile(
        timelinePath(event.customer_id, event.submission_id),
        JSON.stringify(stamped) + "\n", "utf-8",
      );

      return { customer_id: event.customer_id, ...stamped };
    },

    /**
     * Read all TimelineEvents for a submission, in chronological order.
     *
     * @param {string} customerId
     * @param {string} submissionId
     * @param {Object} [opts]
     * @param {import("./types.js").TimelineEventKind} [opts.kind]   filter by kind
     * @param {string} [opts.phase]                                  filter by phase
     * @returns {Promise<import("./types.js").TimelineEvent[]>}
     */
    async read(customerId, submissionId, { kind, phase } = {}) {
      try {
        const raw = await fs.readFile(timelinePath(customerId, submissionId), "utf-8");
        if (!raw.trim()) return [];
        let events = raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
        if (kind) {
          if (!isValidEventKind(kind)) throw new Error(`invalid event kind: ${kind}`);
          events = events.filter(e => e.kind === kind);
        }
        if (phase) events = events.filter(e => e.phase === phase);
        return events;
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
    },

    /**
     * Return the last event (for "current status" queries).
     */
    async latest(customerId, submissionId) {
      const events = await this.read(customerId, submissionId);
      return events.length ? events[events.length - 1] : null;
    },

    /**
     * Count events by kind for a submission.
     */
    async countByKind(customerId, submissionId) {
      const events = await this.read(customerId, submissionId);
      const out = {};
      for (const e of events) out[e.kind] = (out[e.kind] || 0) + 1;
      return out;
    },
  };
}
