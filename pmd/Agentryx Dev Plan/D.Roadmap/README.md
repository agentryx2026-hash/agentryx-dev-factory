# Agentryx Dev Factory — Roadmap

**This is the master plan.** Read this first in any new session.

## Operating principles

See [00_Architectural_Principles.md](00_Architectural_Principles.md) for the full version. Headlines:

1. **Configurability over commitment** — every choice has options selectable from admin UI. We're in v0.0.1 R&D / experimentation, *not* production. Choose all reasonable approaches and compare.
2. **Agile, sketch-then-detail** — only the next 1-2 phases are detailed. Future phases are one-liners until ratified.
3. **Verify portal and Documentation are separate modules** — factory integrates with them, doesn't subsume them.
4. **Right model for the right task** — multi-tier LLM routing from day one (Phase 2).
5. **Tool-swap flexibility** — every external dep sits behind an interface; R3/R4 replacements are hot-swap config changes.
6. **Release-band discipline** — v0.0.1 → R1 → R2 → R3 → R4 → R5, no band-skipping.

For the long-term vision (what R4/R5 looks like), see **[../Master_Factory_Architect.md](../Master_Factory_Architect.md)** — written by Claude Opus 4.7 as the target architecture this roadmap converges toward.

## Roadmap (20 phases)

