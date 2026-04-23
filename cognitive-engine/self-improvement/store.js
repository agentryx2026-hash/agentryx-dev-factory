import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  SCHEMA_VERSION, PROPOSAL_STATES, TERMINAL_STATES,
  isValidKind, isValidState, canTransition, nowIso,
} from "./types.js";

/**
 * Filesystem-backed proposal store.
 *
 * Layout under `<root>/_proposals/`:
 *   PROP-0042.json        — one file per proposal (any state)
 *   _seq                  — monotonic id counter
 *   _audit.jsonl          — append-only state-transition log (actor, from, to, at)
 *
 * D141: one-file-per-proposal (not per-state dirs like jobs). A proposal's state
 * lives inside the JSON, mutated in place via atomic write+rename. Rationale:
 * proposals move through states more slowly than jobs, and the UI wants to list
 * "all proposals regardless of state" far more often than "all queued only".
 * Single directory = single readdir. State transitions gated through `transition`
 * which validates the state machine before writing.
 *
 * D142: state machine is linear forward, with "rejected" as a bail-out from any
 * non-terminal state. Enforced in `types.js::canTransition`.
 */

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function createProposalStore(rootDir) {
  const baseDir = path.join(rootDir, "_proposals");
  const auditPath = path.join(baseDir, "_audit.jsonl");
  const seqPath = path.join(baseDir, "_seq");

  async function ensureDir() {
    await fs.mkdir(baseDir, { recursive: true });
  }

  function pathFor(id) {
    return path.join(baseDir, `${id}.json`);
  }

  async function nextId() {
    await ensureDir();
    let n = 0;
    try { n = parseInt(await fs.readFile(seqPath, "utf-8"), 10) || 0; } catch {}
    n += 1;
    await fs.writeFile(seqPath, String(n), "utf-8");
    return `PROP-${String(n).padStart(4, "0")}`;
  }

  async function atomicWrite(id, proposal) {
    const dst = pathFor(id);
    const serialized = JSON.stringify(proposal, null, 2) + "\n";
    const tmpPath = dst + ".tmp." + crypto.randomBytes(4).toString("hex");
    await fs.writeFile(tmpPath, serialized, "utf-8");
    await fs.rename(tmpPath, dst);
  }

  async function appendAudit(entry) {
    await ensureDir();
    await fs.appendFile(auditPath, JSON.stringify(entry) + "\n", "utf-8");
  }

  async function readRaw(id) {
    const raw = await fs.readFile(pathFor(id), "utf-8");
    return JSON.parse(raw);
  }

  return {
    rootDir, baseDir, auditPath,

    /**
     * Create a new proposal in "draft" state.
     * @param {Object} input
     * @param {import("./types.js").ProposalKind} input.kind
     * @param {import("./types.js").ProposalChange} input.change
     * @param {import("./types.js").ProposalRationale} input.rationale
     * @param {string} input.created_by
     * @returns {Promise<import("./types.js").Proposal>}
     */
    async create(input) {
      if (!input?.kind || !isValidKind(input.kind)) {
        throw new Error(`create: invalid kind: ${input?.kind}`);
      }
      if (!input.change?.target || input.change.to == null) {
        throw new Error("create: change.target and change.to required");
      }
      if (!input.rationale?.summary) {
        throw new Error("create: rationale.summary required");
      }
      if (!input.created_by) {
        throw new Error("create: created_by required");
      }

      const id = await nextId();
      const proposal = {
        id,
        kind: input.kind,
        state: "draft",
        schema_version: SCHEMA_VERSION,
        created_at: nowIso(),
        created_by: input.created_by,
        change: { from: input.change.from ?? "", ...input.change },
        rationale: {
          summary: input.rationale.summary,
          supporting_observations: input.rationale.supporting_observations || [],
          ...(input.rationale.meta ? { meta: input.rationale.meta } : {}),
        },
      };
      await atomicWrite(id, proposal);
      await appendAudit({
        at: proposal.created_at, actor: input.created_by, action: "create",
        target: id, from: null, to: "draft", kind: input.kind,
      });
      return proposal;
    },

    async get(id) {
      try { return await readRaw(id); }
      catch (err) { if (err.code === "ENOENT") return null; throw err; }
    },

    /**
     * List proposals. Optional filter by state or kind.
     * @param {{ state?: import("./types.js").ProposalState, kind?: import("./types.js").ProposalKind, limit?: number }} [filter]
     */
    async list(filter = {}) {
      await ensureDir();
      const files = await fs.readdir(baseDir);
      const out = [];
      for (const f of files) {
        if (!f.startsWith("PROP-") || !f.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(path.join(baseDir, f), "utf-8");
          const p = JSON.parse(raw);
          if (filter.state && p.state !== filter.state) continue;
          if (filter.kind && p.kind !== filter.kind) continue;
          out.push(p);
        } catch {}
      }
      out.sort((a, b) => a.id.localeCompare(b.id));
      return typeof filter.limit === "number" ? out.slice(0, filter.limit) : out;
    },

    /**
     * Move a proposal through its state machine. Validates the transition
     * against `canTransition` and appends an audit entry.
     *
     * @param {string} id
     * @param {import("./types.js").ProposalState} to
     * @param {Object} [ctx]
     * @param {string} ctx.actor            who initiated the transition
     * @param {Object} [ctx.patch]          additional fields to merge onto the proposal (e.g. evaluation, reviewer)
     * @param {string} [ctx.note]           human-readable note (e.g. rejection reason)
     * @returns {Promise<import("./types.js").Proposal>}
     */
    async transition(id, to, ctx = {}) {
      if (!isValidState(to)) throw new Error(`transition: invalid state: ${to}`);
      if (!ctx.actor) throw new Error("transition: ctx.actor required");

      const proposal = await readRaw(id);
      if (!canTransition(proposal.state, to)) {
        throw new Error(`transition: illegal ${proposal.state} → ${to} for ${id}`);
      }
      const from = proposal.state;
      const at = nowIso();

      proposal.state = to;
      if (ctx.patch && typeof ctx.patch === "object") {
        Object.assign(proposal, ctx.patch);
      }
      if (to === "approved" || to === "rejected") {
        proposal.reviewer = proposal.reviewer || ctx.actor;
        proposal.reviewed_at = at;
        if (ctx.note) proposal.review_note = ctx.note;
      }
      if (to === "applied") {
        proposal.applied_at = at;
      }

      await atomicWrite(id, proposal);
      await appendAudit({
        at, actor: ctx.actor, action: "transition",
        target: id, from, to,
        ...(ctx.note ? { note: ctx.note } : {}),
      });
      return proposal;
    },

    /**
     * Shorthand for the common approve/reject gate.
     * Only allowed from "ready" state (evaluation complete).
     */
    async approve(id, { reviewer, note } = {}) {
      if (!reviewer) throw new Error("approve: reviewer required");
      return this.transition(id, "approved", { actor: reviewer, note });
    },
    async reject(id, { reviewer, note } = {}) {
      if (!reviewer) throw new Error("reject: reviewer required");
      return this.transition(id, "rejected", { actor: reviewer, note });
    },

    /**
     * Read audit log (most-recent first). Optional filter by target proposal id.
     */
    async readAudit({ target, limit = 100 } = {}) {
      try {
        const raw = await fs.readFile(auditPath, "utf-8");
        if (!raw.trim()) return [];
        let entries = raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
        if (target) entries = entries.filter(e => e.target === target);
        return entries.slice(-limit).reverse();
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
    },

    async stats() {
      const all = await this.list();
      const counts = Object.fromEntries(PROPOSAL_STATES.map(s => [s, 0]));
      for (const p of all) counts[p.state] = (counts[p.state] || 0) + 1;
      return { total: all.length, by_state: counts };
    },

    isTerminal(state) { return TERMINAL_STATES.includes(state); },
  };
}
