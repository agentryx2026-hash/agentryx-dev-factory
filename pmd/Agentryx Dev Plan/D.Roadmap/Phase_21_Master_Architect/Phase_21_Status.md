# Phase 21 — Status: 21-A COMPLETE ✅  (21-B + Phase 22 DEFERRED)

**Phase started**: 2026-05-09
**Phase 21-A closed**: 2026-05-09
**Duration**: single session (immediately after Phase 2.76 close)

## What shipped

### `cognitive-engine/architect/types.js` (new, ~350 lines)
- `StandingOrders` schema with two sections (D194):
  - Tab 1 / `baseline` — cron_schedule, daily_budget_usd, research_depth, research_dispatcher, auto_watch_enabled, auto_watch_disabled_ids
  - Tab 2 / `custom_direction` — effective_period, overall_stance, priority_areas (exactly 6), strategic_watch, notes
- `Target`, `Gap`, `Finding`, `ResearchPass`, `KBState` shapes
- 6 priority areas: `models` / `agents` / `languages` / `tools` / `output_quality` / `operations` (D194)
- 4 pass kinds: `boot` / `daily` / `manual` / `founder_priority_update`
- 5 target statuses; 3 gap statuses; 5 finding kinds
- 3 risk-appetite × 3 quality-vs-speed × 3 cost-sensitivity × 3 change-tolerance × 3 research-depth enum sets
- `DEFAULT_BASELINE` constant + `applyBaselineDefaults()` — every missing baseline field gets default
- `validateStandingOrders()` — loose validator; only `version` + `priority_areas` shape strictly enforced; soft validation logs but doesn't fail for stance/depth typos
- `computeAttentionBudget()` — reads `custom_direction.priority_areas` weights → fractions summing to 1.0

### `cognitive-engine/architect/kb.js` (new, ~360 lines)
- `createKnowledgeBase(rootDir)` returns store with:
  - Standing Orders CRUD + history (`writeStandingOrders` / `readStandingOrders` / `readBaseline` / `readCustomDirection` / `readStandingOrdersHistory`)
  - Targets (`addTarget` / `listTargets` / `updateTarget`) — append-only with replay-the-log read
  - Gaps (`addGap` / `listGaps` / `resolveGap`)
  - Findings (`appendFinding` / `listFindings`) — append-only
  - Passes (`startPass` / `finishPass` / `listPasses`)
  - Roadmap snapshot (`writeRoadmapSnapshot` / `readRoadmapSnapshot`)
  - `summary()` — KBState rollup including `findings_by_area`
- Layout under `<workspace>/_kb/`: standing_orders.json + standing_orders_history.jsonl + targets + gaps + findings + passes + roadmap_snapshot + _seq

### `cognitive-engine/architect/scheduler.js` (new, ~155 lines)
- `createScheduler({ enqueue, readBaselineAndVersion, config, now })`
- Boot pass (run_on_boot toggle) + daily cron driven by Standing Orders `baseline.cron_schedule` (hour_utc / minute_utc)
- Standing Orders version watermark polling (60s interval; triggers `founder_priority_update` pass on bump)
- `triggerManual` for ad-hoc passes
- DI'd enqueue contract for Phase 14-A queue integration; test-clock support

### `cognitive-engine/architect/researcher.js` (new, ~150 lines)
- `createResearcher({ dispatchSubagent, budget_usd_per_pass })`
- Priority-weighted budget allocation across 6 areas
- Per-area failure isolation; failed areas captured in `by_area[id].error`; other 5 continue
- Findings stamped with `priority_area` + `produced_by` + `produced_at`
- `createStubDispatcher` — deterministic test dispatcher; produces `info`-kind findings; \$0 cost

### `cognitive-engine/architect/proposer.js` (new, ~155 lines)
- `createArchitectProposer({ proposalStore, kb })`
- Classifies findings into 3 architect-owned proposal kinds:
  - `info` / `security` → `research_finding`
  - `upgrade-available` / `new-tool` / `deprecation` → `tool_adoption`
- Builds Phase 15-A drafts with `rationale.meta.priority_area + sources + finding_kind`
- `createArchitectApplier({ kb, marketplace })` — Phase 15-A `applyProposal(ctx.architectApplier)` hook (D192)

