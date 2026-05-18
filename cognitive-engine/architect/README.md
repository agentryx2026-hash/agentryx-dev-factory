# Master Architect (Phase 21-A)

Autonomous research + Knowledge Base substrate. Continuously monitors the AI tool ecosystem, ingests findings into a structured KB, and emits Proposals to the founder via Phase 15-A's lifecycle. The architect is the *autonomous half* of the proposal flow — proposals come **from the architect to the founder**, not the other way around.

## Status: Phase 21-A scaffolding

**87 architect smoke-test assertions pass** (plus +3 in self-improvement smoke for new proposal kinds = 90 in total impact). Substrate runs at $0 cost — researcher is dependency-injected and Phase 21-A ships only the stub dispatcher. Phase 21-B wires the real Sonnet-backed web-research subagent.

## Files

- `types.js` — StandingOrders { baseline, custom_direction }, Target, Gap, Finding, ResearchPass, KBState; loose validator + baseline defaults; attention budget calculator (D194)
- `kb.js` — `createKnowledgeBase(rootDir)`: Standing Orders CRUD + history (`writeStandingOrders` / `readStandingOrders` / `readBaseline` / `readCustomDirection`); targets / gaps / findings / passes; roadmap snapshot; summary
- `scheduler.js` — `createScheduler({enqueue, readBaselineAndVersion, config, now})`: boot pass, daily cron driven by `baseline.cron_schedule`, founder-update detector via version watermark (D193)
- `researcher.js` — `createResearcher({dispatchSubagent, budget_usd_per_pass})`: priority-weighted budget split from `custom_direction.priority_areas`; per-area dispatch; failure isolation. Plus `createStubDispatcher` for tests.
- `proposer.js` — `createArchitectProposer({proposalStore, kb})` + `createArchitectApplier({kb, marketplace})`: classifies findings into 3 architect-owned proposal kinds (D190); applier routed via Phase 15-A `applyProposal(ctx.architectApplier)`
- `architect.js` — `createArchitect({kb, researcher, proposer})`: end-to-end orchestrator (read Standing Orders → start pass → dispatch researcher with custom_direction → ingest findings → auto-create Targets for new-tool findings → emit proposals → finish pass)
- `portal.js` — `createFounderPortal({proposalStore, kb})`: `overview()` / `listProposals()` / `getProposalDetail()` / `approve()` / `reject()` (D196)
- `standing_orders.template.yaml` — versioned-in-repo schema source of truth (two-tab layout)
- `standing_orders.example.yaml` — first-run seed for fresh deployments (Phase 21-A close state)
- `smoke-test.js` — 87 assertions across 8 test groups

## Layout

```
<workspace_root>/_kb/
  ├── standing_orders.json             founder-edited; architect reads each pass
  ├── standing_orders_history.jsonl    version bump log
  ├── targets.jsonl                    monitored external tools/products
  ├── gaps.jsonl                       needs without tools yet
  ├── findings.jsonl                   append-only research observations
  ├── passes.jsonl                     research-pass log
  ├── roadmap_snapshot.json            derived from D.Roadmap/
  └── _seq                             monotonic counters for T-/G-/F-/RP-

cognitive-engine/architect/
  ├── standing_orders.template.yaml    ← schema + commentary
  └── standing_orders.example.yaml     ← seeded from current roadmap state
```

## Standing Orders — two-tab structure (D194)

The factory's permanent directive. Two sections matching the two UI tabs:

### Tab 1 / Section 1 — `baseline` (autonomous behavior)

What the architect does on its own. Founder edits rarely (quarterly when ops change). Missing fields fall back to `DEFAULT_BASELINE`.

| Field | Default | Notes |
|---|---|---|
| `cron_schedule.{hour_utc,minute_utc}` | 00:00 UTC | Daily research-pass slot |
| `daily_budget_usd` | 1.5 | Cap per pass; researcher splits by weight |
| `research_depth` | "standard" | light / standard / deep |
| `research_dispatcher` | "stub" | 21-B: "sonnet" / "opus" |
| `auto_watch_enabled` | true | Architect auto-curates watch list from inventory |
| `auto_watch_disabled_ids` | [] | Founder explicit toggle-offs |

### Tab 2 / Section 2 — `custom_direction` (founder-edited steering)

Founder's structured directive. Edited monthly. ~60 fillable slots total.

- **`effective_period`** — start/end dates + horizon label (e.g. "Q3 2026")
- **`overall_stance`** — risk_appetite / quality_vs_speed / cost_sensitivity / change_tolerance
- **`priority_areas`** — exactly 6 entries (REQUIRED), one per id below × 8 fields each
- **`strategic_watch`** — founder additions on top of Tab 1's auto-curated list
- **`notes`** — free-form architect-visible context

The 6 priority area ids:

