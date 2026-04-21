# Architectural Principles

These are the foundational decisions that constrain every phase. Change deliberately, not casually.

## 1. Configurability over commitment

**Wherever there are options, support all reasonable ones, selectable from the admin UI.**

Examples:
- LLM router: LiteLLM (self-hosted) AND OpenRouter (hosted) — both available, switchable per request.
- Memory: Obsidian vault AND vector DB AND Letta — all live, comparable.
- Code agents: raw LLM AND Aider AND OpenHands — try all three on the same task and compare outputs.

**Why**: We are at v0.0.1 — R&D / experimentation. The goal is to learn which approach works best, not to ship one opinion. v1.0 will lock in winners; until then, optionality has more value than simplicity.

**How to apply**: When you face a "framework A vs framework B" choice, build both behind a switch. If timeline doesn't allow both, build A first but design the interface so B is a future plug-in.

## 2. Agile, sketch-then-detail

Only the **next 1-2 phases** are detailed. Future phases are one-liners until ratified.

Each phase has 4 standard files: `Plan`, `Status`, `Decisions`, `Lessons`. Plan starts as a one-liner, expands when the phase becomes active. Status / Decisions / Lessons are created when the phase starts.

**Why**: Every phase teaches something that changes the next. Pre-specifying phase 12 today wastes effort and locks in wrong assumptions.

## 3. Verify portal and Documentation are SEPARATE modules

Factory **integrates with** them, doesn't subsume them. They have own deploy, own UI, own data model. Factory consumes them via webhooks / API.

**Why**: They serve different lifecycles. Verify is used by humans during release; Documentation is consumed by end users post-release. Coupling them to the factory means redeploying the factory to fix a doc layout. Decoupled = independent evolution.

## 4. Right model for the right task

Multi-tier LLM routing from Phase 2 onward:

| Tier | Use for | Examples |
|---|---|---|
| Architect | Complex reasoning, planning, code review | Claude Opus 4.7, GPT-5, Gemini 2.5 Pro |
| Worker | Code generation, doc writing, structured output | Claude Sonnet 4.6, Gemini 2.5 Flash, GPT-5-mini |
| Cheap | Simple classification, formatting, summarization | Claude Haiku 4.5, Gemini Flash, Qwen 3 |
| Logic | Deterministic transforms (no LLM) | Pure code, regex, AST, schema validators |

The router is configurable — admin can override per-task in Phase 2's UI.

## 5. Two-tier user model: Super Admin and User

- **Super Admin** sees every config, every key, every option.
- **User** sees a curated subset (presets, gated features) — protects them from the cognitive overload of full configurability.

This split lets us keep maximum optionality (Principle 1) without overwhelming everyday operators.

## 6. Source of truth is in this repo

Anything that survives a VM rebuild lives in this git repo:
- PMD docs ✅
- Systemd units ✅ (`deploy/`)
- nginx vhosts ✅ (`deploy/`)
- App code ✅ (`factory-dashboard/`, `cognitive-engine/`)
- Env templates (no secrets) ✅ (`configs/`)

Anything NOT in this repo dies on VM rebuild. Audit periodically.

## 7. Secrets never in repo, never in chat

- `.env` files — `.gitignore`'d, never committed.
- API keys — admin UI manages them (Phase 12; Phase 2.5-lite already ships it).
- GitHub PATs — `gh auth login` credential helper, never embedded in `.git/config`.
- For chat: paste tokens directly into terminal prompts, not into chat messages.

This rule has been violated 7 times during the first session, each via a different mechanism (chat paste, awk redaction bug, systemd journal echo of malformed `export` lines, `gh auth status` partial leak, docker env dump, etc.). Mitigations are now architectural (Phase 2.5 Key Console) rather than procedural.

## 8. Tool-swap flexibility (every external dep sits behind an interface)

Every external tool we adopt — Hermes (gateway mode, Phase 10), agentskills.io (Phase 18), Letta / Graphiti / Honcho (evaluated in Phase 7), MCP servers (Phase 5), LiteLLM / OpenRouter (Phase 2) — **must have a well-defined interface in our factory code**. Direct coupling is never acceptable.

**Concrete mechanics**:
- Every slot has a `getActiveImpl(slot, project_id)` resolver that reads the current implementation choice from Postgres (see `Master_Factory_Architect.md` §6).
- Default is factory-wide; per-project overrides allowed.
- Hot-swap: change the row, next task uses the new implementation. No redeploy.
- A/B compare: an admin mode runs the same task through two implementations and surfaces differences (Phase 2F compare-mode principle, generalized).

**Why**: at R3/R4/R5 we expect to replace some external tools with our own. The swap should be a *config change* and *passing the interface tests*, not a rewrite of caller code. This is the configurability principle (P1) at the code-architecture level.

**Applies retroactively**: any tool already adopted (Hermes, Paperclip, LangGraph, n8n) gets an adapter layer added before it ships to R1 if one doesn't exist.

## 9. Release-band versioning discipline

Factory evolves through named release bands (see `Master_Factory_Architect.md` §1):
- **v0.0.1** (current) — R&D, comparison mode
- **R1** (week 10 target) — first shippable factory, uses external tools heavily
- **R2** (month 4-6) — production hardening, same deps
- **R3** (month 7-9) — selective replacement of painful deps
- **R4** (month 10-12) — vertical integration, most brain-layer deps are ours
- **R5** (year 2+) — self-hostable, zero-mandatory-external stack

We do NOT skip bands. We earn the right to replace an external tool by having suffered its failure modes. This is *the* principle that keeps us honest about what we can and can't build.
