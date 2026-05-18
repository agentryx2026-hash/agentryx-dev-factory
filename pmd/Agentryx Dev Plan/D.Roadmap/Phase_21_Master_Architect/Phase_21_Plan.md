# Phase 21 — Master Architect (Autonomous Continuous Research)

**Founder request**: 2026-05-09 — after Phase 2.76 closed, founder articulated the next architectural axis: the factory must continuously look for tool updates and new tools that improve the dev factory itself. Two parts:

1. **Autonomous architect**: at startup + every 24h, the factory goes out and updates its knowledge base. Findings flow into proposals; founder approves. Direction reverses — *proposals come from the architect to the founder*, not the other way around.
2. **Standing Orders** (the founder's permanent directive to the architect): two sections matching two UI tabs. Tab 1 `baseline` is what the architect does autonomously (cron, budget, dispatcher, auto-watch toggle). Tab 2 `custom_direction` is the founder's structured steering — 6 priority areas + overall stance + strategic watch.

Plus: a related-but-separate concern called out — pipeline action-boundary enforcement ("nothing outside the process flow") — which we record as Phase 22 in the roadmap and defer the enforcement to v3 per existing security gating posture (D185 + D189).

## Context — what's already in place

Per Phase 4 Lesson #1 + `03_Scaffolding_Pattern.md`, ~80% of the substrate exists:

- **Phase 14-A** concurrency queue + worker pool → cron substrate already shipped
- **Phase 15-A** self-improvement proposal lifecycle (state machine + applier) → architect plugs in 3 new kinds
- **Phase 7-A** memory layer → KB extends this with structured types
- **Phase 18-A** marketplace → tool catalogue (the things to monitor)
- **Phase 11-A** cost-tracker → per-pass budget gating
- **Phase 12-A** admin substrate → audit log + role gating
- **Phase 2.76** Beta Playground → external tool surface where architect proposes profiles
- **Phase 10-A** Courier → notification path for "approval needed" pings

What's genuinely new: the **Master Architect agent** (orchestrator), the **structured Knowledge Base**, the **Standing Orders** (Tab 1 `baseline` + Tab 2 `custom_direction` with 6 priority areas + overall stance + strategic watch, ~60 fillable slots in Tab 2), and the **Founder Proposal Portal** (read-only listing API; UI in 12-B / 21-B).

## Design

```
                  ┌──────────────────────────┐
                  │  standing_orders.json    │  ← founder edits
                  │  ─────────────────────   │
                  │  Tab 1 baseline:         │     baseline: quarterly
                  │   cron / budget / disp.  │     custom_direction: monthly
                  │   auto_watch toggles     │
                  │  Tab 2 custom_direction: │
                  │   6 weighted areas +     │
                  │   overall stance +       │
                  │   strategic watch        │
                  └──────────┬───────────────┘
                             │
                  ┌──────────▼───────────────┐
                  │  Master Architect        │
                  │  ─────────────────────   │
                  │  • boot pass (startup)   │
                  │  • daily cron (baseline) │
                  │  • priority-update pass  │
                  │    (on version bump)     │
                  └──────────┬───────────────┘
                             │
              ┌──────────────┼─────────────────┐
              ▼              ▼                 ▼
        ┌─────────┐   ┌──────────────┐   ┌─────────────┐
        │ KB      │   │ Researcher   │   │ Proposer    │
        │ (kb.js) │   │ priority-    │   │ 3 new kinds │
        │         │   │ weighted     │   │ tool_adopt  │
        │targets  │   │ subagent     │   │ kb_update   │
        │gaps     │   │ dispatch     │   │ res_finding │
        │findings │   │ ($2/pass)    │   │             │
        │passes   │   │              │   │             │
        └─────────┘   └──────────────┘   └──────┬──────┘
                                                │
                              ┌─────────────────▼─────────┐
                              │  Phase 15-A proposal store│
                              │  + applier (D192 routing) │
                              └─────────────────┬─────────┘
                                                │
                              ┌─────────────────▼─────────┐
                              │  Founder Proposal Portal  │
                              │  (portal.js; 12-B UI)     │
                              │  approve/reject           │
                              └───────────────────────────┘
```

## Standing Orders — two-tab structure (D194)

Standing Orders has two sections, mapping to two UI tabs:

- **Tab 1 / `baseline`** — autonomous behavior knobs (cron schedule, daily budget cap, research depth, dispatcher, auto-watch). Founder edits rarely (quarterly when ops change). Missing fields fall back to `DEFAULT_BASELINE`.
- **Tab 2 / `custom_direction`** — founder-edited steering. Edited monthly. Contains `effective_period`, `overall_stance` (4 fields), `priority_areas` (6 weighted entries × 8 fields each), `strategic_watch` (founder additions on top of Tab 1's auto-curated list), and free-form `notes`.

Validator is intentionally loose during 21-A: only `version` and `custom_direction.priority_areas` (exactly 6, valid ids, weights 1-5) are strictly enforced. Everything else has sensible defaults applied at read time.

### Tab 2 — six priority areas

Founder steers via 6 weighted content areas, each with 8 fields (weight, current_state, target_3mo, target_6mo, hard_constraints, anti_goals, research_directions, notes):

| Area | What it controls |
|---|---|
| `models` | LLM tier strategy, cost/quality posture, fine-tuning |
| `agents` | Named pipeline agents + new candidates |
| `languages` | Code/output stacks the factory produces |
| `tools` | MCP plane, external integrations, IDE tooling |
| `output_quality` | Tuvok rigor, Data review, Verify cycle |
| `operations` | Cost / speed / throughput / deployment |

Plus the rest of Tab 2:
- `overall_stance` (risk_appetite × quality_vs_speed × cost_sensitivity × change_tolerance)
- `strategic_watch` (named orgs/products with watch_frequency — adds onto Tab 1's auto-curated list)
- `effective_period` (start_date / end_date / horizon_label)
- `notes` (free-form architect-visible context)

Total: 48 priority-area slots + ~12 meta = **~60 fillable fields in Tab 2** (Tab 1 adds ~6 baseline knobs).

## Three new proposal kinds (D190; extends Phase 15-A)

| Kind | Auto-approve? | Used for |
|---|---|---|
| `tool_adoption` | NO — founder-gated | Add/upgrade/swap a tool (stable or playground) |
| `kb_update` | YES (low-stakes) | Add/update Target / Gap entries |
| `research_finding` | YES (information-only) | Raw observation worth recording |

Phase 15-A's original 4 kinds are unchanged. Same lifecycle, same store, same audit log.

## Scope for this phase (21-A: substrate)

| Sub | What | Deliverable |
|---|---|---|
| 21-A.1 | `architect/types.js` — StandingOrders { baseline, custom_direction } + Target/Gap/Finding/ResearchPass/KBState shapes; loose validator + baseline defaults; `computeAttentionBudget` | ✅ |
| 21-A.2 | `architect/kb.js` — knowledge base store; Standing Orders CRUD + history (`writeStandingOrders` / `readStandingOrders` / `readBaseline` / `readCustomDirection`); targets/gaps/findings/passes; roadmap snapshot; summary | ✅ |
| 21-A.3 | `architect/scheduler.js` — boot + daily cron driven by `baseline.cron_schedule` + version-watermark detector; DI'd enqueue; test-clock | ✅ |
| 21-A.4 | `architect/researcher.js` — priority-weighted dispatcher reading `custom_direction.priority_areas`; per-area failure isolation; `createStubDispatcher` for tests | ✅ |
| 21-A.5 | `architect/proposer.js` — classifies findings into 3 kinds; builds Phase 15-A drafts; applier hook (`createArchitectApplier`) | ✅ |
| 21-A.6 | `architect/architect.js` — orchestrator: read Standing Orders → start pass → research → ingest findings → emit proposals | ✅ |
| 21-A.7 | `architect/portal.js` — Founder Portal API (overview / list / detail / approve / reject) | ✅ |
| 21-A.8 | `architect/standing_orders.template.yaml` + `standing_orders.example.yaml` (seeded from current roadmap state) | ✅ |
| 21-A.9 | Phase 15-A extensions: 3 new ProposalKind enum values + applier routing via `ctx.architectApplier` | ✅ |
| 21-A.10 | Smoke test — 87 assertions across 8 test groups | ✅ |
| 21-A.11 | `architect/README.md` + `USE_AUTONOMOUS_ARCHITECT` flag | ✅ |
| 21-B | Real Sonnet-backed researcher; Phase 14-A queue handler; Phase 12-B Founder Portal UI; Phase 11-A budget gate; Phase 10-A Courier notifications | ⏳ DEFERRED |

> **Naming clarification**: rows 21-A.1 → 21-A.11 above are *sub-deliverables of phase 21-A*. The post-substrate ship (Platform Evolution Roadmap + Founder R&D Brief + Seven), shipped same day as 21-A close, is tracked separately as the **Phase 21-A.1 sub-phase** below.

## Phase 21-A.1 sub-phase — Platform Evolution Roadmap + Founder R&D Brief + Seven (added 2026-05-09 same session)

After 21-A close, founder articulated three more needs that turned the substrate into a self-running R&D loop. Closed same session.

| Sub | What | Deliverable |
|---|---|---|
| 21-A.1.1 | `types.js` Cadence types + validators + IST tz `partsInTz` + `resolveMonthlyDay` (last-Thursday math) + `shouldFireCadence` dedupe + `validateBrief` + `validateCadence` | ✅ |
| 21-A.1.2 | `kb.js` Brief CRUD + Report CRUD + `recordCadenceFire` / `lastCadenceFire` + `markReportRead` / `unreadReportCount` | ✅ |
| 21-A.1.3 | `scheduler.js` `createCadenceDaemon` — long-lived 60s tick loop, IST-aware, dedupe via per-cadence fire log, survives `paused: true` | ✅ |
| 21-A.1.4 | `brief.js` (new) — `composeBriefPrompt` (Anthropic-style structured prompt) + `runBrief` (orchestrates brief → pass → report) | ✅ |
| 21-A.1.5 | Backend endpoints: `POST /brief`, `GET /briefs(/:id)`, `GET /reports(/:id)`, `POST /reports/:id/read`, `POST /pause`, `POST /resume`, `POST /cadence/:kind/run` + daemon boot at server start | ✅ |
| 21-A.1.6 | `MasterArchitect.tsx` 3-tab refactor (Standing Orders & Roadmap / R&D Brief / Reports & Proposals) + new-report banner + 30s background poll | ✅ |
| 21-A.1.7 | `architect/PresetSelect.tsx` — 3 typed presets + Custom… escape hatch (founder UX direction) | ✅ |
| 21-A.1.8 | `architect/BriefForm.tsx` — 8-field structured-prompt form + budget + priority-area tag | ✅ |
| 21-A.1.9 | `cognitive-engine/agents/Seven.SOUL.md` (first SOUL.md in codebase) + `tool_evaluation` finding kind + Seven preset in BriefForm | ✅ |
| 21-A.1.10 | `playground/profiles/hermes-agent/PROFILE.md` promoted `exploring → testing` + Seven named as evaluation owner + Learnings log entry | ✅ |
| 21-A.1.11 | `standing_orders.example.json` bumped: cadences + Seven in agents area + monthly Hermes-evaluate cadence note | ✅ |
| 21-A.1.12 | Architect smoke updated 87 → 89 (new pass kinds: `weekly` / `monthly` / `founder_brief`) | ✅ |

**21-A.1 close criteria — met**: see Phase_21_Status.md.

**Out of scope for 21-A** (deferred to 21-B / 22):

- Real LLM-backed research subagent (stub only in 21-A; needs OpenRouter + web-search MCP)
- Actual cron daemon (scheduler ships; no long-lived process running it yet)
- Phase 14-A queue handler registration (logic ready; handler not registered)
- Phase 12-B admin UI (portal API ships; UI is 12-B's scope)
- Phase 11-A pre-flight cost gate
- Phase 10-A Courier "approval needed" notifications
- **Pipeline action-boundary enforcement** — its own Phase 22 (deferred to v3 boundary per D185+D189)

## Why this scope is right

- **The KB is durable context**, not just a feature: aligns with the founder's explicit "doc-trail must be the durable context" directive (Phase 2.76 lessons).
- **Reusing Phase 15-A's lifecycle** means the founder portal already has approve/reject + audit trail + state machine. We just plug in 3 new kinds.
- **Phase 14-A queue handles cron** without a new scheduler primitive; we DI the enqueue function.
- **Stub dispatcher in 21-A** keeps the substrate at \$0 cost, deterministic, and offline-capable. Same A-tier discipline as Phases 15-A / 16-A / 17-A.
- **Standing Orders is YAML** for editor-friendliness; `_kb/standing_orders.json` is the runtime form (architect reads JSON, founder may author in YAML and convert via editor or `yq -o=json`). Two-tab structure mirrors the planned 12-B / 21-B UI exactly so the schema and the editor map 1:1.

## Decisions expected

D190 (3 new proposal kinds extending Phase 15-A) · D191 (KB is JSONL-backed, structured but not relational) · D192 (architect applier wired through Phase 15-A `applyProposal(ctx.architectApplier)`) · D193 (scheduler enqueues onto Phase 14-A queue; DI'd; reads `baseline.cron_schedule`) · D194 (Standing Orders has two sections — Tab 1 `baseline` + Tab 2 `custom_direction`; loose validator) · D195 (append-only JSONL for Targets/Gaps/Findings/Passes; replay-the-log mutation semantics) · D196 (Founder Portal API thin layer over store + KB; UI in 12-B/21-B) · D197 (researcher dispatches priority-weighted with per-area failure isolation) · D198 (proposals tagged with priority_area + weight in rationale.meta) · **D199** (Phase 22 — Action Boundary Enforcement — separate phase deferred to v3 boundary)

## Phase 21-A close criteria

- ✅ `architect/` scaffolded (types + kb + scheduler + researcher + proposer + architect + portal + smoke + README)
- ✅ Phase 15-A `ProposalKind` enum extended with 3 new kinds; smoke +3 assertions
- ✅ Phase 15-A applier routes new kinds via `ctx.architectApplier`; refuses without context
- ✅ KB JSONL stores: targets / gaps / findings / passes / standing_orders + history / roadmap snapshot
- ✅ Standing Orders schema (YAML template + example seeded from current state) — Tab 1 `baseline` + Tab 2 `custom_direction`
- ✅ Scheduler: boot pass + daily cron driven by `baseline.cron_schedule` + version-watermark detector; DI'd enqueue
- ✅ Researcher: priority-weighted (reads `custom_direction.priority_areas`); per-area failure isolation; stub dispatcher
- ✅ Architect orchestrator end-to-end; missing Standing Orders → graceful skip
- ✅ Founder Portal API: overview / listProposals / getProposalDetail / approve / reject
- ✅ **87 architect smoke-test assertions all pass**
- ✅ Phase 15-A smoke still green (90 assertions; was 87, +3 for new kinds)
- ✅ `USE_AUTONOMOUS_ARCHITECT` flag registered in admin-substrate
- ✅ No regression in marketplace / admin-substrate / composition smokes
- ✅ Phase docs: Plan (this file) + Decisions D190-D199 + Status + Lessons
- ⏳ 21-B real LLM researcher + cron daemon + 12-B UI + Phase 14 handler + Phase 11 budget gate + Phase 10 notifications deferred
