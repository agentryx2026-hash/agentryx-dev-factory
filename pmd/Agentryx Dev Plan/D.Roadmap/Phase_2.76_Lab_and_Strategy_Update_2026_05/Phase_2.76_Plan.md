# Phase 2.76 — Beta Playground + Strategy Update (2026-05)

**Founder request**: 2026-05-09 — after the ~2-week development pause that closed v0.0.1 A-tier at 100% coverage, founder reviewed the [2026-05 landscape scan](../../Research/2026-05_Landscape_Scan.md) and proposed a strategic shift: **stop trying to predict which tool wins; build a permanent capability to test any new tool quickly inside our own pipeline.**

**Why this is its own phase (and not just a Decisions append to Phase 2.75)**: it adds a new top-level capability (the Beta Playground), changes our release-band schedule, expands the Hermes footprint set in Phase 2.75 D74, and establishes a permanent testing cadence. Each of those alone might be a Decisions entry; together they're a phase. Mirrors how Phase 2.5 (Key Console) was carved out mid-Phase-2 when secret-management became a phase-sized concern.

## Context — what changed since Phase 2.75 (2026-04-21)

- **Hermes Agent v0.10 → v0.13** shipped weekly between 2026-04-16 and 2026-05-07. v0.13 "Tenacity" added durable multi-agent Kanban + 20-platform gateway + 8 critical security fixes.
- **LangGraph 1.0 GA** stable, JS+Python parity, durable Postgres checkpointing.
- **Microsoft Agent Framework 1.0** absorbed AutoGen (April 3); AutoGen now maintenance-only.
- **GitHub Spec Kit at 93K stars**; Spec-Driven Development became industry standard.
- **MCP at 9,400+ servers**, 78% enterprise adoption — Phase 5's call validated.
- **AGENTS.md is now a Linux Foundation cross-tool standard** (60K+ repos).
- **Cursor 3** launched April 2 as agent-first IDE.
- **Anthropic Agent Teams** shipped experimentally inside Claude Code.
- **Thinking Machines Lab / Tinker** (Mira Murati) — private-beta LoRA training API; Atropos is Nous' rollout coordinator that calls Tinker.
- Founder explicitly **deferred security gating** (Hermes ALLOW-ALL default, skill-poisoning, signed-provenance gaps) **to v3** since v0.0.1 → v2 are all internal/test.

## Strategic shift (founder's framing)

Quoting the founder, 2026-05-09:

> "We need to get a beta playground where we link all the upcoming good ideas, very early, primitive, with the product yet. We put them in the pipeline and test how they work and what they do so we learn ourselves. In the future, either we can adapt those or we can learn from them."

> "We might build the next Hermes or next OpenCLAW if we keep building and testing over the entire dev factory."

This isn't an evaluation effort — it's a **permanent capability**. The Lab is to *external tools* what `cognitive-engine/integration/composition-smoke.js` is to *internal modules*: a continuous regression net + comparison harness. With one critical extension: the Lab is the **launching pad for our own innovations** when external tools fall short.

## Architecture — Beta Playground

```
Research/                 playground/                 cognitive-engine/
─────────                 ───────────                 ─────────────────
Landscape scans   ──►   Hands-on profiles    ──►    Stable substrate
(what's out there)      (what we tried)              (what we adopted)
Evidence                 Hands-on data                Production-direction
```

Three-stage pipeline. Stage transitions are formal Decisions in `Phase_NN_Decisions.md`; nothing graduates without measurement. The Lab uses Phase 18-A's marketplace primitive — `category: "experimental"` (D188) — so adoption is a recategorisation, not a rewrite.

### Folder layout

```
agentryx-factory/
├── cognitive-engine/        ← stable substrate (16 A-tier modules)
├── playground/              ← NEW: Beta Playground
│   ├── README.md            ← what it is, how to add a tool, evaluation rubric
│   ├── PROFILE_TEMPLATE.md  ← copy when adding a profile
│   ├── runner.js            ← runs reference scenario stable + experimental variants
│   ├── profiles/
│   │   ├── hermes-agent/
│   │   ├── honcho/
│   │   ├── deep-agents/
│   │   ├── anthropic-agent-teams/
│   │   ├── thinking-machines-tinker/
│   │   └── ...
│   └── results/             ← per-run JSON: { tool, version, scenario, metrics }
└── pmd/.../Research/        ← landscape scans (already shipped)
```