### `cognitive-engine/architect/architect.js` (new, ~155 lines)
- `createArchitect({ kb, researcher, proposer })`
- End-to-end orchestrator: read Standing Orders → start pass → research (with `custom_direction` weights) → ingest findings → auto-create Targets for new-tool findings → emit proposals → finish pass
- Graceful skip when Standing Orders missing or `custom_direction.priority_areas` empty
- Baseline defaults applied via `applyBaselineDefaults` when `baseline` partial
- Proposer-failure handling: pass marked `partial` instead of full fail

### `cognitive-engine/architect/portal.js` (new, ~95 lines)
- `createFounderPortal({ proposalStore, kb })`
- `overview()` — proposal counts by kind/state, KB summary, Standing Orders version + horizon label, recent passes
- `listProposals({ kind, state, priority_area, limit })` — filterable, newest-first
- `getProposalDetail(id)` — proposal + linked findings + target context
- `approve` / `reject` — thin wrappers over Phase 15-A store

### `cognitive-engine/architect/standing_orders.template.yaml` + `.example.yaml` (new)
- Schema-source-of-truth template (commented + structured) — two-tab layout (`baseline` + `custom_direction`)
- Realistic v1 example seeded from current roadmap state (post-Phase 2.76); 6 areas filled with current_state and 3-month/6-month targets that map onto the v0.0.1 → v3 schedule; `strategic_watch` includes Anthropic, Thinking Machines (Mira Murati), Tinker, Nous Research, Hermes Agent, OpenAI, LangChain, Vercel, Linux Foundation AAIF
- Renamed mid-session from `founder_priorities.{template,example}.yaml` per founder confirmation 2026-05-09 (D194)

### `cognitive-engine/architect/smoke-test.js` (new, ~440 lines)
- **87 assertions across 8 test groups** (after Standing Orders restructure):
  - types: 6 areas + 4 pass kinds + budget compute + loose validator paths
  - kb basics: Standing Orders CRUD + history; targets create/list/filter/update + invalid status; gaps create/resolve; passes start/finish/list; findings filter; roadmap snapshot; summary aggregation
  - kb validation: invalid Standing Orders / target / gap / finding kind all rejected
  - scheduler: boot enqueue; manual trigger; no-boot mode; baseline cron read
  - researcher: 12 findings across 6 areas × 2; failure isolation; per-area errors captured
  - proposer + applier: 3 proposals from 3 findings; tool_adoption + research_finding shapes; Phase 15-A applier routing via ctx.architectApplier; refusal without ctx
  - architect orchestrator: end-to-end boot pass; KB state reflects findings; missing Standing Orders → graceful skip
  - founder portal: overview + filtered listProposals + detail with findings

### `cognitive-engine/architect/README.md` (new)
- Status, file index, layout diagram, **two-tab Standing Orders structure (Tab 1 baseline / Tab 2 custom_direction)**, 6-area table, 3-kind table, lifecycle diagram, API quickstart, applier wiring example, smoke summary, decisions, 21-B/22 preview

### `cognitive-engine/self-improvement/types.js` (modified)
- `PROPOSAL_KINDS` extended 4 → 7 (added `tool_adoption`, `kb_update`, `research_finding`)
- `ProposalKind` JSDoc updated with discriminator-target conventions

### `cognitive-engine/self-improvement/applier.js` (modified)
- `applyProposal` switch extended with cases for the 3 new kinds (D192)
- Routes via `ctx.architectApplier.apply(...)`; refuses with clear error if context missing

### `cognitive-engine/self-improvement/smoke-test.js` (modified)
- Assertion count bumped 87 → 90 (`PROPOSAL_KINDS.length === 7` + 2 includes-checks for new kinds)

### `cognitive-engine/admin-substrate/registry.js` (modified)
- Added `USE_AUTONOMOUS_ARCHITECT` feature flag (15 total now)
- Admin smoke test updated (14 → 15 flags)

