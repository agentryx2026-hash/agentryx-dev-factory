# 2026-05 Agent Orchestrator Landscape Scan

**Commissioned**: 2026-05-09 (after v0.0.1 A-tier 100% coverage close + ~2-week development pause)
**Researcher**: claude-opus-4-7 (1M-context) acting as Solution Architect, with delegated web research via general-purpose subagent (65+ sources, 30+ web searches, 20+ page fetches)
**Scope**: 2026 multi-agent orchestrator landscape; specifically tasked to identify what's changed during the development pause and to deep-dive on Hermes (which the founder flagged as "on fire")
**Audience**: Agentryx Dev Factory founder + future architectural reviews

---

## Executive Summary

The landscape moved fast in the few weeks of the pause. Five things to internalise:

1. **Hermes Agent is the real story.** Nous Research's Hermes Agent (the framework, distinct from the Hermes LLM family) launched Feb 25, 2026, hit 140K GitHub stars in ~10 weeks, and as of v0.13 ("Tenacity," May 7, 2026) ships a **production-grade durable multi-agent Kanban with heartbeat / zombie detection, /goal Ralph-loop, and 20 messaging platforms behind one gateway**. This is a major footprint expansion of capabilities the user previously slotted to "Courier + skills + patterns only" in Phase 2.75 D74.

2. **Spec-Driven Development became the industry standard while Agentryx was heads-down.** GitHub Spec Kit (~93K stars), AWS Kiro IDE, BMAD-METHOD, Tessl, OpenSpec all converged on the **Requirements → Design → Tasks** three-phase workflow that Agentryx already does. The factory is *aligned with* the industry, not lagging — but several of these tools now compete directly with the dev-factory thesis.

3. **The Microsoft Agent Framework 1.0 (April 3, 2026) absorbed AutoGen.** AutoGen is now in maintenance mode. Anyone considering AutoGen should re-route to MAF or stay on LangGraph. Doesn't affect Agentryx (JS-first) directly but worth knowing.

4. **MCP won as the tool plane standard.** 9,400+ MCP servers (8x growth since Q1 2025), 78% of enterprise AI teams report at least one production MCP-backed agent, every major IDE supports it. The user's MCP-first decision (Phase 5) was right.

5. **Agent Skills (SKILL.md) is now an Anthropic-stewarded open standard adopted by 32+ tools and is governed by the Agentic AI Foundation under Linux Foundation.** Distinct from Hermes' agentskills.io ecosystem (which is compatible). The user's Phase 18 plan slots in cleanly.

