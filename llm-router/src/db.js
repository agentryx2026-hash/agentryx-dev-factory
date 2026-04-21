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

// Phase 2E reads from this. Keep it here so the budget logic stays inside the
// router package and downstream code never talks to Postgres directly.
export async function projectSpendSinceMidnight(projectId) {
  const pool = getPool();
  if (!pool) return null; // fail-open: missing DB → no cap enforced
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
