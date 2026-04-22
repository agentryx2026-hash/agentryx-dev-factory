/**
 * Cost tracker types — rollup shapes and filter conventions.
 */

/**
 * @typedef {Object} RollupFilter
 * @property {string} [from]             ISO 8601 UTC start (inclusive)
 * @property {string} [to]               ISO 8601 UTC end   (inclusive)
 * @property {string[]} [project_ids]
 * @property {string[]} [agents]
 * @property {string[]} [models]
 */

/**
 * @typedef {Object} CostBucket
 * @property {number} cost_usd
 * @property {number} calls
 * @property {number} [tokens_in]
 * @property {number} [tokens_out]
 * @property {number} [latency_ms_p50]
 * @property {number} [latency_ms_p95]
 */

/**
 * @typedef {Object} CostRollup
 * @property {{ from: string, to: string }} period
 * @property {CostBucket} totals
 * @property {Record<string, CostBucket>} by_project
 * @property {Record<string, CostBucket>} by_agent
 * @property {Record<string, CostBucket>} by_model
 * @property {Record<string, CostBucket>} by_day
 * @property {string} source              "artifacts" | "db" | "merged"
 */

/**
 * @typedef {Object} Threshold
 * @property {string} key                 e.g. "project:2026-04-22_todo-app" | "agent:troi" | "global"
 * @property {number} warn_usd            soft alert — log + Courier notification
 * @property {number} hard_cap_usd        pre-call router refusal (Phase 2E-style but scoped)
 * @property {"daily"|"weekly"|"monthly"|"all_time"} window
 * @property {string} [description]
 */

/**
 * @typedef {Object} ThresholdConfig
 * @property {number} schema_version
 * @property {Threshold[]} thresholds
 */

export const SCHEMA_VERSION = 1;

export const ROLLUP_SOURCES = Object.freeze(["artifacts", "db", "merged"]);

export function emptyBucket() {
  return { cost_usd: 0, calls: 0, tokens_in: 0, tokens_out: 0 };
}

export function addToBucket(bucket, delta) {
  bucket.cost_usd += delta.cost_usd || 0;
  bucket.calls += delta.calls || 1;
  if (typeof delta.tokens_in === "number") bucket.tokens_in = (bucket.tokens_in || 0) + delta.tokens_in;
  if (typeof delta.tokens_out === "number") bucket.tokens_out = (bucket.tokens_out || 0) + delta.tokens_out;
  return bucket;
}

export function roundBucket(bucket) {
  return {
    cost_usd: Number((bucket.cost_usd || 0).toFixed(6)),
    calls: bucket.calls || 0,
    tokens_in: bucket.tokens_in || 0,
    tokens_out: bucket.tokens_out || 0,
  };
}
