/**
 * Phase 14-B remainder — per-project budget gate for queue.enqueue.
 *
 * The Phase 14-A queue accepts unlimited jobs per project. Once real
 * factory work runs through it (post-OpenRouter top-up), one runaway
 * project can dominate the daily LLM spend. This helper is the
 * pre-flight check: before the HTTP submit endpoint inserts a job,
 * it asks "would this project be over its configured cap right now?"
 * and refuses with HTTP 429 if so.
 *
 * Threshold keys consulted (any one breached → refuse):
 *   - `project:<project_id>` — per-project cap
 *   - `global`               — factory-wide cap
 *
 * `agent:*` and `model:*` thresholds are NOT consulted here — those
 * are post-call alerts (the queue doesn't yet know which agent/model
 * a job will use). Phase 15-A applier handles those alerts via its
 * own routing.
 *
 * Defaults: if no matching threshold exists, the project is implicitly
 * uncapped (returns `{ ok: true }`). This mirrors Phase 11-A's "config
 * is the policy" stance — the existence of a cost-thresholds.json entry
 * IS the policy.
 *
 * Sources: artifact-store today (USE_ARTIFACT_STORE-gated cost data).
 * When DB is wired (Phase 11-B full), `source: "merged"` will pick up
 * DB-side counts automatically — no quota-helper changes needed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRollup } from "./service.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_THRESHOLDS_PATH = path.resolve(HERE, "..", "..", "configs", "cost-thresholds.json");

/**
 * Compute the [from, to] window for a threshold's `window` field, anchored
 * to `now`. Inclusive bounds in UTC.
 */
export function windowRange(window, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  if (window === "daily") {
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);
  } else if (window === "weekly") {
    const day = start.getUTCDay(); // 0=Sun..6=Sat — use ISO week (Mon=0)
    const iso = (day + 6) % 7;
    start.setUTCDate(start.getUTCDate() - iso);
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + (6 - iso));
    end.setUTCHours(23, 59, 59, 999);
  } else if (window === "monthly") {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    end.setUTCHours(23, 59, 59, 999);
  } else if (window === "all_time") {
    start.setTime(0);
  } else {
    throw new Error(`windowRange: unknown window "${window}"`);
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * Load the thresholds config from disk. Safe to call when the file is
 * missing — returns an empty list (i.e. no caps configured).
 *
 * @param {string} [thresholdsPath]
 * @returns {import("./types.js").Threshold[]}
 */
export function loadThresholds(thresholdsPath = DEFAULT_THRESHOLDS_PATH) {
  try {
    const raw = fs.readFileSync(thresholdsPath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.thresholds) ? parsed.thresholds : [];
  } catch {
    return [];
  }
}

/**
 * Pre-flight quota check. Reads cost rollups for the project + global
 * scopes against every relevant threshold window, returns the first
 * breach found (or `{ ok: true }`).
 *
 * @param {object} args
 * @param {string} args.project_id
 * @param {string} args.workspaceRoot
 * @param {import("./types.js").Threshold[]} [args.thresholds]   defaults to loadThresholds()
 * @param {Date} [args.now]
 * @param {(filter, opts) => Promise<import("./types.js").CostRollup>} [args.getRollupFn]
 *   Injectable for tests. Defaults to cost-tracker/service.js#getRollup.
 * @returns {Promise<{ ok: true } | { ok: false, breach: {
 *   key: string, window: string, hard_cap_usd: number, current_usd: number
 * }}>}
 */
export async function checkProjectQuota({
  project_id,
  workspaceRoot,
  thresholds,
  now = new Date(),
  getRollupFn = getRollup,
} = {}) {
  if (!project_id) throw new Error("checkProjectQuota: project_id required");
  if (!workspaceRoot) throw new Error("checkProjectQuota: workspaceRoot required");

  const all = thresholds || loadThresholds();
  const projectKey = `project:${project_id}`;
  const relevant = all.filter(t => t.key === projectKey || t.key === "global");
  if (relevant.length === 0) return { ok: true };

  for (const t of relevant) {
    const { from, to } = windowRange(t.window, now);
    const filter = { from, to };
    if (t.key === projectKey) filter.project_ids = [project_id];
    const rollup = await getRollupFn(filter, { workspaceRoot, source: "artifacts" });
    const current_usd = Number(rollup.totals?.cost_usd || 0);
    if (typeof t.hard_cap_usd === "number" && current_usd >= t.hard_cap_usd) {
      return {
        ok: false,
        breach: {
          key: t.key,
          window: t.window,
          hard_cap_usd: t.hard_cap_usd,
          current_usd: Number(current_usd.toFixed(6)),
        },
      };
    }
  }
  return { ok: true };
}

export class QuotaExceededError extends Error {
  constructor(breach) {
    super(`quota exceeded: ${breach.key} ${breach.window} ($${breach.current_usd.toFixed(2)} / $${breach.hard_cap_usd.toFixed(2)})`);
    this.name = "QuotaExceededError";
    this.breach = breach;
  }
}
