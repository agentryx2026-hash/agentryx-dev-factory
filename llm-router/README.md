# @agentryx-factory/llm-router

Provider-agnostic LLM router for the Agentryx Dev Factory.

**Status**: v0.0.1 — Phase 2A scaffold. Basic `complete()` works against Anthropic + OpenRouter. LiteLLM backend + Postgres cost capture land in 2C–2D.

## Design in one paragraph

Every LLM call in the factory goes through `router.complete({task, messages})`. The router looks up `task` in `configs/llm-routing.json`, gets a **fallback chain** like `['openrouter:claude-opus-4-7', 'openrouter:gpt-5', 'direct-anthropic:claude-opus-4-7']`, and tries each model in order on 429/5xx/timeout. Cost is captured per call; budget caps are enforced before each call. Both LiteLLM and OpenRouter are supported as pluggable HTTP backends — they speak the same OpenAI `/chat/completions` format, so the router is a thin fetch() wrapper.

## Why this exists

Phase 0 ended on a Gemini 429 that killed the whole agent pipeline. Phase 2 makes that impossible — the router auto-fails over.

## Public API

```js
import { complete, compare, health } from '@agentryx-factory/llm-router';

// Basic completion, picks model from task config
const msg = await complete({
  task: 'architect',                                 // looked up in configs/llm-routing.json
  messages: [
    { role: 'system', content: 'You are an architect.' },
    { role: 'user',   content: 'Design a queueing system for burst traffic.' }
  ],
  projectId: 'proj-123',                             // optional, for cost attribution
  phase: 'pre-dev',
  agent: 'picard',
});
console.log(msg.content);

// Compare multiple models in parallel on the same prompt (admin debug tool)
const results = await compare({
  messages: [...],
  models: ['claude-opus-4-7', 'gpt-5', 'gemini-2.5-pro'],
});
// results = [{model, content, latency_ms, cost_usd}, ...]

// Health check — confirms each configured backend is reachable
const hc = await health();
// { openrouter: 'ok', litellm: 'skipped', 'direct-anthropic': 'ok' }
```

## Backend selection

Environment variable `LLM_ROUTER_BACKEND`:

| Value | Upstream |
|---|---|
| `openrouter` (default) | `https://openrouter.ai/api/v1` |
| `litellm` | `http://localhost:4000` (self-hosted container; added in later subphase) |
| `direct` | Provider native APIs (Anthropic, Google, OpenAI) with their own SDKs |

The fallback chain can mix backends per entry: `openrouter:claude-opus-4-7,direct-anthropic:claude-opus-4-7` falls over from OpenRouter to Anthropic-direct if OpenRouter is down.

## Provider keys

Read from environment:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-v1-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AI...
DEEPSEEK_API_KEY=...
```

Never hard-code in `llm-routing.json`. The admin UI (Phase 12) will manage these in a Postgres-backed config store; until then, `.env` files.

## Configs

- `configs/llm-routing.json` — per-task fallback chain + budget defaults
- `configs/llm-prices.json` — `$ per million tokens` per model (best-effort; admin UI edits in Phase 12)

Configs live at the repo root under `configs/` so they're editable without entering this package.

## Install

No deps required for 2A scaffold. `node >= 20`.

```bash
# From repo root:
node -e "import('./llm-router/src/index.js').then(r => r.health()).then(console.log)"
```

## Roadmap within Phase 2

- [x] 2A — package scaffold + openrouter + direct-anthropic backends
- [ ] 2B — LangChain adapter so cognitive-engine graphs can swap `ChatGoogleGenerativeAI` → `RouterChatModel`
- [ ] 2C — Postgres cost capture (graceful-degrade if pg down)
- [ ] 2D — config hot reload, backend env switch
- [ ] 2E — budget caps, fallback chain battle-tested
- [ ] 2F — `compare()` mode
- [ ] 2G — cost panel read from `llm_calls`

See `pmd/Agentryx Dev Plan/D.Roadmap/Phase_02_LLM_Router/Phase_02_Plan.md` for the full story.
