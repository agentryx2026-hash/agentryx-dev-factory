# Phase 21 — Decisions Log

10 decisions establishing the Master Architect capability + Standing Orders (the founder's permanent directive, two-tab structure) + the Phase 22 follow-up for action-boundary enforcement.

---

## D190 — Three new proposal kinds extend Phase 15-A; same lifecycle, same store

**What**: `cognitive-engine/self-improvement/types.js::PROPOSAL_KINDS` extended from 4 to 7. New values: `tool_adoption`, `kb_update`, `research_finding`. Same state machine (`draft → evaluating → ready → approved → applied`), same store (`createProposalStore`), same audit log. Architect-owned applier hook routes the 3 new kinds via `ctx.architectApplier.apply(...)` when invoked through Phase 15-A's `applyProposal`.

**Why**:
- Reusing Phase 15-A's lifecycle gives the architect a free founder-approval gate, a free audit trail, and a free state machine. Building a parallel pipeline would have been months of work with the same outcome.
- The Founder Portal (D196) becomes a filter over the same proposal list — `where rationale.meta.source === "autonomous_research"` — rather than a separate datastore.
- Phase 15-A self-improvement smoke gains +3 assertions (verifying the 3 new kinds are valid and listed). 87 → 90.

**Tradeoff**: the proposal store now has heterogeneous payloads. Mitigation: `change.target` discriminator (`agent:` / `task:` / `config:` / `tool:` / `kb:`) makes routing trivial; the applier dispatches by kind first.

## D191 — KB is JSONL-backed, structured but not relational

**What**: Knowledge Base storage uses the same append-only JSONL pattern as 14×-proven A-tier modules. Targets / Gaps / Findings / Passes are JSONL files; Standing Orders is a JSON document with an append-only `standing_orders_history.jsonl` log. Roadmap snapshot is a single JSON file refreshed each pass. No SQLite, no Postgres, no vector store.

**Why**:
- **Pattern consistency**: every A-tier module uses JSONL. Ops debugging tools (`ls`, `cat`, `jq`) work uniformly.
- **Replay-the-log mutation semantics**: `kb.updateTarget` appends a new row instead of modifying in place. List operations build latest-state by replaying the log. Same approach as Phase 15-A proposal transitions. Standing Orders itself is overwrite-then-append-history (current state in `standing_orders.json`, prior versions in `standing_orders_history.jsonl`).
- **Sufficient at R&D scale**: target count, gap count, and finding count grow on the order of dozens per week, not millions. Performance is not a concern until v2 / v3.
- **Sqlite/postgres/vector backends remain available**: Phase 7-B/C/D defer the same backends for the memory layer; KB can adopt the same pattern when scale demands.

**Tradeoff**: cross-record queries (e.g., "find all findings about Hermes from the last 30 days") scan the file. Acceptable; in 21-B the architect runs daily so the working set is small.

## D192 — Architect applier wired through Phase 15-A `applyProposal(ctx.architectApplier)`

**What**: Phase 15-A's `applyProposal(proposal, ctx)` was extended with new switch cases for `tool_adoption`, `kb_update`, `research_finding`. Each calls `ctx.architectApplier.apply(proposal, ctx)`. Without `ctx.architectApplier`, the applier throws a clear error refusing to apply architect-owned kinds.

**Why**:
- **Composable architecture**: Phase 15-A applier handles factory-internal changes (prompt/model/config/graph); architect applier handles KB + marketplace + playground changes. Single entry point (`applyProposal`); discriminated routing.
- **Testable in isolation**: smoke tests demonstrate both the routing path (with ctx) and the refusal path (without ctx). 4 new assertions in self-improvement smoke + 9 in architect smoke verify it.
- **Future-proof**: the same pattern lets us add more proposal-kind owners (e.g., a "marketplace-owned" kind for publisher-proposed updates) without changing Phase 15-A's applier signature.

**Tradeoff**: callers must explicitly construct + pass the architect applier. Mitigation: `architect.runPass()` orchestrator does this internally; only direct callers of `applyProposal` need to wire it.

## D193 — Scheduler enqueues onto Phase 14-A queue; DI'd enqueue contract

**What**: `architect/scheduler.js` exposes `createScheduler({ enqueue, readBaselineAndVersion, config, now })`. The `enqueue` function is dependency-injected; in production it adds an `architect_research` job to the Phase 14-A queue, in tests it pushes onto an in-memory list. The scheduler reads `baseline.cron_schedule` from Standing Orders on each fire so changing the schedule is just a Standing Orders edit (no restart).

**Why**:
- **No new scheduler primitive**: Phase 14-A queue + worker pool is already production-grade with round-robin fairness. The scheduler just *triggers* jobs; the queue *runs* them.
- **Test ergonomics**: smoke tests inject a fake enqueue and assert which pass kinds got triggered. No real timer-based flakiness.
- **Founder priority-version polling**: scheduler holds a watermark of the last-seen Standing Orders `version`. When founder bumps it, scheduler enqueues a `founder_priority_update` pass within 60 seconds.
- **Schedule lives in Standing Orders Tab 1**: the cron `hour_utc` / `minute_utc` are part of the `baseline` section, so the same UI that controls everything else autonomous controls the schedule too.

**Tradeoff**: 21-A doesn't actually run the daily cron — the scheduler logic ships, but no long-lived process holds the timer. 21-B wires this up via systemd / cron / a daemon.

## D194 — Standing Orders has two sections (Tab 1 baseline + Tab 2 custom_direction); loose validator

**What**: The factory's permanent directive is called **Standing Orders** (founder confirmation 2026-05-09; Star Trek-naming consistent with Picard/Sisko/Troi/etc.). Two sections matching two UI tabs:

- **Tab 1 / `baseline`** — what the architect does autonomously: cron schedule (hour/minute UTC), daily budget cap, research depth, dispatcher choice, auto-watch toggle + disabled-ids list. Founder edits rarely (quarterly when ops change). Missing fields fall back to `DEFAULT_BASELINE`.
- **Tab 2 / `custom_direction`** — founder-edited steering: `effective_period`, `overall_stance` (4 sub-fields), `priority_areas` (exactly 6 entries, one per id `models` / `agents` / `languages` / `tools` / `output_quality` / `operations`, each with 8 fields — weight 1-5, current_state, target_3mo, target_6mo, hard_constraints, anti_goals, research_directions, notes), `strategic_watch` (founder additions on top of Tab 1's auto-curated list), and free-form `notes`. Founder edits monthly. ~60 fillable slots.

Validator is intentionally loose during 21-A: only `version` (positive integer) and `custom_direction.priority_areas` (exactly 6, valid ids, weights 1-5) are strictly enforced. Everything else is optional with sensible defaults applied at read time so partial / evolving Standing Orders still work.

YAML for editor-friendliness; `_kb/standing_orders.json` is the runtime form (architect reads JSON; founder may author in YAML and convert via editor or `yq -o=json`).

**Why**:
- **Two-tab split mirrors the cognitive split**: "what the architect does on its own" (baseline ops) vs. "what the founder biases the architect toward" (custom direction). The schema and the planned UI map 1:1.
- **Six priority areas is the right cardinality**: fewer than 6 collapses too many concerns (e.g., quality + speed + cost into "operations" loses signal); more than 6 creates redundant overlap.
- **YAML is what founders actually edit**: comments, multi-line strings, lists. JSON would mechanically work but is hostile to humans.
- **Structured, not free-form**: prevents the founder from writing unstructured "I want X to be better" statements. Each field has a typed shape; the architect can mechanically extract attention-budget and watch-list-by-frequency.
- **8 fields per area**: weight steers attention; current_state grounds the architect; target_3mo/target_6mo gives time-horizon framing; hard_constraints and anti_goals are guardrails; research_directions seeds query topics; notes is the escape hatch.
- **Loose validation**: founder asked to "keep it a bit loose and open for updates as we can think again once baseline is done" (2026-05-09). Strict validation would force schema thrash with every refinement; loose validation lets the schema evolve organically.

**Tradeoff**: ~60 fields is non-trivial to fill. Mitigation: `standing_orders.example.yaml` ships seeded from the current roadmap state — founder can use it as a starting point and refine, rather than starting from blank.

**Renamed from**: "Founder Priorities Profile" (initial 2026-05-09 working name). Founder rejected the original name as too vague; "Standing Orders" was selected from a shortlist of {Standing Orders, Direction Profile, Mission Profile, Strategic Direction}. Confirmed by founder same day; freedom to rename retained.

## D195 — Append-only JSONL for Targets/Gaps/Findings/Passes

**What**: All KB collections use append-only JSONL. Mutations (`updateTarget`, `resolveGap`, `finishPass`) append a new row with the same `id` and updated fields; reads build latest-state by replaying the log.

**Why**:
- **Same pattern as Phase 15-A proposals + Phase 12-A admin audit + Phase 14-A jobs**. Op consistency.
- **Free audit trail**: every mutation is a new row with timestamp; no separate audit table needed.
- **Crash-safe**: `fs.appendFile` is atomic for small writes on POSIX. No transactions needed.

**Tradeoff**: at very high update rates, the log grows unbounded. 21-B can add a compaction policy (e.g., snapshot every N updates); not a concern at R&D scale.

## D196 — Founder Portal API thin layer over store + KB; UI lands in 12-B / 21-B

**What**: `architect/portal.js` exposes `overview()` / `listProposals({kind, state, priority_area, limit})` / `getProposalDetail(id)` / `approve(id)` / `reject(id)`. No HTTP server, no React component — just the API. 12-B admin UI consumes it as a "Proposals" tab; 21-B may add a dedicated portal page.

**Why**:
- **Substrate first**: the API is the contract. UI is downstream.
- **Reusable**: 12-B admin UI can render this; a future Slack bot can render this; CLI tooling can render this. All read the same API.
- **CLI-usable in 21-A**: `node -e 'import("...portal.js").then(...)'` lets the founder review proposals from the terminal even before 12-B ships.

**Tradeoff**: founder workflow is awkward without a UI. Acceptable for v0.0.1 → v1; UI is one of the C2 cohort B-subphases.

## D197 — Researcher dispatches priority-weighted with per-area failure isolation

**What**: `researcher.runPass` allocates the total budget across the 6 priority areas proportional to weights (`area_budget = total_budget × area.weight / Σ weights`). Each area is dispatched independently; failures in one area are recorded as `by_area[id].error` but do not abort other areas. Findings from succeeding areas are still ingested.

**Why**:
- **Founder steering matters**: a 5-weight area gets ~4× the attention of a 2-weight area. The research dispatch enforces it directly.
- **Per-area failure isolation**: a transient research failure (network blip, subagent timeout) on `models` shouldn't block findings for `agents`. Same beat-level-failure pattern as Phase 17-A renderer.
- **Auditable**: `by_area` map in the pass result shows what got attention and what failed.

**Tradeoff**: a single area with a 5 weight can dominate the pass. Mitigation: weights are bounded 1-5; Σ weights typically 18-30; even a "max" area gets ~25%. For wildly-skewed priorities, the architect generates fewer findings in low-weight areas — which is the correct behavior (founder said don't focus there).

## D198 — Proposals tagged with priority_area + weight in rationale.meta

**What**: Every proposal generated by `architect.proposer.fromFindings` carries `proposal.rationale.meta.priority_area` (and `weight` if available). The Founder Portal sorts/filters by this so the founder sees high-priority-area proposals first.

**Why**:
- **Direct steering**: founder's weights flow through to which proposals are most prominent in the portal.
- **Filterable**: `portal.listProposals({ priority_area: "models" })` returns just the relevant subset.
- **Future ranking**: 21-B can compute a per-proposal score = `weight × confidence × (1 - cost_signal)` and rank.

**Tradeoff**: depends on findings carrying `priority_area`. Mitigation: researcher stamps it on every finding; KB validates the field.

## D199 — Phase 22 (Action Boundary Enforcement) — separate phase deferred to v3 boundary

**What**: Pipeline action-boundary enforcement (the founder's explicit ask: "as soon as the factory is started, any command given to it should have no action taken by all these agents outside the process flow") is a separate phase. Phase 22 captures: tool allowlist, egress audit, sandbox runtimes, MCP allowlists, courier event allowlists, signed manifest provenance. Lands at the v2 → v3 boundary per the existing security gating posture (D185 + D189).

**Why**:
- **Distinct concern**: enforcement is about *runtime gates*, not autonomous research. Mixing them would couple a working substrate to a complex sandbox.
- **Maps to the existing security gating posture**: D185 explicitly defers Hermes' ALLOW-ALL findings; D189 puts the hardening pass at v2 → v3. Phase 22 is the home for that work.
- **Phase 21-A architect is itself subject to Phase 22's boundary** when it lands: declared `architect_egress_allowlist`; audit log every external research call. Architect doesn't get an exemption.

**Tradeoff**: 21-A architect's research subagent will go to the open web in 21-B without sandbox enforcement. Mitigation: 21-B uses Sonnet via OpenRouter (ours), with web-search MCP servers (allowlisted via Phase 5-A). Sandbox-grade isolation arrives at Phase 22.

---

## Phase 21-A.1 — Decisions D200–D204 (added same session 2026-05-09)

After 21-A close, founder articulated three additional needs that turned 21-A from substrate-only into a self-running R&D loop. Five new decisions captured here.

## D200 — Platform Evolution Roadmap is the named artifact for continuous improvement

**What**: The autonomous research loop is named **Platform Evolution Roadmap** (founder confirmation 2026-05-09 after rejecting "DevOps roadmap" — wrong industry term). It is a living, continuously-running pipeline that produces structured upgrade proposals on a cadence and feeds them to the founder for the final call.

**Why**:
- Every working platform has a 6-12 month relevance window (Linux, Postgres, Stripe). The R&D loop is standard practice; the only blocker for automating it was that discovery work used to require humans. With LLMs cheap enough to run web research at \$1-2/day, that constraint disappears.
- Founder gets the final gate but no longer the discovery role. Architect drives "what should we improve next?".
- The criteria set itself is dynamic — when factory grows new modules, the architect proposes adding new priority areas. Founder is not the maintainer of the watch list.

**Tradeoff**: requires real LLM dispatcher (21-B) to be useful. Until then, cycles produce synthetic findings — correct *shape*, no real research content.

## D201 — Three independent cadences (daily / weekly / monthly), each toggleable

**What**: Standing Orders gains `baseline.cadences.{daily,weekly,monthly}` — three independently configurable cadences with per-cadence enabled flag, local time, day rule, budget cap, depth, dispatcher, and report toggle. Defaults: monthly ON, weekly + daily OFF (founder's stated preference). Cycles run hierarchically — daily passes accumulate raw findings, weekly synthesises 7 days into one report, monthly does strategic review + criteria health check.

**Why**:
- Three identical-depth passes at three frequencies = noise, not signal. Different depths give meaningful tiering.
- Independent toggles let founder dial in their attention budget — most months the monthly report is enough; daily/weekly turn on when more cadence is wanted.
- Hierarchy means enabling lower tiers makes upper-tier reports better; if only monthly is on, monthly does its own ecosystem scan.

**Tradeoff**: Three cadences = three places to misconfigure. Mitigation: PresetSelect dropdowns (D203) for depth + dispatcher; per-cadence "Run [kind] cycle now" button bypasses the schedule.

## D202 — Cadence daemon embedded in factory-telemetry.service (no new systemd unit)

**What**: A long-lived 60-second polling tick lives inside the existing `factory-telemetry.service` Node process. Each tick reads Standing Orders, computes which cadences should fire *right now* given local time + day rule + dedupe window, and runs the appropriate pass through the architect. Survives `baseline.paused: true`. IST-aware (Asia/Kolkata default). Last-Thursday-of-month resolved correctly (verified for May 2026 = May 28).

**Why**:
- Project pattern is zero-deps where reasonable; node-cron would be a new dep for 3 cadence shapes.
- Reusing factory-telemetry.service (already managed by systemd) means no new unit file, no new supervision setup, no new restart story.
- 60s tick = adequate for cadences expressed in minutes; cheap (one Standing Orders read + one math check per minute).

**Tradeoff**: telemetry process restart = missed cycles. Acceptable per dedupe semantics (`shouldFireCadence` skips if last fire was within the cadence period).

## D203 — Dropdown-with-custom is the standard founder-input pattern

**What**: Reusable `PresetSelect` component everywhere a typed-but-extensible field exists (Role, Output format, Research depth, Dispatcher). Three presets cover ~70-80% of common cases; "Custom…" escape hatch reveals a free-text input below. Founder direction (2026-05-09): "wherever you can have three defined drop-down items for selection to cover maybe 70-80% of the options, and then a custom field."

**Why**:
- Pure dropdowns force the schema to predict every possible value — brittle.
- Pure free-text invites typos that fail validation downstream.
- 3+custom is the right cardinality: presets handle the common path, custom handles the edge cases without schema thrash.

**Tradeoff**: founder-typed custom values aren't validated against the architect's prompt-template. Mitigation: presets are the *recommended* path; custom is documented as "you're now hand-engineering the prompt — own it."

## D204 — Seven (Tool Evaluator) is a new named agent — first SOUL.md in the codebase

**What**: A 12th named agent — **Seven** — joins the roster (Star Trek convention preserved). Seven's role: evaluation specialist for the R&D pipeline. Distinct from Tuvok (tests our code) / Spock (researches) / Data (reviews architecture) / Troi (surfaces ideas). Seven *measures*, *probes*, and *benchmarks* third-party candidates. First SOUL.md identity file in the codebase (per Hermes pattern — memory rule confirmed 2026-04-21: every named agent must have a SOUL.md). The other 11 agents need their SOUL.md files too — tracked as a follow-up.

**Why**:
- Founder direction (2026-05-09) explicitly asked: "we've heard 2nd-hand info about Hermes; prepare our own first-hand report." Existing agents don't fit — Tuvok tests our code (not external candidates); Spock surveys (not benchmarks); Data reviews our architecture.
- Mixing evaluation into Tuvok dilutes both roles cognitively.
- New agent costs ~one prompt + identity file; benefit is clean cognitive map: "Tuvok tests our code · Seven evaluates candidate tools."
- Seven's first mission is the Hermes evaluation — promoted to Lab `testing` tier same day, Seven named as evaluation owner.
- New `tool_evaluation` finding kind distinguishes Seven's findings from raw research observations.

**Tradeoff**: Until Phase 21-B (real dispatcher) and Phase 22 (sandboxed runtime) land, Seven's "evaluation" is documentation+probe-based, not full benchmark-suite-against-our-workload. The seat is at the table; the first real benchmarks run when 21-B is live.

## D209 — Real LLM dispatcher is opt-in per-cadence / per-brief, not a global flag (added 2026-05-09)

**What**: Phase 21-B ships `createLLMDispatcher({ dispatcher: 'sonnet' | 'opus' })` as a drop-in replacement for `createStubDispatcher`. Activation is explicit per execution: a cadence config in Standing Orders sets `dispatcher: 'sonnet'`, or a brief submission includes `dispatcher: 'sonnet'`, or the manual run-pass body includes it. Default everywhere = `stub`. The LLM dispatcher is wired but inert until each cadence/brief chooses it.

**Why**:
- A global "USE_REAL_LLM" flag would couple all three cadences + every brief at once — too coarse. Founder might want monthly to use Opus while daily stays on stub for cost reasons.
- Per-cadence dispatcher gives a natural cost ladder: `stub` ($0) → `sonnet` (~$0.30/pass) → `opus` (~$1.50/pass) per the cadence's depth and importance.
- Briefs can pick their own dispatcher independently (Seven's Hermes evaluation might be Opus; quick "is this tool interesting" briefs might be Sonnet).
- Founder retains the kill switch (set dispatcher back to `stub` to instantly stop real LLM spend without touching env vars or systemd).
- Standing Orders' loose validator already accepts arbitrary `dispatcher` strings; the editor's `PresetSelect` exposes 3 presets (Stub / Sonnet / Opus) plus Custom.

**Tradeoff**: If founder forgets to flip a cadence's dispatcher to `sonnet`, that cycle keeps producing synthetic content. Mitigation: each report's summary section explicitly notes "stub dispatcher — synthetic findings" when `cost_usd === 0` so empty-substance reports are visibly tagged.

## D210 — Phase 6-B hooks `RouterChatModel.invoke()` rather than per-graph (added 2026-05-09)

**What**: Phase 6-B (artifact dual-write) is implemented as a hook inside `RouterChatModel.invoke()` (the universal LLM-call entry point) rather than touching the three graphs (`pre_dev_graph.js`, `dev_graph.js`, `post_dev_graph.js`) individually. The graphs are unchanged; `setProjectDir()` (which they all already call) sets `process.env.AGENT_PROJECT_DIR` + `AGENT_RUN_ID` so the hook resolves them automatically.

**Why**:
- Single chokepoint = one patch covers every LLM call in the codebase: 3 pipeline graphs + Phase 21-B Sonnet/Opus dispatcher + any future caller.
- Per-graph patching would mean editing 3 files now plus every future graph — perpetual maintenance debt.
- `setProjectDir()` is already a chokepoint for project-creation; adding env-var population there is a 5-line addition. Setting env unconditionally is safe because the artifact-write hook is gated by `USE_ARTIFACT_STORE`.
- Fail-open posture (artifact-write errors are caught + warned + swallowed) means a buggy artifact write never breaks an LLM call.

**Tradeoff**: Hook adds a few ms per LLM call when active (artifact write is ~10ms on filesystem). Mitigation: it's gated by the flag; default-off means no cost in the common case.

## D217 — 21-B.2: cadence daemon enqueues to Phase 14-A queue under `USE_ARCHITECT_QUEUE` (added 2026-05-11)

**What**: Phase 21-B.2 makes the architect cadence daemon optionally enqueue cycle work as `architect_research` jobs on the Phase 14-A queue instead of running them inline inside the setInterval tick. Behavior is flag-gated (`USE_ARCHITECT_QUEUE=true`); default off preserves Phase 21-A.1's inline path.

**Why move into the queue**:
- **Crash resilience**: a real-LLM cycle (Sonnet/Opus dispatcher) takes minutes. Inline, an interrupted telemetry restart loses the in-flight pass. As a queue job, Phase 14-A's lease timeout re-leases the orphan on the next boot.
- **Concurrency safety**: daily + weekly + monthly cadences can fire within the same minute window. Inline they serialize inside one setInterval tick; via queue (parallelism=2) they overlap honestly.
- **Observability**: in-flight cycles surface in Admin → Queue panel with the same status transitions as pipeline jobs. One UI for all background work.

**Why a flag (default off) instead of a hard switch**:
- Phase 21-A.1's inline path has weeks of clean stub-dispatcher runs. The enqueue path is new.
- Per-environment opt-in: founder flips on production after observing one or two enqueued cycles complete in Admin → Queue. Staging can stay inline if desired.
- Fail-open: an enqueue failure (queue unavailable, FS issue) falls through to the inline path automatically. Architect availability never depends on queue health.

**Why `project_id: "architect"` sentinel**:
- The Phase 14-B per-project quota gate (D212) consults `project:<id>` thresholds. Using a stable sentinel lets the founder add `project:architect` to `cost-thresholds.json` if they want to cap architect spend independently of customer-project work — without that threshold, architect cycles are uncapped (which is today's behavior).
- Round-robin fairness in Phase 14-A's scheduler treats "architect" as one project among many — three concurrent customer projects + the architect can't be starved by any one alone.

**Why `priority: 30, max_attempts: 1`**:
- Priority 30 is below pre_dev/dev/post_dev (50) — pipeline work preempts when both are queued. Architect cycles are background.
- `max_attempts: 1` because cadence IS the retry. A failed daily fires again tomorrow; auto-retrying inside the same day adds spend without insight.

**Why a new `architect-handler.js` module (not inline in factory-handlers.js)**:
- Mirrors D211: handlers are content (what each kind does); the registry is machinery (how kinds get scheduled). Architect is a different domain than factory pipelines and deserves its own file.
- Phase 16-B (training_gen), 17-B (training_video_render), 19-B (project_intake) will each land in their own files under `concurrency/handlers/` for the same reason.

**Tradeoff acknowledged**: when the flag is on, the cadence daemon's own `onReportProduced` hook never fires (the queue handler fires its own). The Live Trace message changes from `👑 Architect cycle report ready: <id>` to `👑 Architect cycle report ready (via queue): <id>` so the path is identifiable. After the inline path is deleted (post-21-B.2 close-out), the messages converge.

## Decision counter

- D1–D165: Phases 0-18
- D166–D172: Phase 19
- D173–D180: Phase 20
- D181–D189: Phase 2.76
- **D190–D199: Phase 21 (substrate)**
- **D200–D204: Phase 21-A.1 (Platform Evolution Roadmap + R&D Brief + Seven)**
- **D205–D207: Phase 12-B-full (Postgres-deferred, flag-override file, audit-metadata-only)**
- **D208: Phase 13-B Tier B split**
- **D209: Phase 21-B — opt-in per cadence/brief, not global flag**
- **D210: Phase 6-B — hook RouterChatModel.invoke (chokepoint), not per-graph**
- **D217: Phase 21-B.2 — cadence daemon → Phase 14-A queue under USE_ARCHITECT_QUEUE flag**
- Future: continues from D218 (D211–D216 belong to Phases 5 / 9 / 14)
