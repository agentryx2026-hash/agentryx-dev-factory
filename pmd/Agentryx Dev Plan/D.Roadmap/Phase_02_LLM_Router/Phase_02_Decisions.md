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
