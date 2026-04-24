import fs from "node:fs/promises";
import path from "node:path";
import {
  PERIOD_KINDS, isValidPeriodKind, nowIso,
  startOfUtcDay, startOfUtcWeek, startOfUtcMonth,
} from "./types.js";

/**
 * Usage metering — per-tenant request_count + cost_usd + duration_ms + tokens.
 *
 * D174: keys off `customer_id` from Phase 19-A; "system" is a reserved
 * tenant id for non-tenant usage (internal jobs, admin actions).
 *
 * Layout under `<rootDir>/_release/`:
 *   metering.jsonl         append-only raw usage records (newest-last)
 *
 * Rollups are computed on-demand by reading the JSONL — no materialised
 * rollup tables at 20-A scale. 20-B can add daily-close rollup files if
 * needed (millions of records/day territory).
 */

const METERING_FILE = "metering.jsonl";

function periodStart(iso, kind) {
  if (kind === "day") return startOfUtcDay(iso);
  if (kind === "week") return startOfUtcWeek(iso);
  if (kind === "month") return startOfUtcMonth(iso);
  throw new Error(`unknown period kind: ${kind}`);
}

function periodEnd(startIso, kind) {
  const start = new Date(startIso);
  if (kind === "day") {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1)).toISOString();
  }
  if (kind === "week") {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 7)).toISOString();
  }
  if (kind === "month") {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString();
  }
  throw new Error(`unknown period kind: ${kind}`);
}

export function createUsageMeter(rootDir) {
  const baseDir = path.join(rootDir, "_release");

  async function ensureDir() {
    await fs.mkdir(baseDir, { recursive: true });
  }

  async function readAll() {
    try {
      const raw = await fs.readFile(path.join(baseDir, METERING_FILE), "utf-8");
      if (!raw.trim()) return [];
      return raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  return {
    rootDir, baseDir,

    /**
     * Record a usage event. `at` defaults to now; passing explicit `at`
     * enables backfilling / tests.
     *
     * @param {Object} input
     * @param {string} input.tenant_id
     * @param {number} [input.request_count=1]
     * @param {number} [input.cost_usd=0]
     * @param {number} [input.duration_ms=0]
     * @param {number} [input.tokens=0]
     * @param {string} [input.at]                    ISO UTC; defaults to now
     * @param {Record<string,any>} [input.meta]
     */
    async record(input) {
      if (!input?.tenant_id || typeof input.tenant_id !== "string") {
        throw new Error("metering.record: tenant_id required");
      }
      await ensureDir();
      const record = {
        tenant_id: input.tenant_id,
        request_count: Math.max(0, input.request_count ?? 1),
        cost_usd: Math.max(0, input.cost_usd ?? 0),
        duration_ms: Math.max(0, input.duration_ms ?? 0),
        tokens: Math.max(0, input.tokens ?? 0),
        at: input.at || nowIso(),
      };
      if (input.meta) record.meta = input.meta;
      await fs.appendFile(path.join(baseDir, METERING_FILE), JSON.stringify(record) + "\n", "utf-8");
      return record;
    },

    /**
     * Roll up records into a given period kind. Optionally filter by tenant.
     *
     * @param {Object} [opts]
     * @param {"day"|"week"|"month"} [opts.period_kind="day"]
     * @param {string} [opts.tenant_id]               if omitted, returns per-tenant rollups
     * @param {string} [opts.since]                   ISO UTC; include only records on/after
     * @param {string} [opts.until]                   ISO UTC; include only records strictly before
     * @returns {Promise<import("./types.js").UsageRollup[]>}
     */
    async rollup({ period_kind = "day", tenant_id, since, until } = {}) {
      if (!isValidPeriodKind(period_kind)) throw new Error(`invalid period_kind: ${period_kind}`);
      const all = await readAll();
      let filtered = all;
      if (tenant_id) filtered = filtered.filter(r => r.tenant_id === tenant_id);
      if (since) filtered = filtered.filter(r => r.at >= since);
      if (until) filtered = filtered.filter(r => r.at < until);

      // group by (tenant_id, period_start)
      const buckets = new Map();
      for (const r of filtered) {
        const pstart = periodStart(r.at, period_kind);
        const key = `${r.tenant_id}\x00${pstart}`;
        const agg = buckets.get(key) || {
          tenant_id: r.tenant_id,
          period_kind,
          period_start: pstart,
          period_end: periodEnd(pstart, period_kind),
          request_count: 0,
          cost_usd: 0,
          duration_ms: 0,
          tokens: 0,
          underlying_records: 0,
        };
        agg.request_count += r.request_count;
        agg.cost_usd += r.cost_usd;
        agg.duration_ms += r.duration_ms;
        agg.tokens += r.tokens;
        agg.underlying_records += 1;
        buckets.set(key, agg);
      }

      // round cost for readability (still preserves 6 decimal places)
      const out = [];
      for (const v of buckets.values()) {
        out.push({
          ...v,
          cost_usd: Math.round(v.cost_usd * 1_000_000) / 1_000_000,
        });
      }
      out.sort((a, b) => {
        if (a.tenant_id !== b.tenant_id) return a.tenant_id.localeCompare(b.tenant_id);
        return a.period_start.localeCompare(b.period_start);
      });
      return out;
    },

    /**
     * List all known tenant_ids in the metering log.
     */
    async listTenants() {
      const all = await readAll();
      return [...new Set(all.map(r => r.tenant_id))].sort();
    },

    /**
     * Return totals across all records (optionally scoped to a tenant).
     */
    async totals({ tenant_id } = {}) {
      const all = await readAll();
      const scope = tenant_id ? all.filter(r => r.tenant_id === tenant_id) : all;
      return {
        tenant_id: tenant_id || null,
        record_count: scope.length,
        request_count: scope.reduce((a, r) => a + r.request_count, 0),
        cost_usd: Math.round(scope.reduce((a, r) => a + r.cost_usd, 0) * 1_000_000) / 1_000_000,
        duration_ms: scope.reduce((a, r) => a + r.duration_ms, 0),
        tokens: scope.reduce((a, r) => a + r.tokens, 0),
      };
    },

    /**
     * Stream-friendly reader for test + admin tooling.
     */
    async listRaw({ tenant_id } = {}) {
      const all = await readAll();
      return tenant_id ? all.filter(r => r.tenant_id === tenant_id) : all;
    },
  };
}
