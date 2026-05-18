# Phase 21 — Status: 21-A + 21-A.1 + 21-B + 21-B.2 COMPLETE ✅  (Phase 22 DEFERRED to v2→v3)

**Phase started**: 2026-05-09
**Phase 21-A closed**: 2026-05-09 (substrate)
**Phase 21-A.1 closed**: 2026-05-09 (Platform Evolution Roadmap + Founder R&D Brief + Seven onboarded — same day, same session, after founder direction during the 21-A close call)
**Phase 21-B closed**: 2026-05-09 (real LLM research dispatcher — Sonnet/Opus via the LLM router; opt-in via cadence/brief `dispatcher` field; same session)
**Phase 21-B.2 closed**: 2026-05-11 (architect cadence cycles run as Phase 14-A queue jobs under `USE_ARCHITECT_QUEUE=true` — crash-resilient + observable in Admin → Queue)
**Duration**: 21-A/.1/-B single session 2026-05-09; 21-B.2 single session 2026-05-11 (stacked on Phase 14-B Tier B)

## Phase 21-B.2 — what shipped (2026-05-11)

**`cognitive-engine/concurrency/handlers/architect-handler.js`** (new, ~170 lines):
- `runArchitectPass({A, kb, proposalStore, cadenceKind, cadenceConfig, pickDispatcher})` — extracted the per-cycle work (researcher/proposer/architect construction + `runPass` + optional report synthesis) out of `telemetry.mjs:runCadencePass`. Pure function; every dep injected; testable in isolation.
- `registerArchitectResearchHandler(registry, deps)` — registers an `architect_research` job kind on the Phase 14-A handler registry. Handler reads `job.payload.{cadence_kind, cadence_config}`, runs the pass, fires `onReportProduced(report)` if a report was synthesized.
- `ARCHITECT_RESEARCH_KIND` export — convenience constant for callers.
- onReportProduced thrown errors are caught + warned (don't fail the job).

**`bootQueueWorker` extension** in `factory-dashboard/server/telemetry.mjs`:
- Lazy-imports `architect-handler.js` alongside `factory-handlers.js`.
- After registering the 3 factory handlers, also loads architect + constructs a KB + proposal store, then registers `architect_research` with the same `pickDispatcher` selector + an `onReportProduced` hook that logs `👑 Architect cycle report ready (via queue): <id> (<cadence>)` and broadcasts.
- Wrapped in try/catch — a broken architect module shouldn't take down pipeline handlers.

**`bootCadenceDaemon.runCadencePass` enqueue path** (flag-gated):
- When `USE_ARCHITECT_QUEUE=true`, the daemon enqueues an `architect_research` job (`project_id: "architect"`, priority 30, max_attempts 1) instead of running the pass inline. Returns a sentinel `{pass: {id: "queued:<job_id>", queued: true}}` so the daemon's bookkeeping (`lastCadenceFire` timestamp) still records.
- Pipeline jobs (priority 50) preempt architect cycles — pre_dev / dev / post_dev get the worker slot first.
- `max_attempts: 1` — a failed cycle waits for the next cadence to retry rather than spinning. Cadence is the natural backoff.
- Enqueue failure → falls through to the inline path (fail-open: if the queue isn't healthy, the architect still runs).
- Default off → preserves Phase 21-A.1 inline behaviour. Flag flip is per-environment.

**Smoke test** — `cognitive-engine/concurrency/handlers/architect-handler.smoke.js`:
- **31 assertions** across 9 scenarios — runArchitectPass with report_enabled (full path), without report (no writeReport call), weekly (no Criteria section vs monthly), arg validation; registered handler kind + lookup; valid job → fires onReportProduced; report-disabled config → no onReportProduced; missing payload fields throw; onReportProduced throwing doesn't fail the job; dep validation
- All pass — no real architect / kb / dispatcher / queue needed (every dep stubbed)

**Why a flag and not a hard switch**:
- The inline path is battle-tested via Phase 21-A.1's daemon. The enqueue path is new. Default-off ships D217's posture: prove parity in production before retiring inline.
- Per-environment opt-in: founder can flip on the production VM after observing one or two enqueued cycles complete cleanly via Admin → Queue panel, while staging stays inline if desired.

## What stays for full 21-B.2 close-out

- **Flip flag in production** after observing one or two cycles complete via Admin → Queue. Decision is observational, not blocking.
- **Delete inline `runCadencePass` body** when the flag is permanently on. Today both paths exist; future cleanup.
- **Crash-recovery test**: kill telemetry mid-pass, restart, confirm the in-flight `architect_research` job is re-leased per Phase 14-A lease timeout. Needs an OpenRouter cycle to produce a job long enough to interrupt.

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

---

## Phase 21-A.1 — Platform Evolution Roadmap + Founder R&D Brief + Seven (added 2026-05-09)

Closed same session as 21-A. Founder articulated three additional needs during the close call that turned 21-A from substrate-only into a self-running R&D loop:

1. *"Standardize the cycle"* — autonomous loop should run on a schedule (not click-driven), like every healthy software platform's continuous-improvement track. Founder named the artifact: **Platform Evolution Roadmap**.
2. *"Founder-driven research is also a thing"* — separate tab + structured prompt form so a brief can be filed without leaving the Dev-Hub.
3. *"We need first-hand evaluation, not 2nd-hand opinions"* — a dedicated **Tool Evaluator** agent that benchmarks candidates, runs adversarial security probes, and produces structured reports. Star-Trek named: **Seven**.

### What shipped in 21-A.1

- **3 cadences** (daily / weekly / monthly), each independently toggleable, with per-cadence local time, day rule, budget cap, depth, dispatcher, and report toggle. Defaults: monthly ON, weekly + daily OFF — founder's stated preference.
- **Cadence daemon** embedded in `factory-telemetry.service` — ticks every 60s, IST-aware, last-Thursday cron math, dedupe via per-cadence fire log, survives `paused: true`.
- **Cycle hierarchy**: daily passes feed weekly synthesis feeds monthly strategic review (which includes a "criteria health check" — self-evolving priority-area set).
- **Founder R&D Brief tab** — 8-field structured-prompt form (title / role / background / research_question / trigger / constraints / output_format / references) + budget + priority-area tag. Composes into an Anthropic-style prompt, spawns a `founder_brief` pass, produces a structured Report linked back to the brief.
- **Reports & Proposals tab** — both cycle reports + brief reports listed, click-to-open modal viewer, unread badge per report, dashboard banner when reports pile up.
- **PresetSelect component** — 3 typed presets + Custom… escape hatch, used everywhere a dropdown lives (Role, Output format, Research depth, Dispatcher).
- **Pause/Resume toggle** — global switch on the page header.
- **Seven (Tool Evaluator)** — 12th named agent, first in the codebase with a `SOUL.md` identity file (per Hermes pattern). Distinct from Tuvok (tests our code) / Spock (researches) / Data (reviews architecture). Operating principles: evidence over impression, first-hand only, adversarial on security, reproducible. First mission queued: evaluate Hermes Agent v0.13.
- **Hermes Lab profile** promoted `exploring → testing` with Seven as evaluation owner.
- **`tool_evaluation` finding kind** added — distinct from `new-tool` (we observed it exists) — `tool_evaluation` means we measured it.

### Phase 21-A.1 close criteria — met

- ✅ Schema: `baseline.cadences` (3 entries) + `baseline.paused` + `baseline.timezone` + per-cadence config
- ✅ Cadence daemon (long-lived, 60s tick) + `shouldFireCadence` math + last-Thursday-of-month resolver (verified for May 2026 = May 28) + IST `partsInTz` helper
- ✅ Backend endpoints: `POST /brief`, `GET /briefs(/:id)`, `GET /reports(/:id)`, `POST /reports/:id/read`, `POST /pause`, `POST /resume`, `POST /cadence/:kind/run`
- ✅ Frontend: 3-tab refactor (Standing Orders & Roadmap / R&D Brief / Reports & Proposals) with new-report banner + 30s background poll
- ✅ `cognitive-engine/agents/Seven.SOUL.md` (first SOUL.md in the codebase) + Seven preset in BriefForm
- ✅ Hermes Lab profile bumped to `testing` + Learnings log entry on the strategic intent
- ✅ Standing Orders example.json bumped to include cadences + Seven + monthly Hermes-evaluate cadence note
- ✅ Architect smoke 87 → 89 (+2 for new pass kinds: `weekly`, `monthly`, `founder_brief`)
- ✅ Dashboard build clean (474KB / gzip 136KB)
- ✅ End-to-end backend smoke: `seed → brief submit → cadence run → reports list → mark read → pause → resume` all 200 OK
- ✅ `factory-telemetry.service` restarted, daemon booted with "first tick aligned to next minute boundary, period 60000ms"

### What stays for Phase 21-B

- Real Sonnet/Opus research dispatcher (today still synthetic stub — reports & briefs have correct shape, synthetic content)
- Auto-doc-update on proposal approval
- Slack / email notifications (in-dashboard banner shipped here)

### What stays for Phase 22

- Sandboxed runtime so Seven actually *runs* candidates in isolation (Hermes evaluation today is documentation+probe-based until then)
- Continuous monitoring loop (weekly re-runs to catch regression on adopted tools)

### Loose ends queued for follow-up

- **SOUL.md backfill** for the other 11 named agents (Picard / Sisko / Troi / Jane / Spock / Torres / Tuvok / Data / Crusher / O'Brien / Genovi). Seven was the first; the rest tracked as a single dedicated task (deferred — pure grunt work, perfect for a subagent later).

---

## Phase 21-B — Real LLM Research Dispatcher (closed 2026-05-09 same session)

When founder confirmed OpenRouter was ready, the long-deferred 21-B core shipped: a real LLM-backed dispatcher that replaces the stub when explicitly requested per cadence/brief.

### What shipped

**`cognitive-engine/architect/dispatchers/llm.js`** (new):
- `createLLMDispatcher({ dispatcher: 'sonnet' | 'opus' })` — drop-in replacement for `createStubDispatcher` (same I/O contract).
- Routes through `llm-router/src/router.js` `complete()`:
  - `sonnet` → `research` task (Gemini 2.5 Pro primary, Sonnet 4.6 fallback)
  - `opus` → `architect` task (Opus 4.7 primary, GPT-5 + Gemini 2.5 Pro fallbacks)
- Builds an Anthropic-style structured prompt from the area context (current_state / target_3mo / target_6mo / hard_constraints / anti_goals / directions / strategic_watch / kb_summary)
- Strict JSON output contract — parses model output into Findings; rejects malformed entries silently (fail-open per area)
- Tolerates code-fenced JSON for forgiving parsing
- Cost capture flows through the LLM router's `cost.js`
- Budget cap enforcement comes for free from the router (Phase 2E pre-call gate)

**`factory-dashboard/server/telemetry.mjs`**:
- `loadArchitect()` also imports the LLM dispatcher (fail-open: if module missing, falls back to stub silently)
- `pickDispatcher(A, dispatcherKey)` central helper at 4 dispatcher call sites (cadence daemon, manual run-pass, brief endpoint, manual cadence run)

### Default = stub (opt-in by design)

Three places must explicitly pick a real dispatcher to fire it:
1. Standing Orders → cadence config: `dispatcher: 'sonnet'` or `'opus'` for daily/weekly/monthly (founder edits via Master Architect UI)
2. R&D Brief: include `dispatcher: 'sonnet'` in body
3. Manual run-pass: include `dispatcher: 'sonnet'` in body

Today every cadence + brief defaults to `stub`. Real LLM calls fire only when the founder turns on a specific cadence's dispatcher in the Standing Orders editor.

### Safety

- Budget caps: per-call via LLM router (project + daily); per-cadence via `cadenceConfig.budget_usd`
- Failure isolation: per-area errors caught + recorded in `by_area[id].error`; other 5 areas continue
- Fail-open at dispatcher layer: LLM module missing or LLM call erroring → fall back to empty findings, log warning, don't crash the pass
- JSON validation: malformed model output dropped per-finding (not per-pass)

### What stays for later (not 21-B core)

- Phase 11-A pre-flight whole-pass budget gate (router has per-call; architect could pre-flight 6-area total)
- Phase 10-A Courier "approval needed" pings on real proposals (in-dashboard banner ships today)
- Phase 22 sandbox enforcement (Seven's actual benchmarking + sandboxed runs)