| Area | What it controls |
|---|---|
| `models` | LLM tier strategy, cost/quality posture, fine-tuning ambitions |
| `agents` | Named pipeline agents (Picard, Sisko, Troi, …) + new candidates |
| `languages` | Code/output stacks the factory produces |
| `tools` | MCP plane, external integrations, IDE tooling |
| `output_quality` | Tuvok test rigor, Data review depth, Verify cycle latency |
| `operations` | Cost / speed / throughput / deployment surface |

Each area has 8 fields: `weight` (1-5), `current_state`, `target_3mo`, `target_6mo`, `hard_constraints`, `anti_goals`, `research_directions`, `notes`. **48 structured slots + ~12 meta = ~60 fillable total** (founder fills in 30-60 minutes; refines monthly).

### Validation discipline (intentionally loose during 21-A)

Only `version` (positive integer) and `custom_direction.priority_areas` (exactly 6, valid ids, weights 1-5) are strictly enforced. Everything else is optional with sensible defaults applied at read time, so partial / evolving Standing Orders still work.

## Three new proposal kinds (D190; extends Phase 15-A)

| Kind | Auto-approve? | Owner | Used for |
|---|---|---|---|
| `tool_adoption` | NO — founder-gated | architect.proposer | Add/upgrade/swap a tool (stable or playground) |
| `kb_update` | YES | architect.proposer | Add/update a Target or Gap entry |
| `research_finding` | YES | architect.proposer | Raw observation worth recording |

Phase 15-A's original 4 kinds (prompt_change, model_change, config_change, graph_change) are unchanged. The 3 new kinds use the same lifecycle (`draft → evaluating → ready → approved → applied`); the architect typically skips the `evaluating` step for low-stakes kinds and auto-approves into `applied`.

## Lifecycle of a research pass

```
1. Architect reads standing_orders.json
   ├─ if missing → skip with reason
   └─ if version > last seen → fast-path "founder_priority_update" pass

2. KB.startPass(passKind) → RP-NNNN

3. Researcher runs priority-weighted dispatch (uses custom_direction.priority_areas):
   ├─ for each of the 6 areas:
   │   ├─ allocate budget: total × (weight / Σ weights)
   │   ├─ dispatch subagent with area context + watch list + KB summary
   │   └─ collect findings
   └─ failures isolated per-area; other 5 areas continue

4. For each finding:
   ├─ KB.appendFinding(...)  (always recorded)
   ├─ if kind="new-tool" with target_name → KB.addTarget(...)
   └─ proposer.fromFindings(...) → store.create(proposal)

5. KB.finishPass(RP-NNNN, {findings_count, proposals_emitted, cost_usd})

6. Founder later opens portal.overview() → reviews proposals → approves/rejects
```

## API quick start

```js
import { createKnowledgeBase } from "./architect/kb.js";
import { createScheduler } from "./architect/scheduler.js";
import { createResearcher, createStubDispatcher } from "./architect/researcher.js";
import { createArchitectProposer, createArchitectApplier } from "./architect/proposer.js";
import { createArchitect } from "./architect/architect.js";
import { createFounderPortal } from "./architect/portal.js";
import { createProposalStore } from "../self-improvement/store.js";

const kb = createKnowledgeBase("/path/to/workspace");
await kb.writeStandingOrders(yourStandingOrders);   // see standing_orders.example.yaml

const proposalStore = createProposalStore("/path/to/workspace");
const proposer      = createArchitectProposer({ proposalStore, kb });
const researcher    = createResearcher({
  dispatchSubagent: createStubDispatcher(),         // 21-A: stub. 21-B: real Sonnet web-research subagent.
  budget_usd_per_pass: 2.0,
});
const architect     = createArchitect({ kb, researcher, proposer });
const portal        = createFounderPortal({ proposalStore, kb });

// Boot pass (factory startup)
await architect.runPass("boot");

// Schedule daily cron — reads baseline.cron_schedule from Standing Orders
const scheduler = createScheduler({
  enqueue: async (passKind, payload) => architect.runPass(passKind, payload),
  readBaselineAndVersion: async () => {
    const so = await kb.readStandingOrders();
    return {
      version: so?.version || 0,
      hour_utc: so?.baseline?.cron_schedule?.hour_utc,
      minute_utc: so?.baseline?.cron_schedule?.minute_utc,
    };
  },
  config: { run_on_boot: true },
});
await scheduler.start();

// Founder review surface
const overview = await portal.overview();
const ready = await portal.listProposals({ state: "ready" });
const detail = await portal.getProposalDetail(ready[0].id);
await portal.approve(ready[0].id, { reviewer: "subhash" });
```

## Architect-owned proposal applier — wired through Phase 15-A

