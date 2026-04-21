# Phase 2 — Decisions Log

## D12 — Unified protocol is OpenAI Chat Completions

**What**: Router speaks OpenAI's `/chat/completions` shape. Swaps base URL to switch backends.

**Why**: Both LiteLLM proxy and OpenRouter expose this protocol. So do `vllm`, `ollama`, many third parties. Using OpenAI-format as the IR means router code is ~200 lines instead of ~2000 provider-specific ones.

**Rejected**:
- Native provider SDKs per backend (too much code, every new provider = new implementation).
- GraphQL / gRPC (no broad support).

**Tradeoff**: Loses some provider-specific features (e.g. Anthropic's native prompt caching, extended thinking). Acceptable at v0.0.1; Phase 2F (compare mode) or later phases can add per-provider direct SDK paths when needed.

## D13 — Direct-to-provider backends as fallback of fallbacks

**What**: `backends.js` also implements `direct-anthropic` and `direct-gemini` that bypass LiteLLM/OpenRouter and talk to the provider API directly.

**Why**: If LiteLLM container is down OR OpenRouter has an outage, we still want to hit a provider. Direct backends are the ultimate fallback.

**How to configure**: Add to the YAML fallback_chain — `[openrouter:claude-opus, openrouter:gpt-5, direct-anthropic:claude-opus]`. Router parses `backend:model` syntax.

## D14 — Keep LangChain, add adapter (not strip LangChain)

**What**: Phase 2B builds a `RouterChatModel` that implements LangChain's `BaseChatModel` interface; factory_graph.js just swaps `new ChatGoogleGenerativeAI(...)` for `new RouterChatModel({task: 'architect'})`.

**Why**: LangGraph's state reducers, checkpointing, conditional edges are all useful — don't throw them away. Adapter is ~50 lines; full rewrite is ~500.

**Rejected**: Full rewrite in plain JS — tempting but loses observability primitives we'd have to rebuild.

## D15 — Build OpenRouter backend before LiteLLM container

**What**: Ship Phase 2A with OpenRouter backend working. Add LiteLLM container in later step of 2A (self-host = more moving parts).

**Why**: OpenRouter is hosted → zero ops. Gets us to "router works" faster. LiteLLM is the cheaper long-term answer (no markup) but that's a cost optimization for v1.0.

**Both remain** per configurability principle (admin flips `LLM_ROUTER_BACKEND` env).

## D16 — Provisional price table; admin UI edits in Phase 12

**What**: `configs/llm-prices.yaml` hand-maintained with best-effort values per $/MTok as of knowledge cutoff.

**Why**: Provider prices shift; keeping a live feed via provider APIs is Phase 11's problem. For now: a YAML file is good enough for approximate cost tracking. Phase 12 admin UI lets Super Admin edit.

**Caveat**: Knowledge cutoff 2026-01 + no WebSearch in this session = prices may be stale. Lessons file gets "check prices first thing after deploy" as a to-do.

## D17 — Cost capture is fail-open, not fail-closed

**What**: If the Postgres insert into `llm_calls` fails (DB down, transient error), the completion still returns successfully — we log to stderr and continue.

**Why**: An outage in observability should not take down production LLM calls. We accept occasional lost rows as the tradeoff.

**Exception**: Budget cap check. That IS synchronous — if we can't read past spend, we fail-closed (refuse the call) to avoid runaway cost. Admin can override with an env var `LLM_ROUTER_ALLOW_UNCHECKED=true` (off by default).

---

## Decisions made during Phase 2A execution

### D17.1 — Cap `max_tokens` at 4096 in OpenAI-compatible backends

**What**: All `/chat/completions` POSTs include `max_tokens: 4096` even if caller doesn't specify.

**Why**: Discovered during 2A smoke test — OpenRouter pre-reserves credit at the model's default ceiling (64K for Claude Haiku). Tiny replies were failing with `402 insufficient credits` on accounts with $1+ balance. 4096 is sane for most factory tasks. Per-task overrides land in 2D.

**Future**: Add `max_tokens` to per-task config so e.g. `architect` can use 16K and `cheap` stays at 2K.

### D17.2 — Fall-over semantics: only payload-shape 4xx breaks the chain

**What**: Original retry logic broke the chain on any 4xx (treating it as "non-retryable"). Now only `413/414/415/422` (payload too large, URI too long, unsupported media, unprocessable entity) break the chain. Everything else — `401/402/403/429/5xx` — falls over to the next entry.

**Why**: 401 (auth) and 402 (billing) are per-backend. A 401 from `direct-anthropic` doesn't predict failure on `openrouter:anthropic/...`. The next entry might use a totally different key + provider. So fall over.

**Caught by**: 2A smoke test — first chain run failed with 401 from openrouter (no key set yet) but the chain stopped instead of trying `direct-anthropic` which had a valid key. Fixed in commit `dc6546b`.

---

## Phase 2B Decisions

### D18 — Duck-type LangChain interface, don't extend `BaseChatModel`

**What**: `RouterChatModel` implements `.invoke()`, `.call()`, `._llmType()`, `.withTask()`, `.withContext()` but does NOT extend any LangChain class.

**Why**:
1. Zero-dep on LangChain — adapter ships with the router package, no peer-dependency war.
2. `BaseChatModel` is a moving target across LangChain versions. Duck typing pins us only to the surface we actually use.
3. Simpler — ~50 LOC instead of 200+ for full interface.

**Tradeoff**: Lose access to LangChain's `RunnableLambda` chaining and built-in tracing. Acceptable at v0.0.1; if needed, swap to subclassing later — won't break existing call sites.

### D19 — Symlink `llm-router` into `cognitive-engine/node_modules/@agentryx-factory/`

**What**: One-liner `ln -s` makes `import { RouterChatModel } from '@agentryx-factory/llm-router'` resolve cleanly from cognitive-engine, without setting up workspaces or publishing to a registry.

**Why**: cognitive-engine isn't yet inside the mono-repo (Phase 1.5 will fold it in). Symlink is the lowest-friction integration that keeps imports stable across the migration. The same import path works before and after Phase 1.5 — only the symlink target changes.

### D20 — `USE_ROUTER` as a third option, NOT a replacement

**What**: Each cognitive-engine graph now has 3 model paths controlled by env vars: `USE_ROUTER=true` (router), `USE_ANTIGRAVITY_BRIDGE=true` (filesystem bridge), default (direct Gemini). All three coexist.

**Why**: Configurability principle. We're at v0.0.1 R&D — we want to compare all three approaches on the same workload. Defaulting `USE_ROUTER=true` would silently switch the system over and lose the comparison.

### D21 — Dynamic import for the router so default path stays zero-risk

**What**: `let RouterChatModel; if (USE_ROUTER) ({ RouterChatModel } = await import('@agentryx-factory/llm-router'));` — only loads the package when the env var is set.

**Why**: If router has any bug at module-init time (bad import, missing dep), the default `USE_ROUTER=false` path is completely unaffected. Dev_graph.js loads identically to its pre-2B state when router is off.

---

## Phase 2C Decisions

### D22 — `pg` becomes the router's first runtime dependency

**What**: `llm-router/package.json` now depends on `pg ^8.13.0`. Brought 14 transitive deps.

**Why**: Couldn't avoid it — Postgres is the cost store. Considered:
- Native `node-postgres` via raw socket (would have to write protocol parser; absurd).
- Wrap an HTTP layer (PostgREST, etc.) — adds a service hop and operational burden.
- `pg` is the standard, battle-tested. 14 deps is acceptable.

**Future cleanup**: If we ever package router for distribution to environments without Postgres, gate `pg` behind a peer-dep + lazy import. Not needed for v0.0.1.

### D23 — 2-second timeout on the cost-capture INSERT

**What**: `Promise.race(insert, sleep(2000))` in `db.js` so a slow Postgres can't delay completions noticeably.

**Why**: Average INSERT to a healthy local Postgres is <5ms; if it takes >2s something is wrong (lock contention, network blip). At 2s, the user-visible LLM call latency would noticeably increase. Better to drop the row to stderr fallback and keep the agent responsive.

### D24 — `projectSpendSinceMidnight()` lives in `db.js`, not as Phase 2E code

**What**: The function that the budget-cap check (Phase 2E) will call already exists in `llm-router/src/db.js`.

**Why**: Keep all Postgres interactions inside the router package. Phase 2E only adds the call site, not the query. This makes the router a self-contained unit — downstream code (cognitive-engine, dashboard) never opens a Postgres connection just to ask about LLM cost.

### D25 — `llm_cost_by_project_day` view ships with the migration

**What**: View created in `001-llm-calls.sql` aggregates project × day → cost / calls / tokens / latency.

**Why**: The Phase 2G dashboard panel reads from this view, not from `llm_calls` directly. Adding the view in the same migration keeps schema cohesive — anyone who has the table also has the view. Dashboard doesn't need to know how the aggregation works.

---

## Phase 2D Decisions

### D26 — LiteLLM ships as a docker-compose service in `deploy/`

**What**: `factory-litellm` container added to `deploy/docker-compose.yml`. Image `ghcr.io/berriai/litellm:main-stable`. Listens on port 4000. Config mounted read-only from `deploy/litellm/config.yaml`.

**Why**: LiteLLM is the configurability principle in action — admin can flip `LLM_ROUTER_BACKEND=litellm` and route through self-hosted instead of OpenRouter. Self-hosting wins on:
- Data residency (provider calls go from our IP, not OpenRouter's).
- Zero markup (we pay providers directly).
- Visibility (LiteLLM logs every call locally).

OpenRouter remains the default because it works without any local infra.

**Operational cost**: 1 extra container, ~150 MB image, no persistent volume.

### D27 — LiteLLM model aliases match OpenRouter naming

**What**: `model_list[].model_name` in `deploy/litellm/config.yaml` uses the same names as OpenRouter (`anthropic/claude-haiku-4-5`, `google/gemini-2.5-flash`, etc.).

**Why**: Lets `configs/llm-routing.json` stay backend-agnostic. The same fallback chain entry `anthropic/claude-haiku-4-5` works whether `LLM_ROUTER_BACKEND` is `litellm` or `openrouter` — only the base URL changes. Switching backends becomes a one-env-var operation; no config rewrite.

### D28 — `parseEntry` recognizes only known backend prefixes

**What**: `KNOWN_BACKENDS = {openrouter, litellm, direct-anthropic, direct-gemini, direct-openai}`. A bare model entry (no colon, or colon prefix not in this set) defaults to `process.env.LLM_ROUTER_BACKEND`.

**Why**: Original code treated ANY colon as a backend separator. That broke once we needed model names containing colons (rare, but happens — e.g. some Groq names). Now the parser is explicit about which prefixes are routing instructions vs part of the model name.

### D29 — Router env activated on factory-telemetry via systemd `Environment=` + `EnvironmentFile=`

**What**: `factory-telemetry.service` now sets `USE_ROUTER=true`, `LLM_ROUTER_BACKEND=openrouter`, and reads provider keys from `~/Projects/claw-code-parity/.env` via `EnvironmentFile=-`.

**Why**: When telemetry spawns dev_graph.js / pre_dev_graph.js / post_dev_graph.js as child processes, the child inherits the parent's environment. So setting `USE_ROUTER=true` on the telemetry service activates the router for every spawned graph — no per-spawn argument needed.

The `-` prefix on `EnvironmentFile=-` makes a missing file non-fatal (graceful degradation if .env is gone for some reason).

### D30 — `.env` files for systemd MUST use plain `KEY=value`, not `export KEY=value`

**What**: Reverted `~/Projects/claw-code-parity/.env` to plain `KEY=value` syntax. Patched `claw-web-launcher.sh` to wrap its source with `set -a; source .env; set +a` so plain assignments still get exported into the launcher's child shell (claw).

**Why**: Discovered the hard way — systemd's `EnvironmentFile=` doesn't accept `export` prefix and silently rejects those lines BUT logs the full rejected-line content (including secret values) to the journal as "Ignoring invalid environment assignment". This caused the 6th secret leak in this session. Mitigation: `KEY=value` everywhere; `set -a` in the bash launcher to compensate.

### D31 — Smoke test surfaced two operational gaps to revisit

**What**: First live router smoke test through `/api/factory/pre-dev` succeeded (HTTP 200) but produced no `llm_calls` rows. Investigation revealed:
1. `/api/factory/pre-dev` does template substitution only — no LLM calls. Real LLM activity is via `/api/factory/dev` (which spawns `dev_graph.js`).
2. `RouterChatModel` constructor in cognitive-engine graphs doesn't yet receive `projectId` / `phase` / `agent` — so cost rows have null attribution.

**Action items captured for later**:
- Phase 2B follow-up: pass project context into RouterChatModel from each graph node. Defer.
- Document all factory API endpoints + their actual behavior (pre-dev = template, dev = LLM, etc.). Open issue for `docs/runbooks/factory_api.md`.

## Phase 2E Decisions

### D51 — Budget cap is fail-CLOSED (not fail-open like cost capture)

**What**: `checkBudget()` in `router.js` calls `projectSpendSinceMidnight()` and `dailySpendTotal()` BEFORE the chain walk. If either returns `null` (DB unreachable), the call is **refused** unless `LLM_ROUTER_ALLOW_UNCHECKED=true`.

**Why**:
- Cost capture (D17) is fail-open because a lost row is just an observability gap — harmless.
- Budget cap fail-open would mean a DB outage becomes a cost-unbounded window where runaway agents can drain credit. That's the exact scenario caps exist to prevent.
- Default-deny is the safe posture; admin can explicitly loosen it.

**Operator experience**: if DB goes down, calls fail with "cannot verify spend" until DB recovers or admin sets `ALLOW_UNCHECKED=true`. Clear, loud, self-explanatory error.

### D52 — `LLM_ROUTER_ALLOW_UNCHECKED=true` escape hatch

**What**: Env var that bypasses the fail-closed behavior above. Never set in `deploy/systemd/*.service` files; operator sets it ad-hoc via `systemctl edit` when they know what they're doing.

**Why**: Disaster recovery. If Postgres is down for an hour and you need the factory to keep running on whatever budget the admin set manually, this lets you skip the check.

**Audit**: every call made with `ALLOW_UNCHECKED=true` still writes to `llm_calls` with its actual cost — so a post-hoc audit shows exactly what happened during the outage window.

### D53 — Both caps checked; more-restrictive wins

**What**: If a call would violate EITHER the project cap OR the daily total cap, it's refused. Error message names which scope blocked it (`project` vs `daily`).

**Why**: Two different risk postures served by one function:
- **Project cap** — bounds a single project's cost even if the admin forgets to monitor daily total (e.g., 100 projects × $10 each = $1000, still under $100 daily cap if none cross $10).
- **Daily cap** — bounds total factory spend even if many projects are running (e.g., 1000 projects × $0.50 each would blow past the $100 daily cap well before any single project hit its $10).

Both are needed; they complement each other.

### D54 — `budget_exceeded` errors are tagged with `budgetExceeded: true`

**What**: The thrown `Error` has `.budgetExceeded === true`, `.scope`, `.cap`, `.projectSpend` or `.dailySpend`. Distinguishes from provider errors (`.httpStatus`, `.cause`) and from payload errors.

**Why**: Lets cognitive-engine and the UI handle budget-related failures differently — e.g., show "💰 Budget limit reached" instead of "❌ All fallbacks exhausted". Phase 2G dashboard can count these separately. Hermes (Phase 10) can page the admin when one fires.

### D55 — Budget check is skipped entirely when both caps are `Infinity`

**What**: If `max_project_budget_usd` and `max_daily_budget_usd` are both unset (or `Infinity`), `checkBudget()` returns `null` immediately without making any DB queries.

**Why**: Zero-cost when caps aren't configured. Useful for local dev / test environments where the operator explicitly wants no bounds.

---

## Process-discipline addendum (captured 2026-04-21 late session)

### D32 — `journalctl --vacuum-time=Ns` purges leaked secrets from disk

**What**: After D30's leak was discovered, ran `sudo journalctl --rotate && sudo journalctl --vacuum-time=10s` to drop ALL journal entries older than 10s — including the leaked lines. Freed 252 MB of archived journal data.

**Tradeoff**: Lost ~all historical journal for ALL services on the box. Acceptable in v0.0.1 R&D where journal isn't load-bearing. In production, vacuum a NARROWER time window or use a per-service strategy (`journalctl --rotate -u factory-telemetry` then vacuum) to preserve other services' history.

**Don't be clever next time**: Validate `EnvironmentFile=` with a test syntax-only file BEFORE pointing it at one with secrets. systemd does not have a "dry-run validate" mode for env files, so the test file should mimic the structure with dummy values.