### `pmd/.../Phase_21_Master_Architect/` (new)
- Phase_21_Plan.md (this phase's scope, design, decisions list, exit criteria)
- Phase_21_Decisions.md (D190-D199 — 10 decisions)
- Phase_21_Status.md (this file)
- Phase_21_Lessons.md (post-mortem learnings)

## Smoke test status (regression)

- `cognitive-engine/architect/smoke-test.js` — **87 assertions pass** (new)
- `cognitive-engine/self-improvement/smoke-test.js` — **+3 assertions** for new proposal kinds
- `cognitive-engine/admin-substrate/smoke-test.js` — pass (flag count 14 → 15)
- `cognitive-engine/marketplace/smoke-test.js` — unchanged
- `cognitive-engine/integration/composition-smoke.js` — unchanged
- `playground/runner.js` — baseline OK

**Cumulative count**: 1021 (pre-Phase-21) + 87 (new architect) + 3 (self-improvement extension) = **1111 total** at \$0 cumulative LLM spend.

## What 21-A deliberately did NOT ship

- **Real Sonnet-backed research subagent** — 21-A ships only the stub dispatcher. Real LLM-backed research lands in 21-B (needs OpenRouter credit; ~\$1-2/day target).
- **Long-lived cron daemon** — scheduler logic ships, but no process holds the timer. 21-B wires this via systemd / cron / Phase 14-A handler.
- **Phase 14-A queue handler registration** (`register("architect_research", handler)`) — the architect orchestrator can be called directly in 21-A; queue wiring is 21-B.
- **Phase 12-B Admin UI** — portal API ships; UI is 12-B's scope.
- **Phase 11-A pre-flight cost gate** — budget cap can be passed to researcher; no enforcement until 11-B + 21-B integration.
- **Phase 10-A Courier "approval needed" notifications** — proposals land in store; no notification dispatch yet.
- **Action Boundary Enforcement** — separate Phase 22; deferred to v3 boundary per D185 + D189 + D199.

## Why 21-B + Phase 22 deferred

21-B = production wiring; Phase 22 = security hardening. Both need infrastructure (OpenRouter credit, systemd / cron, admin UI, sandbox runtimes, signed manifests) that exceeds A-tier scope. Both have explicit blocker dependencies that aren't gated on Phase 21 work.

Ship 21-A as the firm substrate. 21-B layers production wiring on a tested contract; Phase 22 layers security enforcement at the v3 boundary.

## Phase 21-A close criteria — met

- ✅ `architect/` scaffolded (10 files: types, kb, scheduler, researcher, proposer, architect, portal, smoke-test, README, + standing_orders.{template,example}.yaml)
- ✅ Phase 15-A `ProposalKind` enum extended with 3 new kinds; smoke +3 assertions
- ✅ Phase 15-A applier routes new kinds via `ctx.architectApplier`; refuses without context
- ✅ KB JSONL stores: targets / gaps / findings / passes / standing_orders + history / roadmap snapshot
- ✅ Standing Orders schema (YAML template + example seeded from current state) — Tab 1 `baseline` + Tab 2 `custom_direction`; loose validator
- ✅ Scheduler: boot pass + daily cron driven by `baseline.cron_schedule` + Standing Orders version watermark detector; DI'd enqueue
- ✅ Researcher: priority-weighted via `custom_direction.priority_areas`; per-area failure isolation; stub dispatcher \$0 cost
- ✅ Architect orchestrator end-to-end; missing Standing Orders → graceful skip
- ✅ Founder Portal API: overview / listProposals / getProposalDetail / approve / reject
- ✅ **87 architect smoke-test assertions pass**
- ✅ Phase 15-A smoke green (+3 for new kinds)
- ✅ Admin-substrate smoke green (flag count 14 → 15)
- ✅ Marketplace + composition + playground smokes unchanged
- ✅ `USE_AUTONOMOUS_ARCHITECT` flag registered with correct owning phase
- ✅ Phase docs: Plan + Status + Decisions (D190-D199)
- ⏳ 21-B real LLM researcher + cron daemon + 12-B UI + Phase 14 handler + Phase 11 budget gate + Phase 10 notifications deferred
- ⏳ Phase 22 Action Boundary Enforcement deferred to v3 boundary

Phase 21-A is **wired, tested, and ready**. The Master Architect is permanent infrastructure now; **Standing Orders** is the founder's permanent directive (Tab 1 baseline / Tab 2 custom_direction, ~60 fillable slots); 21-B brings the architect alive at \$1-2/day.
