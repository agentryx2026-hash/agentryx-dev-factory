# Phase 2 — Status

**Phase started**: 2026-04-20
**Last updated**: 2026-04-20

## In progress

**Phase 2A — Router facade package scaffolding.**

- ✅ Phase docs upgraded from sketch → active (Plan, Status, Decisions).
- ✅ GitHub issues filed: #4 (provider key inventory) + #5 (2A progress tracking).
- ⏳ Writing `llm-router/` package, `configs/*.yaml`.

## Blocked on (user input — non-blocking for 2A scaffold)

- ❌ Provider API key inventory — issue #4. At minimum need Anthropic + one other (Gemini paid or OpenRouter) for first real call.
- ❌ Budget cap confirmation — default $10/project, $100/day unless overridden.

## Up next (sequential within Phase 2)

1. 2A scaffold complete — working `complete()` function hitting ONE backend (OpenRouter chosen as simplest starting point).
2. 2B cognitive-engine refactor — wrap in LangChain-compatible `RouterChatModel` adapter.
3. 2C Postgres cost table + migration.
4. 2D YAML config wiring + backend switcher env.
5. 2E fallback chain + budget cap.
6. 2F compare mode.
7. 2G cost panel in dashboard.
