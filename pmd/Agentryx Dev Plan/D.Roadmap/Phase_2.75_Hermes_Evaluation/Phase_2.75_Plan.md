# Phase 2.75 — Hermes Agent Evaluation

**Started**: 2026-04-21
**Why inserted**: User surfaced [Nous Research's Hermes Agent](https://github.com/nousresearch/hermes-agent) — 106k stars, v0.10.0 released Apr 16, MIT-licensed, Python-primary agent framework with **persistent memory + auto-curated skills + isolated subagents + MCP support + RL-based self-improvement (Tinker-Atropos)**. It hits multiple future phases of our roadmap squarely (5, 7, 15, 18) — so evaluating BEFORE those phases means potentially dropping significant build scope.

**Critical finding during research**: Hermes's README contains `hermes claw migrate` — a migration tool from **OpenClaw**, the predecessor. OpenClaw (which is in our architecture as a gateway layer but is NOT currently running) is being deprecated by the same Nous Research team. Adopting Hermes, if the evaluation is favorable, naturally supersedes OpenClaw.

## Goals (decision-making, not shipping)

Produce a decision matrix: should Hermes be adopted for the factory, and if so for which slots?

| Slot | Current approach | Hermes candidate |
|---|---|---|
| Pipeline agents (Picard, Spock, etc.) | LangGraph JS nodes | Hermes subagents with personalities |
| Tool plane | Custom `tools.js` | MCP servers via Hermes |
| Memory layer (Phase 7) | Empty ChromaDB, planned hybrid | FTS5 + LLM summarization + Honcho (shipped in Hermes) |
| Self-improvement (Phase 15) | Undefined mechanism | Tinker-Atropos RL integration |
| External comms (Phase 10 Courier) | Undefined | Native gateways: Slack/Discord/Telegram/WhatsApp/Signal/Email |
| Marketplace (Phase 18) | Undefined | `agentskills.io` community skills |
| LLM gateway | OpenClaw (deprecated) | Hermes migration path via `hermes claw migrate` |

## Scope (INTENTIONALLY CONSTRAINED — this is evaluation, not migration)

**In scope:**
- Install Hermes on this VM in isolation (own systemd unit, own port, own directory)
- Run 3-5 representative factory tasks through BOTH runtimes (Hermes + our LangGraph)
- Side-by-side comparison: output quality, cost per task, latency, memory behavior across sessions
- Quantitative: produce a table of metrics
- Qualitative: read outputs, compare approaches, note what Hermes does that we don't

**Out of scope:**
- Rewriting cognitive-engine in Python
- Replacing Paperclip (different team — `vanductai/paperclip` — unaffected by OpenClaw deprecation)
- Adopting Hermes for production before comparison
- Running `hermes claw migrate` (we have no live OpenClaw state to migrate)

## Subphases

### 2.75-A — Install Hermes (isolated)

- [ ] Clone `nousresearch/hermes-agent` to `~/Projects/hermes-agent/` (sibling of `paperclip/`, `openclaw/`)
- [ ] Follow official install script OR wrap in Docker for better isolation — **decision: Docker** (D62)
- [ ] Run on port 4600 (next free after factory-admin:4402, litellm:4000)
- [ ] systemd unit `factory-hermes.service` (or docker-compose entry)
- [ ] Configure its LLM endpoint → our OpenRouter key (via same `.env` — DB key mgmt via Hermes can come later)
- [ ] Health check

### 2.75-B — Define benchmark tasks

Pick 3 tasks that stress different dimensions:
1. **One-shot code gen**: "Write a Node.js REST endpoint for X" — tests Torres-equivalent
2. **Multi-step architect**: "Design a queueing system for burst traffic" — tests Picard-equivalent
3. **Cross-session memory**: Task A on day 1 → come back on day 2 with Task B that references A's context — tests memory layer

### 2.75-C — Run benchmarks

Same prompts, both runtimes, same OpenRouter model tier for fair comparison. Record for each:
- Wall time
- Token cost (via Hermes config + our llm_calls table)
- Output quality (subjective — read and rate)
- Whether memory was retained (task 3 only)
- Any capabilities exhibited by one and not the other

### 2.75-D — Decision matrix

For each slot in the table above, mark: **Adopt Hermes** / **Keep current** / **Hybrid** / **Defer**.

### 2.75-E — Roadmap update

Based on the decision matrix, possibly rewrite Phase 7 / 10 / 15 / 18 plans to reflect Hermes adoption (or not). That's the ACTUAL output of this phase — not code, but clarified downstream plans.

## Success criteria

- ✅ Hermes running on VM, accessible via API
- ✅ Benchmark results table with numbers
- ✅ Decision matrix filled
- ✅ Downstream phase plans updated where needed
- ✅ Decision captured in Decisions.md with full reasoning

## Risks

| Risk | Mitigation |
|---|---|
| Hermes install breaks something on VM | Use Docker isolation. If system-install, snapshot VM first. |
| Benchmark bias (my LangGraph prompts are tuned; Hermes is default) | Run Hermes with its default personality AND with equivalent system prompt from our graphs. Report both. |
| Cost during evaluation | Use cheap-tier models (Haiku, Gemini-Flash) — no Opus. Set LLM_ROUTER_BACKEND=openrouter + tight budget cap for this phase. |
| Time sink: Hermes has 40+ tools, could explore forever | Timebox: 2 sessions max. If inconclusive, produce "more evaluation needed" decision and move on. |
