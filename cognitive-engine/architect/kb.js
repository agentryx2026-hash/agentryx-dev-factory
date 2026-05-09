import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  SCHEMA_VERSION, PRIORITY_AREAS,
  isValidTargetStatus, isValidGapStatus, isValidFindingKind, isValidPriorityArea,
  validateStandingOrders, applyBaselineDefaults, nowIso,
} from "./types.js";

/**
 * Knowledge Base store for the Master Architect.
 *
 * Layout under `<workspace_root>/_kb/`:
 *   standing_orders.json             founder-edited (Tab 1 baseline + Tab 2 custom_direction)
 *   standing_orders_history.jsonl    append-only history of version bumps
 *   targets.jsonl                    monitored external tools/products
 *   gaps.jsonl                       needs without tools yet
 *   findings.jsonl                   append-only research observations
 *   passes.jsonl                     research-pass log
 *   roadmap_snapshot.json            derived from D.Roadmap; refreshed each pass
 *   _seq                             monotonic counter for T-/G-/F-/RP- ids
 *
 * D195: append-only JSONL for Targets/Gaps/Findings/Passes; mutating updates
 * use replay-the-log semantics (kb.updateTarget appends; readers fold latest).
 */

const KB_DIR = "_kb";
const STANDING_ORDERS_FILE = "standing_orders.json";
const STANDING_ORDERS_HISTORY_FILE = "standing_orders_history.jsonl";
const TARGETS_FILE = "targets.jsonl";
const GAPS_FILE = "gaps.jsonl";
const FINDINGS_FILE = "findings.jsonl";
const PASSES_FILE = "passes.jsonl";
const ROADMAP_SNAPSHOT_FILE = "roadmap_snapshot.json";
const SEQ_FILE = "_seq";

async function atomicWriteJSON(destPath, obj) {
  const tmp = destPath + ".tmp." + crypto.randomBytes(4).toString("hex");
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, destPath);
}

async function readJSONL(p) {
  try {
    const raw = await fs.readFile(p, "utf-8");
    if (!raw.trim()) return [];
    return raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
  } catch (err) { if (err.code === "ENOENT") return []; throw err; }
}

