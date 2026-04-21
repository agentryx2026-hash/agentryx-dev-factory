-- Phase 2C — llm_calls table.
--
-- Owns one row per completion (success OR failure) made through the router.
-- Cost capture is fail-open: if Postgres is down, the call still succeeds and
-- the row is logged to stderr instead. So this schema only stores rows; it
-- does NOT gate completion success.
--
-- Apply with: psql $LLM_ROUTER_DB_URL -f 001-llm-calls.sql
-- Or:        docker exec -i factory-postgres psql -U factory pixel_factory < 001-llm-calls.sql

CREATE TABLE IF NOT EXISTS llm_calls (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Attribution (all nullable — caller decides what to tag)
  project_id      TEXT,
  phase           TEXT,
  agent           TEXT,
  task_type       TEXT,

  -- Routing decision
  router_backend  TEXT,                  -- 'openrouter' | 'litellm' | 'direct-anthropic' | 'direct-gemini' | 'direct-openai'
  model_attempted JSONB,                 -- ['openrouter:opus', 'openrouter:gpt-5', 'direct-anthropic:opus']
  model_succeeded TEXT,                  -- which entry in attempted[] returned 200; null on chain-exhausted

  -- Token usage
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cost_usd        NUMERIC(10,6),         -- 6 decimals — sub-fraction-of-a-cent precision

  -- Performance
  latency_ms      INTEGER,               -- end-to-end including fallback walk

  -- Correlation hooks (Phase 13 pipeline replay reads these)
  request_id      TEXT,                  -- provider's id (Anthropic msg_id, OpenRouter id, etc.)
  langfuse_trace_id TEXT,                -- set when running inside a Langfuse trace context

  -- Failure
  error           TEXT                   -- null on success; otherwise human-readable error
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_ts        ON llm_calls (ts DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_project   ON llm_calls (project_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_agent     ON llm_calls (agent, ts DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_succeeded ON llm_calls (model_succeeded);

-- Cost roll-up convenience view — used by the Phase 2G dashboard panel.
CREATE OR REPLACE VIEW llm_cost_by_project_day AS
SELECT
  COALESCE(project_id, '<no-project>') AS project_id,
  date_trunc('day', ts)                AS day,
  COUNT(*)                             AS calls,
  SUM(COALESCE(cost_usd, 0))           AS cost_usd,
  SUM(COALESCE(input_tokens, 0))       AS input_tokens,
  SUM(COALESCE(output_tokens, 0))      AS output_tokens,
  AVG(latency_ms)                      AS avg_latency_ms
FROM llm_calls
GROUP BY 1, 2
ORDER BY day DESC, project_id;
