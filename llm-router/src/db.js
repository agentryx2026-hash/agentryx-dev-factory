// Postgres cost-capture sink.
//
// Phase 2C. Replaces the stderr "LLM_CALL ..." emit from router.js with a
// real INSERT. Fail-open contract: any DB error (connection refused, timeout,
// schema missing) is logged to stderr and the completion still returns
// successfully. We never block the agent on observability.

import pg from 'pg';
const { Pool } = pg;

const DEFAULT_DB_URL = 'postgres://factory:factory_dev_2026@localhost:5432/pixel_factory';

let _pool = null;
let _disabled = false;

function getPool() {
  if (_disabled) return null;
  if (_pool) return _pool;
  if (process.env.LLM_ROUTER_DB_DISABLE === 'true') {
    _disabled = true;
    return null;
  }
  const connectionString = process.env.LLM_ROUTER_DB_URL || DEFAULT_DB_URL;
  _pool = new Pool({
    connectionString,
    max: 4,                      // keep small — we burst-write, not concurrent-read-heavy
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  });
  // Attach an error handler so a transient DB blip doesn't crash the host.
  _pool.on('error', (err) => {
    process.stderr.write(`LLM_DB_POOL_ERR ${err.message}\n`);
  });
  return _pool;
}

const INSERT_SQL = `
  INSERT INTO llm_calls (
    ts, project_id, phase, agent, task_type, router_backend,
    model_attempted, model_succeeded, input_tokens, output_tokens,
    cost_usd, latency_ms, request_id, langfuse_trace_id, error
  ) VALUES (
    COALESCE($1::timestamptz, now()),
    $2, $3, $4, $5, $6,
    $7::jsonb, $8, $9, $10,
    $11, $12, $13, $14, $15
  )
  RETURNING id
`;

export async function insertCallRow(row) {
  const pool = getPool();
  if (!pool) {
    fallbackToStderr(row, 'pool disabled');
    return null;
  }
  try {
    // 2-second cap on the insert so a slow DB never delays a completion noticeably.
    const result = await Promise.race([
      pool.query(INSERT_SQL, [
        row.ts ?? null,
        row.project_id ?? null,
        row.phase ?? null,
        row.agent ?? null,
        row.task_type ?? null,
        row.router_backend ?? null,
        row.model_attempted ? JSON.stringify(row.model_attempted) : null,
        row.model_succeeded ?? null,
        row.input_tokens ?? null,
        row.output_tokens ?? null,
        row.cost_usd ?? null,
        row.latency_ms ?? null,
        row.request_id ?? null,
        row.langfuse_trace_id ?? null,
        row.error ?? null,
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('llm_calls insert timeout 2s')), 2000)),
    ]);
    return result.rows[0]?.id ?? null;
  } catch (err) {
    fallbackToStderr(row, err.message);
    return null;
  }
}

// When the DB is unreachable (or schema missing, or we're in a unit test),
// emit the row to stderr in the same shape Phase 2A used. Logs are
// post-processable, so we never lose data — just lose query convenience.
function fallbackToStderr(row, why) {
  try {
    process.stderr.write(`LLM_CALL_FALLBACK ${why} :: ${JSON.stringify(row)}\n`);
  } catch { /* don't even try if stderr is closed */ }
}

// Useful for clean shutdown in long-lived hosts (telemetry service, future
// router-as-service). Not called by the router itself; consumers can opt in.
export async function closePool() {
  if (_pool) {
    const p = _pool;
    _pool = null;
    await p.end().catch(() => {});
  }
}

// Phase 2E reads from these. Keeps budget logic inside the router package.
// Fail-closed contract: on DB error return `null`, caller treats that as
// "cannot verify spend, refuse the call" unless admin set
// LLM_ROUTER_ALLOW_UNCHECKED=true.

export async function projectSpendSinceMidnight(projectId) {
  const pool = getPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS spend_usd
         FROM llm_calls
        WHERE project_id = $1
          AND ts >= date_trunc('day', now())`,
      [projectId]
    );
    return rows[0]?.spend_usd ?? 0;
  } catch (err) {
    process.stderr.write(`LLM_DB_QUERY_ERR projectSpendSinceMidnight ${err.message}\n`);
    return null;
  }
}

export async function dailySpendTotal() {
  const pool = getPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(cost_usd), 0)::float8 AS spend_usd
         FROM llm_calls
        WHERE ts >= date_trunc('day', now())`
    );
    return rows[0]?.spend_usd ?? 0;
  } catch (err) {
    process.stderr.write(`LLM_DB_QUERY_ERR dailySpendTotal ${err.message}\n`);
    return null;
  }
}

// ─── Phase 2G: cost panel queries ───────────────────────────────────────
// These are read-only, called by the admin HTTP API. Not security-sensitive
// beyond what auth enforces at the nginx layer.

export async function costSummary({ includeCompare = false } = {}) {
  const pool = getPool();
  if (!pool) throw new Error('DB unreachable');
  const exclude = includeCompare ? '' : "AND (project_id IS NULL OR project_id != '__compare__')";
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN ts >= date_trunc('day',   now()) THEN cost_usd END), 0)::float8 AS today_usd,
       COALESCE(SUM(CASE WHEN ts >= date_trunc('week',  now()) THEN cost_usd END), 0)::float8 AS week_usd,
       COALESCE(SUM(CASE WHEN ts >= date_trunc('month', now()) THEN cost_usd END), 0)::float8 AS month_usd,
       COUNT(*) FILTER (WHERE ts >= date_trunc('day', now())) AS calls_today,
       COUNT(*) FILTER (WHERE ts >= date_trunc('day', now()) AND error LIKE 'budget_exceeded%') AS budget_refusals_today
     FROM llm_calls
     WHERE 1=1 ${exclude}`
  );
  return rows[0];
}

export async function costByProjectDay({ includeCompare = false, days = 30 } = {}) {
  const pool = getPool();
  if (!pool) throw new Error('DB unreachable');
  const exclude = includeCompare ? '' : "AND (project_id IS NULL OR project_id != '__compare__')";
  const { rows } = await pool.query(
    `SELECT
       COALESCE(project_id, '<no-project>') AS project_id,
       date_trunc('day', ts)                AS day,
       COUNT(*)                              AS calls,
       COALESCE(SUM(cost_usd), 0)::float8    AS cost_usd,
       COALESCE(SUM(input_tokens), 0)        AS input_tokens,
       COALESCE(SUM(output_tokens), 0)       AS output_tokens,
       ROUND(AVG(latency_ms))::int           AS avg_latency_ms,
       COUNT(*) FILTER (WHERE error IS NOT NULL) AS errors
     FROM llm_calls
     WHERE ts >= now() - make_interval(days => $1)
       ${exclude}
     GROUP BY project_id, day
     ORDER BY day DESC, cost_usd DESC`,
    [days]
  );
  return rows;
}

export async function costByModelToday({ includeCompare = false } = {}) {
  const pool = getPool();
  if (!pool) throw new Error('DB unreachable');
  const exclude = includeCompare ? '' : "AND (project_id IS NULL OR project_id != '__compare__')";
  const { rows } = await pool.query(
    `SELECT
       model_succeeded AS model,
       COUNT(*) AS calls,
       COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd,
       COALESCE(SUM(input_tokens), 0)     AS input_tokens,
       COALESCE(SUM(output_tokens), 0)    AS output_tokens
     FROM llm_calls
     WHERE ts >= date_trunc('day', now())
       AND model_succeeded IS NOT NULL
       ${exclude}
     GROUP BY model_succeeded
     ORDER BY cost_usd DESC`
  );
  return rows;
}