### Profile lifecycle

```
watching ──► exploring ──► testing ──► adopting ──► (graduates to cognitive-engine/)
                              │
                              ├──► rejecting ──► (archived; PROFILE.md kept as institutional memory)
                              │
                              └──► parked ────► (paused; revisit on next monthly review)
```

Status changes are Decisions, not silent edits. Rejections are kept (the graveyard is the wisdom; future-us looking at the same tool again sees what we tried).

### Cadence — D187

- **Monthly review** (last Friday of each month): walk every active profile; bump status; add Learnings; decide whether to keep going, park, or graduate / reject.
- **Hard re-evaluation at every release-band cut** (v0.0.1 → v1, v1 → v2, v2 → v3): each profile must have a clear adopt / reject / continue verdict.
- **Drop-in welcome anytime**: alpha or beta tools can land between cadences.

## Scope for this phase (2.76 — closed in one session)

| Sub | What | Deliverable |
|---|---|---|
| 2.76.1 | `playground/` skeleton (README + PROFILE template + runner.js + results/) | ✅ |
| 2.76.2 | Marketplace `experimental` category added to ModuleCategory enum (D188) | ✅ |
| 2.76.3 | 5 initial profiles seeded: hermes-agent, honcho, deep-agents, anthropic-agent-teams, thinking-machines-tinker | ✅ |
| 2.76.4 | Phase 2.76 docs: Plan + Decisions (D181-D188) + Status + Lessons (skeletons) | ✅ |
| 2.76.5 | Master_Factory_Architect → r0.4 with new §1 release bands + §11.8 Beta Playground architecture | ✅ |
| 2.76.6 | 02_Current_Architecture, 04_B_Tier_Marathon, README, Dev_Task_list_Update refreshed | ✅ |

**Out of scope for 2.76 (deferred to monthly Lab reviews + future B-tier work)**:

- Real Hermes installation (Tier 1; first integration in next monthly review)
- Real Honcho installation (Tier 1; first integration in next monthly review)
- Tinker waitlist application (founder action; not engineering)
- Real adapter.js code per profile (added per profile when status → `testing`)
- Inspect AI / Mastra / DSPy / BAML profiles (Tier 2; next month)
- Tier 3 watch list profiles (research-only; profiles created when promoted)

## Why this scope is right

- **Marketplace's `experimental` category was the missing primitive.** Phase 18-A built the registry; Phase 2.76 names the experimental tier.
- **Composition smoke is already the reference scenario.** No need to invent a new evaluation harness.
- **Five profiles cover the high-leverage candidates** without committing to integration code we'd throw away if a profile is rejected.
- **Doc-trail-first.** The founder explicitly asked for the docs to be the durable context — Phase 2.76 ships the architecture, the rationale, the roster, and the cross-links *before* any integration code, so a future me-in-two-months reading these docs reconstructs the full strategy without chat history.

## Phase 2.76 close criteria

- ✅ `playground/` folder exists with README + PROFILE template + runner.js + results/
- ✅ Marketplace ModuleCategory enum extended (10 categories, includes "experimental")
- ✅ Marketplace smoke still passes (118 assertions; +1 for experimental)
- ✅ 5 profiles seeded with PROFILE.md + manifest.js (status: 4× exploring + 1× watching)
- ✅ Runner produces baseline JSON (73 assertions, ~370ms)
- ✅ Phase 2.76 docs: Plan + Decisions (D181-D188) + Status + Lessons (skeletons)
- ✅ Master_Factory_Architect → r0.4 with new §1 release bands + §11.8 Beta Playground
- ✅ 02_Current_Architecture refreshed (numbers + new §8 Beta Playground)
- ✅ 04_B_Tier_Marathon refreshed (v3-production schedule)
- ✅ Roadmap README + Dev_Task_list_Update refreshed
- ✅ Cross-phase composition smoke still passes (no regression in 16 modules)
- ✅ admin-substrate smoke still passes (41 assertions)
- ✅ Memory updated (project_agentryx_factory.md + new feedback memory for Lab strategy)
- ✅ Phase tag `phase-2.76-closed` pushed

## Decisions expected

D181 through D188 (8 decisions in this phase). See `Phase_2.76_Decisions.md`.
