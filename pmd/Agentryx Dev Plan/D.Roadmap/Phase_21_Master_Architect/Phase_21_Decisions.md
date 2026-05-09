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

## Decision counter

- D1–D165: Phases 0-18
- D166–D172: Phase 19
- D173–D180: Phase 20
- D181–D189: Phase 2.76
- **D190–D199: Phase 21 (this phase)**
- Future: Phase 22+ continues from D200
