# Phase 2 — LLM Router and Cost Telemetry

**Started**: 2026-04-20
**Status**: active — 2A in progress

## Goal

Kill single-provider fragility. Every LLM call goes through a router with:
- Per-task model tier assignment (architect / worker / cheap / logic)
- Automatic fallback chain on 429/5xx
- Per-call cost capture
- Switchable router backend (LiteLLM self-hosted OR OpenRouter hosted — both available per configurability principle)

## Why Phase 2 and not Phase 3 (Genovi intake)

Phase 0 ended on a Gemini 429 that killed the whole pipeline. Building anything else on a single-provider substrate rebuilds the same fragility. Phase 2 is load-bearing — ship it first.

## Architecture

### Unified protocol: OpenAI Chat Completions shape

Both LiteLLM and OpenRouter accept **OpenAI-format** `/chat/completions` requests. So our router speaks just that one protocol and swaps the base URL:

```
LLM_ROUTER_BACKEND=openrouter  → https://openrouter.ai/api/v1
LLM_ROUTER_BACKEND=litellm     → http://localhost:4000  (self-hosted container)
```

Result: router code is ~200 lines of plain fetch(), no provider-specific SDKs.

### Package layout

```
agentryx-factory/
├── llm-router/                        ← NEW, Phase 2A
│   ├── package.json                   (@agentryx-factory/llm-router, ESM)
│   ├── README.md
│   └── src/
│       ├── index.js                   public exports
│       ├── router.js                  complete() / compare() — core routing + fallback
│       ├── backends.js                HTTP clients for litellm + openrouter + direct providers
│       ├── config.js                  loads llm-routing.yaml + llm-prices.yaml
│       ├── cost.js                    token × price → USD
│       └── db.js                      insert row into llm_calls Postgres table
└── configs/
    ├── llm-routing.yaml               per-task fallback chain
    └── llm-prices.yaml                per-model $ per million tokens
```

### Database

One new table in the `pixel_factory` Postgres DB:

```sql
CREATE TABLE llm_calls (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id    TEXT,
  phase         TEXT,
  agent         TEXT,         -- 'picard', 'spock', etc.
  task_type     TEXT,         -- 'architect', 'code', 'cheap', etc.
  router_backend TEXT,        -- 'litellm' or 'openrouter'
  model_attempted JSONB,      -- ['claude-opus-4-7', 'gpt-5']
  model_succeeded TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      NUMERIC(10,6),
  latency_ms    INTEGER,
  request_id    TEXT,         -- for langfuse correlation
  error         TEXT          -- null on success
);
CREATE INDEX idx_llm_calls_ts ON llm_calls(ts);
CREATE INDEX idx_llm_calls_project ON llm_calls(project_id);
```

## Subphases

### 2A — Router facade package (this sub, in progress)

- [ ] `llm-router/package.json` + directory skeleton
- [ ] `src/router.js` — `complete({task, messages, projectId?, phase?, agent?})` function
- [ ] `src/backends.js` — fetch-based HTTP client (OpenAI format)
- [ ] `src/config.js` — YAML loader
- [ ] `configs/llm-routing.yaml` — defaults mapping task → fallback chain
- [ ] `configs/llm-prices.yaml` — price table (best-effort values, admin UI edits in Phase 12)
- [ ] `llm-router/README.md` — usage + design

Exit criteria: `node -e "import('./llm-router/src/index.js').then(r => r.complete({task:'cheap', messages:[{role:'user',content:'hello'}]})).then(console.log)"` returns a response from a free-tier model.

### 2B — Cognitive-engine refactor

Replace `ChatGoogleGenerativeAI` instantiations in `cognitive-engine/factory_graph.js`, `dev_graph.js`, `pre_dev_graph.js`, `post_dev_graph.js` with calls to the router.

Two options:
- **(a) Replace LangChain**: rewrite nodes to call `router.complete()` directly. Simpler, loses LangChain graph primitives.
- **(b) LangChain-compatible wrapper**: make router callable via `RouterChatModel` that implements LangChain's ChatModel interface. Keeps graph topology intact.

Leaning (b) for smaller blast radius — LangGraph state reducers and conditional edges still work.

Exit criteria: factory_graph.js can run end-to-end with Gemini key removed — router falls over to Anthropic or OpenRouter.

### 2C — Postgres table + cost capture

- [ ] Migration file: `factory-dashboard/server/migrations/001-llm-calls.sql`
- [ ] `src/db.js` writes a row on every completion
- [ ] Graceful degradation: if Postgres unreachable, log to stderr and continue (do NOT block the graph)

Exit criteria: after 5 router calls, `SELECT * FROM llm_calls` shows 5 rows with costs.

### 2D — Routing config + backend switcher

- [ ] `configs/llm-routing.yaml` is the source of truth
- [ ] Env var `LLM_ROUTER_BACKEND={litellm|openrouter}` picks backend at startup
- [ ] Per-task override lets you force a specific model for debugging
- [ ] Hot reload on SIGHUP (stretch goal; initial ship requires service restart)

### 2E — Fallback chain + hard budget cap

- [ ] `complete()` iterates the fallback_chain on 429, 5xx, timeout
- [ ] Before each call, check: `SELECT SUM(cost_usd) FROM llm_calls WHERE project_id = $1 AND ts > $2` against configured cap
- [ ] On exceed: emit `budget_exceeded` event (Hermes listens in Phase 10; until then log only)

### 2F — Compare mode

Admin utility: `router.compare({task, messages, models: ['opus', 'sonnet', 'gpt-5']})` — runs in parallel, returns all outputs. Feeds Phase 1.0 model-selection decisions.

### 2G — Cost panel in dashboard

SQL-backed view. Project × agent × daily spend. Read-only — hard caps edited via env var until B7 admin module (Phase 12) lands.

## Exit criteria for Phase 2

- Same smoke test as deferred Phase 1C passes — 10 agents run end-to-end.
- If Gemini returns 429, pipeline auto-fails over to Anthropic or OpenRouter.
- `llm_calls` table populates with real costs per run.
- Both `litellm` and `openrouter` backends pass a health-check call.
- A `compare` call returns outputs from 3 models side-by-side.

## Provider keys needed

Tracked in [issue #4](https://github.com/agentryx2026-hash/agentryx-factory/issues/4). Minimum viable set: Anthropic + one other (Gemini paid OR OpenRouter). Additional providers are candles on the cake.

## Open architecture questions (defer resolution)

1. **Langfuse correlation**: router should emit a `request_id` that ties to Langfuse traces. Depends on how cognitive-engine creates trace spans. Defer to 2B.
2. **Streaming**: the first version does non-streaming `/chat/completions`. LangChain nodes that expect streaming may need adapter work. Flag at 2B if encountered.
3. **Tool use / function calling**: cognitive-engine currently uses custom tools via `tools.js`. Router should pass `tools` payload through untouched. Test in 2B.
4. **MCP integration**: deferred to Phase 5. Not a Phase 2 concern.