**Single biggest "you may have missed":** Hermes Agent v0.13 ships a durable multi-agent Kanban that is essentially a free, working prototype of what Phase 9 (multi-agent runtime) wants to build. Combined with the Hermes security audit (Issue #7826: 4 critical, 9 high) — Hermes is **capabilities-rich and safety-immature**. Treat this as the dominant signal.

**Hermes-footprint recommendation in one sentence:** **Expand from Courier + Skills + Patterns to Courier + Skills + Patterns + Memory backend (Honcho) + Multi-agent Kanban as Phase 9 reference implementation, but DO NOT replace LangGraph as primary runtime, and DO NOT use Hermes' default security posture in production.**

---

## A. Multi-Agent Orchestrator State of the Field

### Per-tool snapshot

| Framework | Status (May 2026) | Strength | Weakness for Agentryx | Verdict for Agentryx |
|---|---|---|---|---|
| **LangGraph (LC 1.0)** | GA late 2025; v1.x stable; durable execution + Postgres checkpointing in JS/TS; Klarna/Uber/LinkedIn in production; ~47M monthly downloads; April 7, 2026 JS docs refresh. | Most battle-tested; explicit graph topology; durable checkpointing; LangSmith observability. | Verbose; breaking changes between minor versions historically painful. | **Keep as primary runtime.** |
| **LangChain Deep Agents** | Released July 2025; major March 2026 update (9.9K stars in 5 hours); `deepagents deploy` single-command production deploy; NVIDIA AI-Q Blueprint partnership. | Adds *planning + filesystem + subagents + skills* on top of LangGraph — closer to Agentryx's mental model than raw LangGraph. | Newer; harness overhead. | **Strongly consider as a Phase 9 alternative to hand-built subagent orchestration on LangGraph.** |
| **Hermes Agent** | v0.13 May 7, 2026; 140K stars; durable Kanban, /goal, 20 platforms, RL stack. | Best-in-class memory (Honcho dialectic + FTS5), gateway, durable Kanban. | Default ALLOW-ALL security posture, persistent skill-poisoning vector, no signed provenance, no audit trail. | **Expand footprint as plug-in (memory + Kanban + courier), not replacement.** |
| **CrewAI + Flows** | 47.8K stars, 2B agent runs in last 12 months; 60% of US Fortune 500 use it; DocuSign case study. | Best for role-based mental model and time-to-first-prototype. | No checkpointing, coarse error handling, weak agent-to-agent comms. | **Skip.** Picard/Sisko/Troi mental model already baked in; switching costs > benefits. |
| **AutoGen** | **Maintenance mode** (Microsoft); v0.7.x stable line; AG2 community fork separate. | Good for research-style critique loops. | Microsoft now points everyone to MAF instead. | **Skip.** |
| **Microsoft Agent Framework 1.0** | **GA April 3, 2026.** Merges AutoGen + Semantic Kernel; .NET + Python; sequential/concurrent/handoff/group chat/Magentic-One patterns. | Enterprise telemetry, middleware, type safety. | .NET/Python only — not JS. Useless given Agentryx is JS. | **Skip on language fit.** |
| **OpenAI Agents SDK** | Released Mar 2025; updated April 2026 with sandbox harness + computer-use. Python-first; TypeScript still secondary. | Cleanest handoff model; native sandbox. | Locked to OpenAI provider; weaker ecosystem; less production miles than LangGraph. | **Skip as primary; watch.** |
| **Claude Agent SDK** | Strong update cadence; deepest MCP integration; managed hosting. | Best Claude-first developer ergonomics; subagents + hooks + skills built-in. | Vendor lock; single-agent depth, not multi-agent breadth. | **Useful as an *individual agent* SDK inside the LangGraph swarm — not the orchestrator.** |
| **Strands Agents (AWS)** | Open-source; AWS Bedrock + AgentCore native; semantic tool search over 6K+ tools. | Best tool-scaling story (semantic search, "96% token reduction"). | AWS-flavored; harness ergonomics tied to Bedrock. | **Skip unless you go AWS-native.** |
| **PydanticAI** | Production-grade, type-safe, FSM-backed (`pydantic-graph`). | Type safety + FSM is excellent fit for deterministic factory work. | Python-first. | **Skip on language fit; steal the type-safety pattern.** |
| **Mastra** | TS-native, batteries-included (RAG, observability, MCP, memory, evals). | **Only TS-native opinionated framework** with MCP + memory + evals. | Smaller ecosystem than LangGraph. | **Watch closely. If LangGraph JS pain ever exceeds threshold, this is the obvious migration target.** |
| **Vercel AI SDK 6** | Released 2026; 20M+ monthly downloads; Agent abstraction, ToolLoopAgent, MCP, DevTools, tool-approval. | Best TS DX; wide model coverage. | "Toolkit, not framework" — multi-agent durability still custom. | **Watch. Consider for the Verify portal's chat surface.** |
| **Letta (formerly MemGPT)** | Stateful agents with REST server. | Memory primitives. | Niche. | **Skip; use Hermes/Honcho instead.** |
| **Agno (Phidata)** | ~39K stars; "5,000× faster instantiation, 50× less memory than LangGraph" (their claim). | Performance-oriented runtime. | Marketing-heavy claims; smaller production proof. | **Skip.** |
| **DSPy** | Stable, declarative, optimizer-based. Used for *programmatic prompts*. | Best at automatic prompt optimization. | Not an orchestrator. | **Steal the pattern (signatures + optimizers) for prompt management in Phase 12 if not already.** |
| **BAML (BoundaryML)** | Schema-aligned parsing, type-safe outputs across model versions. | Best at brittle-schema-free structured outputs. | Adds a DSL. | **Strongly consider for Picard-style tool-call layer if you're tired of OpenRouter schema drift.** |

### "What changed since April 2026" callouts

- **LangChain shipped Deep Agents `deploy` command + 30 LangSmith evaluator templates + Arcade.dev's 7,500-tool integration** (April 2026 newsletter). Material for Phase 12-15.
- **MAF 1.0 GA on April 3, 2026** — only matters if Agentryx ever considered .NET/Python.
- **Hermes Agent v0.12 (Apr 30) and v0.13 (May 7)** — both shipped major durability + multi-agent capabilities.
- **AGENTS.md is now stewarded by the Linux Foundation's Agentic AI Foundation** alongside MCP and Goose; 60K+ repos use it. Worth adding an `AGENTS.md` to the dev factory output.
- **Cursor 3 launched April 2, 2026** — "agent-first IDE" treating multi-agent as primary interface; Composer 2 model trained via RL on real SWE tasks.
- **Anthropic shipped Agent Teams** (still experimental) — built-in multi-agent orchestration inside Claude Code.

---

## B. Hermes Deep Dive

The user said "Hermes is on fire" — the data confirms it, but with crucial caveats.

### The disambiguation that matters

Two distinct products under the Nous brand both called "Hermes":
- **Hermes-3 / Hermes-4** = Nous' open-weight tool-calling LLM family (e.g., Hermes 3 8B running on Ollama hits 91% tool-call accuracy local).
- **Hermes Agent** = the agent framework released Feb 25, 2026; this is what's "on fire."

Most public reviews conflate them. The framework is what's relevant to Agentryx.

### Models / framework versions

| Date | Release | Headline feature |
|---|---|---|
| Feb 25, 2026 | v0.0 launch | Self-improving + persistent memory + gateway |
| Apr 16, 2026 | v0.10.0 | Browser CDP, local Ollama path |
| Apr 23, 2026 | v0.11.0 "Interface" | React/Ink CLI rewrite, AWS Bedrock, GPT-5.5 via Codex OAuth, `/steer` |
| Apr 30, 2026 | v0.12.0 "Curator" | Autonomous skill curator, ComfyUI v5, MS Teams as plugin |
| May 7, 2026 | v0.13.0 "Tenacity" | **Multi-agent Kanban (durable, heartbeat, zombie reclaim), /goal Ralph-loop, 8 critical security fixes, 7 new languages** |

Cadence: weekly, with hundreds of merged PRs per release. This is genuinely a "live wire" project.

### Tinker — clarification

**Tinker is not a Nous product.** It's Mira Murati's Thinking Machines Lab API (announced Oct 1, 2025). Nous' RL stack uses the Tinker API as the training backend; Atropos is the Nous-built environment/rollout coordinator that talks to Tinker. So "Hermes-Tinker-Atropos" = Nous' Atropos environments running training jobs through Thinking Machines' Tinker API.

- **Tinker status:** still **private beta** with waitlist; free during beta, paid model coming.
- **Production-ready?** **No.** It's research-grade, single-tenant, no SLA.
- **Nous internal use:** Yes — DeepHermes-ToolCalling-Specialist and DeepHermes-Financial-Fundamentals-Prediction-Specialist were trained on Atropos+Tinker with reported 2.5x–4.6x task gains.

### Atropos

- v0.4.0, March 10, 2026.
- 1.2K stars, 1,606 commits, 361 forks.
- Environments cover GSM8K, MMLU, MBPP, HumanEval, Blackjack/Taxi, RLAIF/RLHF, multimodal.
- Integration cost is real: requires Tinker API key, WANDB key, Python ≥3.11, and adoption of GRPO/LoRA training paradigm. **Not a "drop-in"; expect 2-4 weeks of dedicated infra work to get a useful loop.**

### agentskills.io — careful disambiguation

There are two parallel ecosystems with similar names:

1. **Anthropic's `Agent Skills` open standard** (SKILL.md spec released Dec 18, 2025; agentskills.io is its canonical home). Adopted by 32 tools in 90 days including Claude Code, OpenAI Codex CLI, Cursor, Windsurf, Goose, Kiro, JetBrains Junie, GitHub Copilot, Mistral, ByteDance TRAE. **Now governed by Linux Foundation's Agentic AI Foundation (146 members as of Feb 2026).**
2. **Hermes Agent's own skills marketplace** (aligned with the Agent Skills standard). Hundreds of community skills 4 weeks post-launch; SkillsMP indexes 800K+ skills synced from GitHub.

The user's plan (Phase 18 marketplace using agentskills) is solid because the Anthropic-standard is the open spec — Hermes is a *consumer* of it. Bet on the standard, not on Hermes' specific catalog.

### Gateway mode — production examples

Hermes' gateway is a single background process supporting Telegram/Discord/Slack/WhatsApp/Signal/Email/Matrix/Teams/QQBot/Tencent Yuanbao/Google Chat (20 platforms in v0.13). Documented production patterns:
- **GLADIATOR project** — 9 Hermes agents in two rival "AI companies" competing on GitHub stars.
- **Auto-Build Workflow** — hierarchical multi-agent (GPT-5.4 main → MiniMax M2.7 coder → local Qwen 35B QA).
- One operator runs 12 parallel Hermes instances daily for development.
- Production deployments on $5-20/month VPS instances using OpenRouter routing — directly mirrors Agentryx's cost-conscious posture.
- Email pipeline running on DBOS/Postgres/S3, 8h/day on Claude Opus for 3+ weeks.

### Memory architecture (this is the hidden gem)

Hermes' memory stack is genuinely better-thought-out than what's in the user's current Phase 7 plan:

- `SOUL.md` — agent identity / personality (overlayable per session).
- `MEMORY.md` + `USER.md` — bounded curated facts; *agent edits these between turns*.
- **FTS5 SQLite full-text search** over every past session — non-LLM cost, fast, deterministic.
- **Honcho dialectic memory** — derives implicit user model (preferences, habits, communication style) by reasoning about conversations *after* they happen.
- **Skills as procedural memory** — `~/.hermes/skills/` accumulates as skills; the **Curator** background pass tracks usage, archives stale skills, proposes consolidations.

The user's filesystem-backed Obsidian + index.jsonl is Phase-7-D-equivalent of `MEMORY.md`+FTS5; **Honcho is what's missing**. Honcho is an open-source separable backend (`docs.honcho.dev`) that Hermes adopted but didn't build.

### Production reality check: the security findings

GitHub Issue #7826 (security audit, v0.8.0) is critical reading. Default config is **ALLOW-ALL**. Findings:

**Critical (4):**
- C1: unrestricted shell execution via terminal tool on local backend
- C2: unrestricted file reading, no deny list (SSH keys, env credentials reachable)
- C3: containerized backends *unconditionally skip approval checks*
- C4: persistent skill-poisoning vector — injection during a session writes a skill file treated as trusted context next session

**High (9):** YOLO mode, LLM-based auto-approval, write restrictions bypassed via terminal, opt-in (not opt-out) write sandboxing, arbitrary Python from hooks, unsandboxed plugin loading, regex-only skills validation, unpinned git deps, non-interactive auto-approval.

**No fix timeline.** v0.13 added "8 critical security fixes" + redaction-by-default, but the threat model (persistent skill poisoning, no signed provenance, no audit trail) is still unresolved.

For an SRS/FRS-driven enterprise dev factory, **using Hermes' security defaults is disqualifying.** Fully containerized + WRITE_SAFE_ROOT + explicit allowlists + no YOLO is mandatory.

### Recommendation (Hermes footprint)

**Expand Hermes footprint, but selectively:**

| Hermes capability | Fit for Agentryx | Verdict |
|---|---|---|
| Gateway (Phase 10 Courier) | Excellent — 20 platforms, allowlists, cron, sessions | **Keep planned adoption.** |
| Skills (Phase 18) | Excellent — agentskills.io is the open standard | **Keep planned adoption.** |
| Memory write-through pattern | Already adopted | **Keep.** |
| Self-improve trajectory collection | Pattern is sound | **Keep planned adoption for 15-B/C.** |
| **+ Honcho dialectic memory** | New — fills Phase 7 user-modeling gap cheaply | **NEW: add as Phase 7-E.** |
| **+ Multi-agent Kanban** | Solves Phase 9 durability — HEARTBEAT + RECLAIM patterns are gold | **NEW: study and steal architecture; do not run actual Hermes Kanban as your runtime.** |
| **+ Curator pattern** | Auto-grades skills, archives stale ones | **NEW: adopt for Phase 18 health.** |
| **+ /goal Ralph-loop primitive** | Goal persistence across turns — small but solid | **NEW: trivial to add to Picard.** |
| Tinker-Atropos training | Research-grade, beta, single-tenant | **Defer past v0.0.1.** |
| Hermes as primary runtime | Single-host SQLite, security posture immature | **NO — don't replace LangGraph.** |

---

## C. Gaps in Agentryx's current architecture (per-slot review)

### Slot 1 — Pipeline runtime (LangGraph JS)

**Verdict: KEEP, but expand patterns adopted.**

LangGraph is still the default for serious production multi-agent (Klarna, Uber, LinkedIn). v1.0 GA is stable. Postgres checkpointing in JS is mature. The user's choice was right and remains right.

**Quick wins:**
- Adopt `@langchain/langgraph-checkpoint-postgres` if not already used for checkpointing in Phase 9.
- Look at **LangChain Deep Agents** (`deepagents` package, July 2025 + March 2026 update) as a reference for the planning + filesystem + subagent harness pattern. The `deepagents deploy` model (single-command horizontal scale) is also a good pattern for Phase 16 deployment.
- Steal Hermes' Kanban heartbeat + zombie-reclaim pattern as the durability layer for the LangGraph swarm. This is the single biggest gap in the user's current Phase 9 plan that the field has now solved.

**Worth-watching (3-6 months):**
- **Mastra** as a TS-native fallback if LangGraph friction grows.
- **Vercel AI SDK 6 ToolLoopAgent** for the Verify portal chat surface.

### Slot 2 — LLM router (LiteLLM + OpenRouter dual backend)

**Verdict: KEEP. Field validates choice.**

This combination is the dominant pattern in 2026. LiteLLM is "the best open-source self-hosted alternative to OpenRouter" (top 2026 OpenRouter alternative ranking lists). Hermes itself uses 200+ providers via OpenRouter as the default routing layer.

**Quick wins:**
- Look at **TrueFoundry's AI Gateway** or **Bifrost** for richer telemetry-at-prompt-and-user level if budget capture becomes friction.
- Add **BAML** as a structured-output layer for Picard's tool-call schemas if OpenRouter model heterogeneity causes parse failures.

### Slot 3 — Tool plane (MCP)

**Verdict: KEEP. User's call was right — MCP won.**

9,400+ MCP servers (8x growth since Q1 2025). 78% enterprise adoption. ChatGPT, Claude, Gemini, Cursor, Windsurf, Zed, JetBrains, Vercel AI SDK, OpenAI Agents SDK all support MCP. MCP v1.27 + 2026 roadmap focuses on horizontal scale + .well-known metadata.

**Quick wins:**
- Adopt **Strands' semantic-search-over-tools pattern** (only describe relevant tools to the model per turn — claimed 96% token reduction) when the MCP server count grows past ~50.
- Add **Tirith pre-execution scanning** (Hermes-style) as defense-in-depth for tool calls.

**Worth-watching:** A2A (Agent2Agent) — Google's protocol, now Linux Foundation, 150+ orgs, 22K stars on GitHub, complementary to MCP. Add at Phase 16 if multi-vendor agent interop becomes relevant.

### Slot 4 — Memory (filesystem + Obsidian + index.jsonl)

**Verdict: KEEP CORE, ADD Honcho.**

The user's current setup maps to Hermes' MEMORY.md + FTS5 layer. **The missing layer is Honcho — dialectic user/project modeling derived implicitly from conversations.** Honcho is open-source (`honcho.dev`, MIT) and Hermes-style integration is documented.

**Quick wins:**
- Add Honcho as Phase 7-E (between 7-D vector and the deferred deeper memory work). Cost: ~1 week of integration. Upside: implicit user/project modeling without bespoke summarization.
- Adopt Hermes' SOUL.md pattern: each named agent (Picard/Sisko/Troi) gets a SOUL.md identity file. Trivial to add; large clarity win.

### Slot 5 — Self-improvement (15-A heuristic, 15-B/C planned)

**Verdict: KEEP plan; ADD Curator pattern; DEFER Tinker-Atropos for v0.0.1.**

The Tinker-Atropos integration is real but: Tinker is in private beta, Atropos has 1.2K stars, integration is non-trivial. Real ROI claims (DeepHermes-ToolCalling-Specialist 2.5-4.6x) come from Nous' own training runs.

**Quick wins:**
- Adopt Hermes' **Curator pattern** for Phase 15-A: a background pass that grades skills/heuristics by usage/success, moves stale ones to archive, proposes consolidations. Cheap to build, structurally important.
- Add **DSPy signatures + optimizers** for prompt management — declarative + auto-optimized prompts is now standard.

**Worth-watching:** Tinker-Atropos for Phase 15-C once Tinker exits beta.

### Slot 6 — External communications (Hermes in gateway mode for Phase 10)

**Verdict: KEEP and EXPAND.**

The Phase 2.75 verdict ("Hermes for Courier") is now even better-supported. v0.13 added 7 new platforms (20 total), session auto-resume, scheduled cron, allowlists, redaction, container-backend isolation. This is the single most production-mature piece of Hermes.

**Hard requirement before production:** lock down the security posture. Use container backend, set `HERMES_WRITE_SAFE_ROOT`, explicit allowlists per platform, never use YOLO mode, store secrets at `chmod 600 ~/.hermes/.env`, run on isolated host. Issue #7826 is a *roadmap*, not a *blocker*, if you commit to the hardened config.

### Slot 7 — Skills (agentskills for Phase 18)

**Verdict: KEEP. Plan is excellent.**

Agent Skills is now an open Linux Foundation standard. SKILL.md is two YAML fields + Markdown. 60K+ repos already use AGENTS.md. The user's Phase 18 marketplace plan rides the most decisively-won standard in the 2026 stack.

**Quick wins:**
- Add an **AGENTS.md** to every project the dev factory generates — it's now the cross-tool default; gives the output a 28% wall-clock and 16% token-cost reduction in subsequent agent work.
- Adopt the Linux Foundation's **Agentic AI Foundation** governance posture (signed manifests, provenance) early — this is where Hermes is weakest.

---

## D. Production AI Dev Factory Comparisons

### Top 5 to study (in order of relevance)

1. **Factory.ai** — closest competitor by architecture. Coordinator-droid model, sandboxed worktrees per droid, verifier-against-spec pattern, Linear/Jira-as-unit-of-work. Their thesis: "fragmentation handled by specialized agents with explicit role boundaries." This is *exactly* the Picard/Sisko/Troi/Jane/Spock/Torres/Tuvok/Data architecture. They're commercial; Agentryx's open-source posture is the differentiator.
2. **AWS Kiro IDE** — three-phase Requirements / Design / Tasks workflow built into the IDE. EARS-notation acceptance criteria. Most direct competitor on spec-driven philosophy.
3. **GitHub Spec Kit** — 93K stars, works with 30+ agents, CLI + templates + prompts for the Specify → Plan → Tasks workflow. Open source. The user should read the AGENTS.md from their repo.
4. **BMAD-METHOD** — multi-agent SDD with named role personas; "Edge Case Hunter" parallel review layer. Matches user's named-agent pattern (Picard/Sisko/etc.).
5. **Devin (Cognition)** — production case studies are real (Nubank: 8-12x faster migration, $20M+ savings claimed; Visma: doubled productivity). Pricing dropped from $500 → $20 base in 2026. SWE-bench 13.8% on full set vs. ~88% best-of-breed — Devin's value is *long-running, repetitive, scoped tasks*, not greenfield.

### Lessons that apply

- **Coordinator + verifier-against-spec is dominant.** Factory's pattern of "verifier checks against the living spec in a separate context" is exactly what Hermes-as-Courier + Genovi (verify portal) should do. Strengthen this layer.
- **Worktree-per-agent is the parallelism unit.** Factory and Hermes both run isolated git worktrees per worker. If Phase 9 doesn't already do this, add it.
- **Spec-anchored beats spec-first.** Martin Fowler's analysis (Kiro/Spec Kit/Tessl) says spec-first generates noise (16 acceptance criteria for a small bug fix). Agentryx's PMD-style approach should adapt verbosity to scope (small change → small spec).
- **Markdown review fatigue is real.** Fowler quote: "I'd rather review code than all these markdown files." Verify portal should let humans review *code diffs* with spec context, not raw spec markdown.
- **AGENTS.md should be a first-class output artifact** of every Agentryx project — 60K+ repos already use it; tools read it natively for 28% runtime reduction.

### What Agentryx's PMD approach does *better*

- **Document-driven first, IDE-second.** Kiro/Cursor/Bolt/v0/Replit are all IDE-native. Factory is delivery-pipeline-native but commercial. Agentryx's PMD-driven, dev-factory-as-pipeline, open-source posture is genuinely undefended in 2026.
- **Memory + courier + skills + RL all under one roof.** No competitor has all four. Factory has none. Kiro has none. BMAD has none.

### What Agentryx is NOT doing but should consider

- **Verifier-against-spec as a separate-context agent.** Genovi does verification, but verify it runs with *clean context* and reads the *living spec* (not the implementor's notes).
- **EARS-notation in PMDs.** Kiro enforces EARS for acceptance criteria. Worth piloting.
- **Per-droid sandboxed workspace** (Factory) / **per-agent worktree** (Hermes Kanban) — surface as the canonical execution unit.
- **`hermes/factory deploy`-style single-command production deploy.** Deep Agents and Factory both do this. Phase 16 candidate.

---

## E. Recommended Actions

### Top 3 concrete roadmap changes (ranked by leverage)

**#1 — Adopt Hermes' multi-agent Kanban patterns into Phase 9 (highest leverage)**
- **Scope:** Implement durable task table (heartbeat + TTL + zombie-reclaim + circuit breaker on N consecutive failures) on top of LangGraph. Each LangGraph node becomes a worker that pulses heartbeat. Failed/abandoned tasks auto-reclaim. Per-task comment thread for human-in-the-loop.
- **Effort:** 2-3 weeks for a competent engineer.
- **Upside:** Phase 9 multi-agent durability solved with a battle-tested pattern. Avoids reinventing.
- **What to defer if you take this:** push back the bespoke Phase 9 swarm topology work; let the Kanban table be the topology.

**#2 — Add Honcho dialectic memory as Phase 7-E (highest "free upside")**
- **Scope:** Integrate Honcho between current filesystem memory and the deferred Phase 7-D vector backend. Use it for implicit user-modeling and project-modeling derived from conversation history.
- **Effort:** ~1 week.
- **Upside:** Closes the biggest gap vs. Hermes; gives every named agent a deepening understanding of the user/project without bespoke summarization.
- **What to defer:** keep Phase 7-B sqlite/postgres deferred; Honcho ships its own backend.

**#3 — Lock the Hermes Phase 10 (Courier) deployment to the hardened config and add audit logging now**
- **Scope:** Before Hermes goes live as Courier in Phase 10: container backend + WRITE_SAFE_ROOT + explicit allowlists per platform + no YOLO + secrets at chmod 600 + isolated host + audit log of every external message and every tool approval. Wrap Hermes with a thin signing layer for skill provenance even if upstream doesn't.
- **Effort:** 1 week up-front; ~3 days/quarter ongoing for upgrades.
- **Upside:** Captures all the Hermes upside (gateway + skills + cron + sessions) with the security posture the user's enterprise customers will demand.
- **What to defer:** Don't run agentskills marketplace contributions through Hermes' default skill loader until provenance signing exists.

### Bonus quick wins

- Add an `AGENTS.md` to every dev-factory output. (1 day; 28% downstream agent runtime reduction.)
- Adopt Hermes' SOUL.md pattern for each Star Trek agent. (1 day; major clarity win.)
- Adopt Curator pattern for Phase 18 skills health. (1 week; prevents skill bloat.)
- Add `/goal` Ralph-loop primitive to Picard. (1 day; goal persistence across turns.)

### "Definitely don't change this" reassurances

1. **LangGraph as primary runtime.** The field validates this hard — Klarna/Uber/LinkedIn at scale, v1.0 stable, durable execution + Postgres checkpointing. Don't replace with Hermes.
2. **MCP as tool plane.** 9,400+ servers, 78% enterprise adoption, every major IDE supports it. Don't second-guess.
3. **LiteLLM + OpenRouter dual router.** Top of every 2026 router comparison. Hermes itself defaults to OpenRouter. Don't rebuild.
4. **JS-first.** Mastra and Vercel AI SDK 6 are both TS-native and growing; the rest of the field is finally treating TS as first-class. The choice was forward-looking.
5. **Star Trek named agents.** The role-based mental model is identical to BMAD-METHOD, Factory's coordinator-droid, and CrewAI's role/goal/backstory. The field validates the pattern.

---

## Sources

1. [LangChain & LangGraph 1.0 Milestones](https://blog.langchain.com/langchain-langgraph-1dot0/) — LangGraph 1.0 GA late 2025, durable execution, JS+Python parity.
2. [LangSmith and LangGraph in 2026 (Medium)](https://medium.com/@sehaj23chawla/langsmith-and-langgraph-in-2026-how-langchains-agent-stack-quietly-became-the-default-f1609af5d658) — LangChain stack as 2026 default; production positioning.
3. [LangGraph TypeScript Postgres checkpoint docs](https://docs.langchain.com/oss/javascript/langgraph/persistence) — JS persistence layer; April 2026 docs review.
4. [LangChain Deep Agents](https://www.langchain.com/deep-agents) — planning + filesystem + subagents + skills harness on LangGraph.
5. [LangChain Deep Agents GitHub](https://github.com/langchain-ai/deepagents) — Python+TS harness; March 2026 update.
6. [LangChain April 2026 Newsletter](https://www.langchain.com/blog/april-2026-langchain-newsletter) — `deepagents deploy`, NVIDIA AI-Q, Cisco/Credit Genie case studies.
7. [Hermes Agent GitHub](https://github.com/nousresearch/hermes-agent) — Nous Research framework, 140K stars.
8. [Hermes Agent docs](https://hermes-agent.nousresearch.com/docs/) — Architecture, gateway, memory, skills.
9. [Hermes Agent v0.13 Tenacity reference](https://blakecrosley.com/guides/hermes) — Multi-agent Kanban, /goal, pluggable providers.
10. [Hermes Agent Releases](https://github.com/NousResearch/hermes-agent/releases) — v0.10-v0.13 release notes (Apr-May 2026).
11. [Hermes Agent Honcho memory docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/honcho) — Dialectic user-modeling memory backend.
12. [Hermes Curator docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator) — Skills curator pattern.
13. [Hermes RL Training docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/rl-training) — Tinker-Atropos integration, GRPO/LoRA.
14. [Hermes Kanban docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban) — Durable multi-agent board with heartbeat/reclaim.
15. [Hermes User Stories](https://hermes-agent.nousresearch.com/docs/user-stories) — GLADIATOR, Auto-Build Workflow, parallel deployments.
16. [Hermes Security docs](https://hermes-agent.nousresearch.com/docs/user-guide/security) — 7-layer defense model + hardening recommendations.
17. [Hermes Security Audit Issue #7826](https://github.com/NousResearch/hermes-agent/issues/7826) — 4 critical / 9 high findings; ALLOW-ALL default posture.
18. [Hermes Agent Review (kisztof, Medium)](https://kisztof.medium.com/hermes-agent-review-nous-researchs-self-improving-ai-agent-e72bc244435a) — Honest review with skill-poisoning + compliance gaps.
19. [Hermes Agent vs others (markaicode)](https://markaicode.com/vs/hermes-vs-ai-agent-frameworks/) — Head-to-head with LangGraph/CrewAI/AutoGen.
20. [Hermes Production Deployment Patterns (kenhuangus)](https://kenhuangus.substack.com/p/chapter-10-production-deployment) — Hermes vs Claude Code production patterns.
21. [Hermes Self-Improvement (Innobu)](https://www.innobu.com/en/articles/hermes-agent-self-improvement-open-source-2026.html) — Growth metrics, GEPA reference, no production case studies.
22. [Hermes Skills + agentskills.io blog](https://hermesagents.net/blog/skills-and-agentskills-io/) — Marketplace growth, governance, contributor model.
23. [Atropos GitHub](https://github.com/nousresearch/atropos) — RL environments framework; v0.4.0 March 2026.
24. [Tinker by Thinking Machines Lab](https://thinkingmachines.ai/tinker/) — LoRA training API; private beta.
25. [Anthropic Agent Skills standard](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — SKILL.md spec; 32-tool adoption.
26. [Agent Skills Open Standard guide (Paperclipped)](https://www.paperclipped.de/en/blog/agent-skills-open-standard-interoperability/) — 32 tools in 90 days; Linux Foundation governance.
27. [agentskills.io](https://agentskills.io/home) — Canonical home for the spec.
28. [AGENTS.md cross-tool standard](https://agents.md/) — 60K+ repos; Linux Foundation Agentic AI Foundation.
29. [The 2026 MCP Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) — MCP horizontal scale + .well-known metadata.
30. [MCP Adoption Statistics 2026](https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol) — 9,400+ servers, 78% enterprise adoption.
31. [Microsoft Agent Framework 1.0 GA](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/) — April 3, 2026 GA; AutoGen + Semantic Kernel merger.
32. [AutoGen status (Visual Studio Magazine)](https://visualstudiomagazine.com/articles/2025/10/01/semantic-kernel-autogen--open-source-microsoft-agent-framework.aspx) — AutoGen now maintenance-only.
33. [CrewAI Lessons from 2B Workflows](https://blog.crewai.com/lessons-from-2-billion-agentic-workflows/) — 60% of US Fortune 500, 47.8K stars, 2B runs.
34. [CrewAI 2026 Enterprise Survey](https://www.businesswire.com/news/home/20260211693427/en/) — 100% enterprise adoption planned.
35. [2026 AI Agent Framework Showdown (QubitTool)](https://qubittool.com/blog/ai-agent-framework-comparison-2026) — Claude SDK / Strands / LangGraph / OpenAI Agents head-to-head.
36. [OpenAI Agents SDK update April 2026](https://openai.com/index/the-next-evolution-of-the-agents-sdk/) — Sandbox harness, computer use.
37. [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) — Hooks, MCP, subagents, parent_tool_use_id.
38. [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) — Built-in multi-agent (experimental).
39. [Strands Agents AWS blog](https://aws.amazon.com/blogs/opensource/introducing-strands-agents-an-open-source-ai-agents-sdk/) — Bedrock-native; semantic tool search.
40. [Strands "96% token reduction" article](https://thenewstack.io/strands-agents-tool-design/) — Tool-scaling pattern.
41. [Mastra TS framework guide](https://www.generative.inc/mastra-ai-the-complete-guide-to-the-typescript-agent-framework-2026) — Opinionated TS-native framework with MCP+memory+evals.
42. [Vercel AI SDK 6](https://vercel.com/blog/ai-sdk-6) — Agent abstraction, ToolLoopAgent, MCP, DevTools.
43. [PydanticAI](https://ai.pydantic.dev/) — Type-safe Python agents; pydantic-graph FSM.
44. [Inspect AI (UK AISI)](https://inspect.aisi.org.uk/) — Frontier eval framework; 200+ evals; supports external agents.
45. [Devin pricing 2026 (VentureBeat)](https://venturebeat.com/programming-development/devin-2-0-is-here-cognition-slashes-price-of-ai-software-engineer-to-20-per-month-from-500) — $20 entry pricing; 83% more junior tasks per ACU.
46. [Cognition Devin pricing/case studies](https://www.eesel.ai/blog/cognition-ai) — Nubank 8-12x migration speedup; Visma 2x productivity.
47. [SWE-Bench Verified Leaderboard 2026](https://benchlm.ai/benchmarks/sweVerified) — Claude Mythos Preview 93.9%, Opus 4.7 87.6%, GPT-5.3 Codex 85%.
48. [OpenHands](https://www.openhands.dev/) — Best open scaffold; AMD/Apple/Google/NVIDIA/Netflix adoption.
49. [Cursor 2.0 + Composer launch](https://cursor.com/blog/2-0) — Multi-agent up to 8 parallel workers.
50. [Cursor 3 launch](https://cursor.com/blog/cursor-3) — April 2, 2026; agent-first IDE.
51. [Factory AI platform](https://factory.ai/) — Coordinator-droid pattern, sandboxed worktrees.
52. [Factory AI multi-agent review (DigitalApplied)](https://www.digitalapplied.com/blog/factory-ai-multi-agent-coding-platform-review) — Coordinator/droid architecture, verifier-against-spec.
53. [Spec-Driven Development tools (Martin Fowler)](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) — Kiro/Spec Kit/Tessl analysis; review-burden critique.
54. [GitHub Spec Kit](https://github.com/github/spec-kit) — 93K stars; Specify → Plan → Tasks; works with 30+ agents.
55. [Best Spec-Driven Development Tools (Augment)](https://www.augmentcode.com/tools/best-spec-driven-development-tools) — 6 SDD tools compared; industry-standard status.
56. [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) — Multi-agent SDD with named role personas.
57. [Ralph Wiggum loop pattern (DEV)](https://dev.to/alexandergekov/2026-the-year-of-the-ralph-loop-agent-1gkj) — Persistent goal-iteration pattern; now in Codex /goal.
58. [E2B vs Modal vs Daytona benchmark 2026](https://www.superagent.sh/blog/ai-code-sandbox-benchmark-2026) — Sandbox provider comparison.
59. [Daytona vs E2B 2026 (Northflank)](https://northflank.com/blog/daytona-vs-e2b-ai-code-execution-sandboxes) — microVM vs container tradeoffs.
60. [Agent2Agent A2A protocol](https://a2a-protocol.org/latest/) — Linux Foundation, 150+ orgs, 22K stars; complementary to MCP.
61. [BAML by BoundaryML](https://github.com/BoundaryML/baml) — Schema-aligned parsing for LLM structured outputs.
62. [DSPy](https://dspy.ai/) — Declarative signatures + auto-optimizers.
63. [LiteLLM vs OpenRouter (TrueFoundry)](https://www.truefoundry.com/blog/litellm-vs-openrouter) — Router comparison.
64. [Best LLM Routers 2026 (Pinggy)](https://pinggy.io/blog/best_ai_llm_routers_openrouter_alternatives/) — TrueFoundry / Bifrost / Kong AI options.
65. [Vibe coding to spec-driven (TestCollab)](https://testcollab.com/blog/from-vibe-coding-to-spec-driven-development) — Industry shift narrative.

---

## Methodology + caveats

**Researcher**: claude-opus-4-7 main session as Solution Architect, with delegation to general-purpose subagent (Sonnet) for the wide web-search work — protects main context window per `D.Roadmap/03_Scaffolding_Pattern.md` discipline.

**Search budget**: 30+ web searches, 20+ page fetches via the subagent. Subagent then synthesised findings; main session validated the synthesis and produced this document.

**Date sensitivity**: weighted late-2026 / 2025 sources over older. Anything with a date stamp older than 2025-Q3 was treated as background colour.

**Hermes coverage**: disproportionate (per founder request). All Hermes Agent v0.10-v0.13 release notes read; security audit Issue #7826 read; user stories + production deployment patterns read.

**Honest limits**:
- Tinker remained inaccessible for direct hands-on (private beta, waitlist only). Recommendations there are based on docs + Nous Research case studies, not first-party experimentation.
- "X stars in Y weeks" growth claims for Hermes come from the project's own README/docs and HN/Twitter discussion; treat as directional, not validated by independent counters.
- Production case study claims for Devin (Nubank 8-12x, Visma 2x) come from Cognition AI's own marketing materials; the underlying methodology is not independently audited.

**Decision authority**: this document is research, not a ratified architectural change. Adopting any of the §E recommendations should land as a formal decision in `D.Roadmap/Phase_NN/Phase_NN_Decisions.md` (e.g. `Phase_2.76_Landscape_Update_2026_05/`) per the established discipline.

---

*End of scan. Next refresh recommended at v0.0.1 close + 4 weeks, or when a major framework GA's a 1.0.*