| # | Phase | One-line goal | Status |
|---|---|---|---|
| 0 | **GitHub setup** | Fresh `agentryx-factory` repo, structure, labels, milestones, Project board | ✅ done |
| 1 | [Restore and Observe](Phase_01_Restore_and_Observe/Phase_01_Plan.md) | Get current pipeline alive, instrumented, repeatable on any VM | ✅ done |
| 1.5 | [Rename and Monorepo](Phase_1.5_Rename_and_Monorepo/Phase_1.5_Plan.md) | Rename repo to `agentryx-dev-factory`, migrate `pixel-factory-ui` → `factory-dashboard`, fold cognitive-engine into monorepo, + tool links in sidebar + Paperclip UI exposed | ✅ done |
| 2 | [LLM Router and Cost Telemetry](Phase_02_LLM_Router/Phase_02_Plan.md) | LiteLLM + OpenRouter, switchable; per-task model assignment; per-call $ captured; Key Console (2.5) inserted mid-phase; fallback chain; compare mode; cost panel | ✅ done |
| 2.5 | [Key Console (B7-lite)](Phase_2.5_Key_Console/Phase_2.5_Plan.md) | Inserted mid-Phase-2 after 6 secret-leak incidents. Browser-based provider-key management, AES-256-GCM at rest, audit log. | ✅ done |
| 2.75 | [Hermes Agent Evaluation](Phase_2.75_Hermes_Evaluation/Phase_2.75_Plan.md) | Evaluated [Nous Research Hermes](https://github.com/nousresearch/hermes-agent). **Verdict: hybrid adoption** — Hermes for Courier (Ph10) + agentskills (Ph18); Hermes patterns for Memory (Ph7) + Self-improve (Ph15); LangGraph stays as primary agent runtime. Saves ~4 weeks across downstream phases. | ✅ done |
| 3 | [Intake Stage (Genovi)](Phase_03_Intake_Genovi/Phase_03_Plan.md) | New first agent. SRS/FRS/PRD → structured requirement extraction | ✅ done |
| 4 | [PMD Template Registry](Phase_04_PMD_Template_Registry/Phase_04_Plan.md) | Formalize 25-30 standard docs as versioned templates with dependency graph | ✅ done |
| 5 | [MCP Tool Plane](Phase_05_MCP_Tool_Plane/Phase_05_Plan.md) | Replace custom `tools.js` with MCP servers (fs, git, github, postgres, browser) | 🟡 5-A done (scaffolding); 5-B deferred (graph integration, needs OpenRouter credit) |
| 6 | [Artifact-First State](Phase_06_Artifact_First_State/Phase_06_Plan.md) | Typed outputs (PMD/code/test/doc) to versioned artifact store | 🟡 6-A done (scaffolding); 6-B deferred (graph dual-write, needs OpenRouter credit) |
| 7 | [Memory Layer v1](Phase_07_Memory_Layer/Phase_07_Plan.md) | Obsidian vault (human-curated) + pluggable backends (sqlite/postgres/vector) behind MemoryService interface | 🟡 7-A done (scaffolding + fs backend + artifact walker); 7-B/C/D/E deferred |
| 8 | [Parallel Artifacts](Phase_08_Parallel_Artifacts/Phase_08_Plan.md) | Restructure graph: code/tests/docs as concurrent branches under fan-out/join | 🟡 8-A done (proof + reducers, 1061ms vs 3000ms sequential); 8-B deferred (dev_graph rewire, needs OpenRouter credit) |
| 9 | [Verification Queue (Verify integration)](Phase_09_Verification_Queue/Phase_09_Plan.md) | Stand up Verify portal; factory pushes test cases; humans approve/reject; feedback loops back | 🟡 9-A done (contract + mock client + feedback cycle, 30 assertions pass); 9-B deferred (Verify multi-app + OpenRouter) |
| 10 | [Courier — External Comms](Phase_10_Courier_External_Comms/Phase_10_Plan.md) | Factory-side producer API; per D74 **Courier IS Hermes in gateway mode** | 🟡 10-A done (types + 3 backends + routing, 33 assertions); 10-B deferred (Hermes deploy + producer wiring) |
| 11 | [Cost + Quota Dashboard](Phase_11_Cost_Quota_Dashboard/Phase_11_Plan.md) | Per-project, per-agent, per-model spend. Hard caps + alerts | 🟡 11-A done (rollup library, 22 assertions pass); 11-B deferred (UI + alerts, needs Phase 10 Courier) |
| 12 | [B7 Admin Module v1](Phase_12_B7_Admin_Module/Phase_12_Plan.md) | Substrate: 7 configs + 8 flags catalogued, atomic CRUD, 4-level roles, audit log | 🟡 12-A done (substrate library, 39 assertions); 12-B deferred (HTTP routes + React UI + Postgres) |
| 13 | [Pipeline Replay / Debug](Phase_13_Pipeline_Replay/Phase_13_Plan.md) | Time-travel any past run; re-execute from any node with frozen or substituted inputs | 🟡 13-A done (replay engine, 36 assertions); 13-B deferred (LLM stub + UI + HTTP) |
| 14 | [Multi-Project Concurrency](Phase_14_Multi_Project_Concurrency/Phase_14_Plan.md) | Queue + scheduler; N projects in factory at once with isolation | 🟡 14-A done (engine + round-robin fairness, 28 assertions); 14-B deferred (real handlers + UI + quotas) |
| 15 | [Self-Improvement Loop](Phase_15_Self_Improvement_Loop/Phase_15_Plan.md) | Agents propose changes (prompts/models/configs); gated by Super Admin approval | 🟡 15-A done (substrate: state-machine store + heuristic proposer + replay-driven evaluator + applier, 87 assertions); 15-B deferred (LLM proposer + real comparators + UI + prompt hot-swap, needs OpenRouter credit) |
| 16 | [Training Scripts Generation](Phase_16_Training_Scripts_Gen/Phase_16_Plan.md) | Output written user guides + voiceover scripts + storyboards as artifacts | 🟡 16-A done (6 template generators + store + renderer + pipeline, 102 assertions; voiceover schema IS the Phase 17 handoff); 16-B deferred (LLM generators + post-dev wiring + PMD/memory + dual-write + Verify feedback, needs OpenRouter credit) |
| 17 | [Training Videos](Phase_17_Training_Videos/Phase_17_Plan.md) | ElevenLabs voiceover + headless browser screen capture stitched | one-liner |
| 18 | [Pipeline Module Marketplace](Phase_18_Pipeline_Module_Marketplace/Phase_18_Plan.md) | Install/swap agents as packages with manifest | one-liner |
| 19 | [Customer Portal](Phase_19_Customer_Portal/Phase_19_Plan.md) | Non-admin users submit projects; SLA + status tracking | one-liner |
| 20 | [Public Release](Phase_20_Public_Release/Phase_20_Plan.md) | Multi-tenant, billing, hardening, compliance | one-liner |

Phases 16-20 will absolutely change as we learn.

## Cross-cutting modules

These are not phases — they're standards / interfaces that span multiple phases.

| Module | Purpose |
|---|---|
| [Modules/Verify_Portal_Integration.md](Modules/Verify_Portal_Integration.md) | How factory feeds Verify; how feedback returns; boundary contract |
| [Modules/Documentation_Module.md](Modules/Documentation_Module.md) | User guides, reference docs, briefs — own track, parallel to code |
| [Modules/Testing_In_Pipeline.md](Modules/Testing_In_Pipeline.md) | Tuvok-driven smoke / load / UI / E2E during dev cycle |

## Reference

- [01_Agent_Delegation_Model.md](01_Agent_Delegation_Model.md) — which model (Opus 4.7 / Sonnet 4.6 / Haiku 4.5 / Gemini / cheap-tier) does what task type, with cost rationale.

## Per-phase folder structure

Each `Phase_NN_*/` folder contains four files:

| File | Purpose |
|---|---|
| `Phase_NN_Plan.md` | The plan (full for current phase, sketch for future) |
| `Phase_NN_Status.md` | Live status — what's done, blocked, next |
| `Phase_NN_Decisions.md` | Decisions log — chose X over Y because Z |
| `Phase_NN_Lessons.md` | Post-mortem — filled at phase close, feeds future phases |

Status / Decisions / Lessons files are created when a phase moves from sketch → active.

## Git workflow (adopted 2026-04-21 during Phase 5-A)

Every phase from 5-A onwards uses PR flow, not direct-to-main.

1. **Branch off main**: `git checkout -b phase/<n>-<slug> main`
2. **Commit + push branch**: `git push -u origin phase/<n>-<slug>`
3. **Open PR**: `gh pr create --base main --head phase/<n>-<slug> --title "..." --body "..."` with Summary + Test plan + Rollback sections.
4. **Link to milestone**: `gh api repos/:owner/:repo/issues/<pr#> -X PATCH -f milestone=<n>`
5. **Merge (squash)**: `gh pr merge <pr#> --squash --delete-branch` — one commit per phase on main, branch auto-deleted.
6. **Tag**: `git tag -a phase-<n>-closed <sha> -m "..." && git push origin phase-<n>-closed`
7. **Sync local**: `git checkout main && git pull --ff-only origin main && git fetch --prune origin`

**Why**: Review gate + rollback discipline + parallel experimentation. Aligns with Master_Factory_Architect.md P9 (release-band versioning).

**Phase tags**: `phase-0-baseline`, `phase-1-closed`, `phase-1.5-closed`, `phase-2-closed`, `phase-2.5-closed`, `phase-2.75-closed`, `phase-3-closed`, `phase-4-closed`, `phase-5a-closed`, `phase-6a-closed`, `phase-7a-closed`, `phase-8a-closed`, `phase-9a-closed`, `phase-10a-closed`, `phase-11a-closed`, `phase-12a-closed`, `phase-13a-closed`, `phase-14a-closed`, `phase-15a-closed`, `phase-16a-closed`.
