import { emptyBucket, addToBucket, roundBucket } from "./types.js";

/**
 * SQL fragments against the llm_calls table (owned by llm-router/src/db.js).
 * Callers pass their own pg.Pool (keeps cost-tracker decoupled from router's
 * connection pooling).
 *
 * Schema expected (from Phase 2C):
 *   llm_calls (id, ts, project_id, phase, agent, task_type, router_backend,
 *              model_attempted, model_succeeded, input_tokens, output_tokens,
 *              cost_usd, latency_ms, request_id, langfuse_trace_id, error)
 */

function buildWhere(filter) {
  const clauses = [];
  const params = [];
  let i = 1;

  if (filter.from) {
    clauses.push(`ts >= $${i++}::timestamptz`);
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push(`ts <= $${i++}::timestamptz`);
    params.push(filter.to);
  }
  if (filter.project_ids?.length) {
    clauses.push(`project_id = ANY($${i++})`);
    params.push(filter.project_ids);
  }
  if (filter.agents?.length) {
    clauses.push(`agent = ANY($${i++})`);
    params.push(filter.agents);
  }
  if (filter.models?.length) {
    clauses.push(`model_succeeded = ANY($${i++})`);
    params.push(filter.models);
  }
  // Exclude error rows from cost rollup (they have cost_usd=0 but still count as calls)
  clauses.push(`error IS NULL`);

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

/**
 * Build a CostRollup from the llm_calls Postgres table.
 *
 * @param {import("pg").Pool} pool
 * @param {import("./types.js").RollupFilter} [filter]
 * @returns {Promise<import("./types.js").CostRollup>}
 */
export async function rollupFromDb(pool, filter = {}) {
  if (!pool) throw new Error("rollupFromDb: pg.Pool required");
  const { where, params } = buildWhere(filter);

  const totalsQ = `
    SELECT
      COALESCE(SUM(cost_usd), 0)       AS cost_usd,
      COUNT(*)                         AS calls,
      COALESCE(SUM(input_tokens), 0)   AS tokens_in,
      COALESCE(SUM(output_tokens), 0)  AS tokens_out,
      MIN(ts)                          AS min_ts,
      MAX(ts)                          AS max_ts
    FROM llm_calls
    ${where}
  `;

  const groupQ = (col) => `
    SELECT
      ${col}                           AS key,
      COALESCE(SUM(cost_usd), 0)       AS cost_usd,
      COUNT(*)                         AS calls,
      COALESCE(SUM(input_tokens), 0)   AS tokens_in,
      COALESCE(SUM(output_tokens), 0)  AS tokens_out
    FROM llm_calls
    ${where}
    GROUP BY ${col}
  `;

  const dayQ = `
    SELECT
      to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS key,
      COALESCE(SUM(cost_usd), 0)       AS cost_usd,
      COUNT(*)                         AS calls,
      COALESCE(SUM(input_tokens), 0)   AS tokens_in,
      COALESCE(SUM(output_tokens), 0)  AS tokens_out
    FROM llm_calls
    ${where}
    GROUP BY 1
    ORDER BY 1
  `;

  const [totalsR, byProjR, byAgentR, byModelR, byDayR] = await Promise.all([
    pool.query(totalsQ, params),
    pool.query(groupQ("project_id"), params),
    pool.query(groupQ("agent"), params),
    pool.query(groupQ("model_succeeded"), params),
    pool.query(dayQ, params),
  ]);

  const t = totalsR.rows[0] || {};
  const totals = roundBucket({
    cost_usd: Number(t.cost_usd || 0),
    calls: Number(t.calls || 0),
    tokens_in: Number(t.tokens_in || 0),
    tokens_out: Number(t.tokens_out || 0),
  });

  const toMap = (rows) =>
    Object.fromEntries(
      rows.filter(r => r.key != null).map(r => [
        String(r.key),
        roundBucket({
          cost_usd: Number(r.cost_usd || 0),
          calls: Number(r.calls || 0),
          tokens_in: Number(r.tokens_in || 0),
          tokens_out: Number(r.tokens_out || 0),
        }),
      ])
    );

  return {
    period: {
      from: filter.from || (t.min_ts ? new Date(t.min_ts).toISOString() : new Date(0).toISOString()),
      to:   filter.to   || (t.max_ts ? new Date(t.max_ts).toISOString() : new Date().toISOString()),
    },
    totals,
    by_project: toMap(byProjR.rows),
    by_agent:   toMap(byAgentR.rows),
    by_model:   toMap(byModelR.rows),
    by_day:     toMap(byDayR.rows),
    source: "db",
  };
}
