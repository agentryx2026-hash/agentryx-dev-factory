# Phase 2 — Status

**Phase started**: 2026-04-20
**Last updated**: 2026-04-21

## Subphase progress

| Sub | Status | Commit |
|---|---|---|
| 2A — Router facade package | ✅ COMPLETE | `dc6546b`, `54efec9` |
| 2B — LangChain adapter + cognitive-engine swap | ✅ COMPLETE | `c482248`, `50be3f2` |
| 2C — Postgres cost capture | ✅ COMPLETE | `d2a8430` |
| 2D — LiteLLM container + activate router on telemetry | ✅ COMPLETE | `19932f6` |
| 2E — Pre-call budget caps | ✅ COMPLETE | *(this commit)* |
| 2F — Compare mode CLI | ⏳ pending | — |
| 2G — Cost panel in dashboard | ⏳ pending | — |

## What's live and verified

### Code shipped
- `llm-router/` package — 4 source files, 1 migration, configs, README
- `pg ^8.13.0` installed in `llm-router/node_modules/`
- Symlink `cognitive-engine/node_modules/@agentryx-factory/llm-router` → real package
- 4 cognitive-engine graphs patched with `USE_ROUTER` env switch (snapshot in `cognitive-engine-snapshot/`)

### Database
- `llm_calls` table created in `factory-postgres` (pixel_factory database)
- 4 indexes: `ts DESC`, `project_id`, `agent`, `model_succeeded`
- View `llm_cost_by_project_day` for the Phase 2G dashboard
- Verified: 1 row from smoke test (`phase-2c-smoke` / `self-test` / Haiku via OpenRouter / $0.000044 / 1361ms)

### Tested live
- ✅ All 6 task tiers route correctly per `configs/llm-routing.json`
- ✅ Fallback chain walks 4 entries on auth/credit failures
- ✅ Both backends working: `direct-anthropic` ($0.000028) + `openrouter:anthropic/claude-haiku-4-5` ($0.000026) + `openrouter:google/gemini-2.5-flash` ($0.000001)
- ✅ Router accessible from cognitive-engine via clean import
- ✅ Default behavior preserved when `USE_ROUTER` unset (verified by loading dev_graph.js without env var)
- ✅ Cost row hits Postgres on every successful call

## Blocker resolution

| Was | Now |
|---|---|
| Anthropic key — leaked twice (Phase 2A) | Rotated; current key in `.env`, $0 balance — usable for round-trip but not real workloads |
| OpenRouter key — needed | Provided by user, working, has credit. Used for live smoke tests. |
| Provider keys generally (issue #4) | Resolved via OpenRouter aggregator. Single key, multi-provider access. |

## Up next — Phase 2D plan

### 2D-1: LiteLLM service container
- Add to `deploy/docker-compose.yml`: `litellm` service, image `ghcr.io/berriai/litellm:main`, port 4000, mounts `~/.litellm-config.yaml`.
- Initial config: passthroughs for the same providers we use via OpenRouter (Anthropic, OpenAI, Google, DeepSeek). Provider keys read from env (NOT in YAML — committable).
- Health check: `curl http://localhost:4000/health` returns `{"status":"healthy"}`.
- Volumes: persist nothing (LiteLLM is stateless).

### 2D-2: Backend switcher env
- `LLM_ROUTER_BACKEND` env var picks default backend when chain entries don't specify one (e.g. bare `claude-opus-4-7` instead of `openrouter:claude-opus-4-7`).
- Document in `configs/README.md` + `llm-router/README.md`.
- Default stays `openrouter` (works without LiteLLM running).

### 2D-3: Activate router on factory-telemetry.service
- Add `Environment=USE_ROUTER=true` to `deploy/systemd/factory-telemetry.service`.
- Add `EnvironmentFile=-/home/subhash.thakur.india/Projects/claw-code-parity/.env` so OpenRouter key is in scope.
- `systemctl daemon-reload && systemctl restart factory-telemetry`.
- Smoke test: trigger one cognitive-engine spawn, verify cost row appears in `llm_calls`.

### 2D-4: Update Phase_02_Decisions.md DURING execution
- Capture each non-obvious choice as I go (not retroactively).
- Catch up at end of every subphase, not end of full phase.

## Process discipline (added 2026-04-21 per user feedback)

Going forward in Phase 2:
1. **Before** each subphase: expand the subphase plan in this file (or a dedicated note) with the actual approach + any open questions.
2. **During**: capture decisions inline in `Phase_02_Decisions.md` (one entry per non-obvious choice).
3. **After** each subphase: update this Status file with what shipped + commit hash.
4. **At phase close**: write `Phase_02_Lessons.md` properly.

The earlier subphases (2A/2B/2C) had this done partly in commit messages; D17.1, D17.2, D18-D25 backfilled into Decisions on 2026-04-21 to close the gap.