Phase 15-A's `applyProposal(proposal, ctx)` recognizes the 3 new kinds and routes them to `ctx.architectApplier.apply(...)`. Without `ctx.architectApplier`, the applier refuses architect-owned proposals with a clear error.

```js
import { applyProposal } from "../self-improvement/applier.js";
const archApplier = createArchitectApplier({ kb, marketplace });
await applyProposal(approvedProposal, { architectApplier: archApplier });
```

## Smoke test summary

```
$ node cognitive-engine/architect/smoke-test.js
[types]                          (6 areas + 4 pass kinds + budget compute + loose validator)
[kb basics]                      (Standing Orders CRUD + history; targets + filter + update; gaps + resolve;
                                  passes start/finish; findings filter; roadmap snapshot; summary)
[kb validation]                  (invalid SO / target / gap / finding kind all rejected)
[scheduler]                      (boot enqueue; manual trigger; no-boot; baseline cron read)
[researcher]                     (12 findings across 6 areas × 2; failure isolation; per-area errors captured)
[proposer + applier flow]        (3 proposals from 3 findings; tool_adoption + research_finding shapes;
                                  Phase 15-A applier routes via ctx.architectApplier; refusal without ctx)
[architect orchestrator]         (full boot pass; KB state reflects findings; missing SO → skip)
[founder portal]                 (overview / listProposals filter / detail with findings)

[smoke] OK  — 87 assertions
```

## Feature flag

```
USE_AUTONOMOUS_ARCHITECT=true     Phase 21-B onwards: scheduler runs daily cron + boot pass;
                                  research subagent calls real LLMs; proposals auto-flow.
                                  Phase 21-A: substrate only; architect.runPass() can be called
                                  manually but doesn't auto-trigger.
```

## Founder workflow

1. **First time**: copy `standing_orders.example.yaml` to `_kb/standing_orders.json` (after converting YAML → JSON via your editor or `yq -o=json`); fill in real values for both tabs.
2. **Architect runs at boot + nightly**; emits proposals into Phase 15-A's store.
3. **Founder opens the proposal portal** (Phase 12-B admin UI; or `portal.overview()` from CLI in 21-A) → reviews ready proposals.
4. **Approve / reject** via portal; approved proposals get applied via the architect applier.
5. **Quarterly**: bump `version` in Standing Orders; architect runs a `founder_priority_update` pass within minutes of detection.

## Design decisions

- **D190** — 3 new proposal kinds extend Phase 15-A; same lifecycle, same store, same audit log
- **D191** — KB is JSONL-backed (consistent with the 14×-proven pattern); structured but not relational; sqlite/postgres deferred
- **D192** — Architect-owned applier wired through Phase 15-A `applyProposal(ctx.architectApplier)`; Phase 15-A applier refuses architect kinds without ctx
- **D193** — Scheduler enqueues passes onto Phase 14-A queue (DI'd); test-clock + run_on_boot toggle for tests; reads `baseline.cron_schedule` from Standing Orders
- **D194** — Standing Orders has two sections (Tab 1 `baseline` + Tab 2 `custom_direction`); validator intentionally loose so partial profiles still work; founder confirmation 2026-05-09
- **D195** — Append-only JSONL for Targets / Gaps / Findings / Passes; mutating updates use replay-the-log semantics
- **D196** — Founder Portal API thin layer over store + kb; UI lands in 12-B / 21-B
- **D197** — Researcher dispatches priority-weighted with per-area failure isolation; one bad area doesn't kill the pass
- **D198** — Proposals tagged with `priority_area` + `weight` in their rationale.meta so the portal sorts by relevance

## Rollback

21-A has no runtime hooks. The library exists; nothing wires it to startup or cron yet (21-B). Flag defaults OFF. Removal = `rm -rf cognitive-engine/architect/` + revert Phase 15-A's 3 enum additions + revert applier extension. Phase tag `phase-21a-closed` is the rollback anchor.

## What 21-B adds

- **Real research subagent**: Sonnet-backed web-search dispatcher (replaces `createStubDispatcher`)
- **Cron daemon**: long-lived process that holds the scheduler timer; or systemd-cron entry
- **Phase 14-A queue integration**: scheduler enqueues `architect_research` jobs, processed by a registered handler
- **Phase 12-B admin UI**: real Standing Orders editor + Founder Proposal Portal page (consumes `portal.js` API)
- **Cost gating**: per-pass budget cap enforced via Phase 11-A pre-flight check
- **Courier notifications**: "3 new proposals in your `models` area" Slack/email pings on pass completion

## What 22 adds (Action Boundary Enforcement)

Per Phase 21-A's split-out concern (also captured in Master Factory Architect §14): pipeline isolation + sandbox enforcement is its own phase. Lands at v2 → v3 boundary. The architect itself becomes subject to the same boundaries (declared `architect_egress_allowlist`, audit log every external research call).