export function createKnowledgeBase(rootDir) {
  const baseDir = path.join(rootDir, KB_DIR);

  async function ensureDir() {
    await fs.mkdir(baseDir, { recursive: true });
  }

  async function nextSeq(prefix) {
    await ensureDir();
    const seqPath = path.join(baseDir, SEQ_FILE);
    let counters = {};
    try { counters = JSON.parse(await fs.readFile(seqPath, "utf-8")); } catch {}
    counters[prefix] = (counters[prefix] || 0) + 1;
    await atomicWriteJSON(seqPath, counters);
    return `${prefix}-${String(counters[prefix]).padStart(4, "0")}`;
  }

  return {
    rootDir, baseDir,

    // -------------------------------------------------------------------
    // Standing Orders (Tab 1 baseline + Tab 2 custom_direction)
    // -------------------------------------------------------------------
    async writeStandingOrders(standingOrders) {
      const errs = validateStandingOrders(standingOrders);
      if (errs.length) throw new Error("invalid standing_orders: " + errs.join("; "));
      await ensureDir();
      const out = {
        schema_version: SCHEMA_VERSION,
        ...standingOrders,
        baseline: applyBaselineDefaults(standingOrders.baseline || {}),
        recorded_at: nowIso(),
      };
      await atomicWriteJSON(path.join(baseDir, STANDING_ORDERS_FILE), out);
      await fs.appendFile(
        path.join(baseDir, STANDING_ORDERS_HISTORY_FILE),
        JSON.stringify({
          at: out.recorded_at,
          version: out.version,
          horizon_label: out.custom_direction?.effective_period?.horizon_label || null,
          summary: out.notes || null,
        }) + "\n",
        "utf-8",
      );
      return out;
    },

    async readStandingOrders() {
      try {
        const raw = await fs.readFile(path.join(baseDir, STANDING_ORDERS_FILE), "utf-8");
        return JSON.parse(raw);
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },

    /**
     * Convenience: read just the baseline section (with defaults applied).
     * Returns DEFAULT_BASELINE if Standing Orders haven't been written yet.
     */
    async readBaseline() {
      const so = await this.readStandingOrders();
      return applyBaselineDefaults(so?.baseline || {});
    },

    /**
     * Convenience: read just the custom_direction section. Returns null if
     * Standing Orders haven't been written yet.
     */
    async readCustomDirection() {
      const so = await this.readStandingOrders();
      return so?.custom_direction || null;
    },

    async readStandingOrdersHistory({ limit = 50 } = {}) {
      const all = await readJSONL(path.join(baseDir, STANDING_ORDERS_HISTORY_FILE));
      return all.slice(-limit).reverse();
    },

    // -------------------------------------------------------------------
    // Targets
    // -------------------------------------------------------------------
    async addTarget(input) {
      if (!input?.name) throw new Error("kb.addTarget: name required");
      if (!input.category) throw new Error("kb.addTarget: category required");
      if (input.priority_area && !isValidPriorityArea(input.priority_area)) {
        throw new Error(`kb.addTarget: invalid priority_area ${input.priority_area}`);
      }
      const status = input.status || "identified";
      if (!isValidTargetStatus(status)) throw new Error(`kb.addTarget: invalid status ${status}`);
      await ensureDir();
      const id = await nextSeq("T");
      const now = nowIso();
      const record = {
        id,
        name: input.name,
        category: input.category,
        status,
        priority_area: input.priority_area,
        url: input.url,
        notes: input.notes,
        created_at: now,
        updated_at: now,
      };
      await fs.appendFile(path.join(baseDir, TARGETS_FILE), JSON.stringify(record) + "\n", "utf-8");
      return record;
    },

    async listTargets({ priority_area, status } = {}) {
      const all = await readJSONL(path.join(baseDir, TARGETS_FILE));
      const byId = new Map();
      for (const r of all) byId.set(r.id, { ...byId.get(r.id), ...r });
      let out = [...byId.values()];
      if (priority_area) out = out.filter(r => r.priority_area === priority_area);
      if (status) out = out.filter(r => r.status === status);
      return out;
    },

    async updateTarget(id, patch) {
      const existing = (await this.listTargets()).find(r => r.id === id);
      if (!existing) throw new Error(`kb.updateTarget: ${id} not found`);
      if (patch.status && !isValidTargetStatus(patch.status)) {
        throw new Error(`kb.updateTarget: invalid status ${patch.status}`);
      }
      if (patch.priority_area && !isValidPriorityArea(patch.priority_area)) {
        throw new Error(`kb.updateTarget: invalid priority_area ${patch.priority_area}`);
      }
      const updated = { ...existing, ...patch, updated_at: nowIso() };
      await fs.appendFile(path.join(baseDir, TARGETS_FILE), JSON.stringify(updated) + "\n", "utf-8");
      return updated;
    },

    // -------------------------------------------------------------------
    // Gaps
    // -------------------------------------------------------------------
    async addGap(input) {
      if (!input?.description) throw new Error("kb.addGap: description required");
      if (input.priority_area && !isValidPriorityArea(input.priority_area)) {
        throw new Error(`kb.addGap: invalid priority_area ${input.priority_area}`);
      }
      const status = input.status || "open";
      if (!isValidGapStatus(status)) throw new Error(`kb.addGap: invalid status ${status}`);
      await ensureDir();
      const id = await nextSeq("G");
      const record = {
        id,
        description: input.description,
        priority_area: input.priority_area,
        status,
        created_at: nowIso(),
        notes: input.notes,
      };
      await fs.appendFile(path.join(baseDir, GAPS_FILE), JSON.stringify(record) + "\n", "utf-8");
      return record;
    },

    async listGaps({ priority_area, status } = {}) {
      const all = await readJSONL(path.join(baseDir, GAPS_FILE));
      const byId = new Map();
      for (const r of all) byId.set(r.id, { ...byId.get(r.id), ...r });
      let out = [...byId.values()];
      if (priority_area) out = out.filter(r => r.priority_area === priority_area);
      if (status) out = out.filter(r => r.status === status);
      return out;
    },

    async resolveGap(id, resolved_by) {
      const existing = (await this.listGaps()).find(r => r.id === id);
      if (!existing) throw new Error(`kb.resolveGap: ${id} not found`);
      const updated = { ...existing, status: "resolved", resolved_at: nowIso(), resolved_by };
      await fs.appendFile(path.join(baseDir, GAPS_FILE), JSON.stringify(updated) + "\n", "utf-8");
      return updated;
    },

    // -------------------------------------------------------------------
    // Findings (append-only)
    // -------------------------------------------------------------------
    async appendFinding(input) {
      if (!input?.content) throw new Error("kb.appendFinding: content required");
      if (!input?.pass_id) throw new Error("kb.appendFinding: pass_id required");
      if (!isValidFindingKind(input.kind)) {
        throw new Error(`kb.appendFinding: invalid kind ${input.kind}`);
      }
      if (input.priority_area && !isValidPriorityArea(input.priority_area)) {
        throw new Error(`kb.appendFinding: invalid priority_area ${input.priority_area}`);
      }
      await ensureDir();
      const id = await nextSeq("F");
      const record = {
        id,
        pass_id: input.pass_id,
        target_id: input.target_id,
        content: input.content,
        sources: input.sources || [],
        priority_area: input.priority_area,
        kind: input.kind,
        produced_at: nowIso(),
        produced_by: input.produced_by || "researcher:unknown",
      };
      await fs.appendFile(path.join(baseDir, FINDINGS_FILE), JSON.stringify(record) + "\n", "utf-8");
      return record;
    },

    async listFindings({ pass_id, priority_area, target_id, limit = 200 } = {}) {
      const all = await readJSONL(path.join(baseDir, FINDINGS_FILE));
      let out = all;
      if (pass_id) out = out.filter(r => r.pass_id === pass_id);
      if (priority_area) out = out.filter(r => r.priority_area === priority_area);
      if (target_id) out = out.filter(r => r.target_id === target_id);
      return out.slice(-limit).reverse();
    },

    // -------------------------------------------------------------------
    // Research passes
    // -------------------------------------------------------------------
    async startPass(passKind, { budget_by_area } = {}) {
      await ensureDir();
      const id = await nextSeq("RP");
      const record = {
        id,
        pass_kind: passKind,
        started_at: nowIso(),
        status: "running",
        findings_count: 0,
        proposals_emitted: 0,
        cost_usd: 0,
        budget_by_area: budget_by_area || null,
      };
      await fs.appendFile(path.join(baseDir, PASSES_FILE), JSON.stringify(record) + "\n", "utf-8");
      return record;
    },

    async finishPass(id, { status, findings_count, proposals_emitted, cost_usd, error } = {}) {
      const existing = (await this.listPasses({ id }))[0];
      if (!existing) throw new Error(`kb.finishPass: ${id} not found`);
      const updated = {
        ...existing,
        status: status || "succeeded",
        completed_at: nowIso(),
        findings_count: findings_count ?? existing.findings_count,
        proposals_emitted: proposals_emitted ?? existing.proposals_emitted,
        cost_usd: cost_usd ?? existing.cost_usd,
        error: error || existing.error,
      };
      await fs.appendFile(path.join(baseDir, PASSES_FILE), JSON.stringify(updated) + "\n", "utf-8");
      return updated;
    },

    async listPasses({ id, status, limit = 50 } = {}) {
      const all = await readJSONL(path.join(baseDir, PASSES_FILE));
      const byId = new Map();
      for (const r of all) byId.set(r.id, { ...byId.get(r.id), ...r });
      let out = [...byId.values()];
      if (id) out = out.filter(r => r.id === id);
      if (status) out = out.filter(r => r.status === status);
      out.sort((a, b) => b.started_at.localeCompare(a.started_at));
      return out.slice(0, limit);
    },

    // -------------------------------------------------------------------
    // Roadmap snapshot
    // -------------------------------------------------------------------
    async writeRoadmapSnapshot(snapshot) {
      await ensureDir();
      const out = { ...snapshot, captured_at: nowIso() };
      await atomicWriteJSON(path.join(baseDir, ROADMAP_SNAPSHOT_FILE), out);
      return out;
    },

    async readRoadmapSnapshot() {
      try {
        const raw = await fs.readFile(path.join(baseDir, ROADMAP_SNAPSHOT_FILE), "utf-8");
        return JSON.parse(raw);
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },

    // -------------------------------------------------------------------
    // Summary / health
    // -------------------------------------------------------------------
    async summary() {
      const targets = await this.listTargets();
      const gaps = await this.listGaps();
      const findings = await readJSONL(path.join(baseDir, FINDINGS_FILE));
      const passes = await readJSONL(path.join(baseDir, PASSES_FILE));
      const standingOrders = await this.readStandingOrders();
      const findings_by_area = Object.fromEntries(PRIORITY_AREAS.map(a => [a, 0]));
      for (const f of findings) {
        if (f.priority_area && findings_by_area[f.priority_area] != null) {
          findings_by_area[f.priority_area] += 1;
        }
      }
      const lastPass = passes[passes.length - 1];
      return {
        target_count: targets.length,
        gap_count: gaps.length,
        finding_count: findings.length,
        pass_count: passes.length,
        last_pass_at: lastPass?.completed_at || lastPass?.started_at,
        last_priority_version_seen: standingOrders?.version || null,
        findings_by_area,
      };
    },
  };
}
