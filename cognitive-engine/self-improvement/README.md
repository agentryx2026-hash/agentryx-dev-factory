# Self-Improvement Loop (Phase 15-A)

Substrate for agents to propose factory changes (prompts, models, configs) and have them human-reviewed before merge. All gated by Super Admin approval.

## Status: Phase 15-A scaffolding

**87 smoke-test assertions pass.** Full lifecycle (observe → propose → evaluate → approve → apply) wired end-to-end against in-memory fakes. **No graph mutation, no LLM proposer, no UI** — those are 15-B+ territory.

## Files

- `types.js` — `Proposal`, `ProposalKind`, `ProposalState`, `EvaluationResult`, transitions table
- `store.js` — filesystem-backed proposal store: `create` / `get` / `list` / `transition` / `approve` / `reject` / `readAudit` / `stats`
- `proposer.js` — `createHeuristicProposer({minSupport, rules})` + `runProposerIntoStore` with dedupe
- `evaluator.js` — `evaluateProposal` / `aggregateDeltas` / `evaluateAndStore` — replay-driven scoring harness
- `applier.js` — `applyProposal` / `applyAndStore` / `parseTarget` — config/prompt/model writers with graph_change guard
- `smoke-test.js` — 87 assertions across 16 test groups

## Layout

```
<workspace_root>/_proposals/
  ├── _seq                         monotonic id counter
  ├── _audit.jsonl                 state-transition log (append-only)
  ├── PROP-0001.json               one file per proposal (any state)
  ├── PROP-0002.json
  └── ...
<workspace_root>/_prompt-overrides/
  ├── troi.jsonl                   append-only override log, per agent
  └── <agent>.jsonl
```

Atomic writes: the store writes to `PROP-NNNN.json.tmp.<rand>` and renames into place. State transitions are gated by `canTransition` in `types.js` — illegal moves throw before touching disk.

## State machine

```
   draft ──► evaluating ──► ready ──► approved ──► applied
      │           │           │          │
      └───────────┴───────────┴──────────┴──► rejected  (terminal)
```

Applied and rejected are terminal. Any non-terminal state can move to rejected (an operator can shortcut a proposal they don't want evaluated). No backward edges — to undo an applied change, create a new opposite proposal.

## Lifecycle

```
memory observations (Phase 7-A)
        │
        ▼
  proposer (heuristic in 15-A; LLM in 15-B)   ──► ProposalDraft
        │
        ▼
  store.create(draft)                         ──► state = draft
        │
        ▼
  store.transition(id, "evaluating")
        │
        ▼
  evaluator (Phase 13-A replay + comparator)  ──► EvaluationResult
        │
        ▼
  store.transition(id, "ready", {patch: {evaluation}})
        │
        ▼
  Super Admin reviews (12-B UI; CLI in 15-A)
        │
        ▼
  store.approve(id) / store.reject(id)
        │
        ▼
  applier.applyProposal(p, ctx)               ──► writes to disk
        │
        ▼
  store.transition(id, "applied", {patch: {apply_result}})
```

## Proposal kinds

| Kind | Target format | 15-A applier behavior |
|---|---|---|
| `prompt_change` | `agent:<id>.<field>` | appends to `_prompt-overrides/<id>.jsonl`; graph doesn't yet consume |
| `model_change`  | `task:<agent>.primary_model` | patches `llm_routing` config via Phase 12-A writeConfig |
| `config_change` | `config:<id>` or `config:<id>.<dot.path>` | full-file or nested-key write via Phase 12-A writeConfig |
| `graph_change`  | `graph:...` | **rejected at apply time** (D145); 15-A does not mutate graph code |

## API

```js
import { createProposalStore } from "./self-improvement/store.js";
import { createHeuristicProposer, runProposerIntoStore } from "./self-improvement/proposer.js";
import { evaluateAndStore } from "./self-improvement/evaluator.js";
import { applyAndStore } from "./self-improvement/applier.js";

const store = createProposalStore("/path/to/workspace");

// 1. Propose
const proposer = createHeuristicProposer({ minSupport: 2 });
const drafts = await runProposerIntoStore({
  proposer, store,
  ctx: { memory: memoryService, registry: configRegistry },
});

// 2. Evaluate
for (const proposal of drafts) {
  await evaluateAndStore({
    proposal, store,
    ctx: {
      snapshots: recentRunSnapshots,
      runReplay: (plan) => executeReplay(plan, replayCtx),
      compareOutcomes: myComparator,
    },
  });
}

// 3. Human review (CLI in 15-A; UI in 12-B / 15-B)
const ready = await store.list({ state: "ready" });
await store.approve(ready[0].id, { reviewer: "subhash", note: "LGTM" });

// 4. Apply
const approved = await store.get(ready[0].id);
await applyAndStore({
  proposal: approved, store,
  ctx: { configIO: { readConfig, writeConfig }, workspaceRoot: "/path" },
});
```

## Smoke test summary

```
$ node cognitive-engine/self-improvement/smoke-test.js
[types & state machine]              ✓ 14 (kinds, states, legal/illegal transitions)
[store basics]                       ✓ 8  (create, id monotonic, roundtrip, validation, list, stats)
[store transitions & audit]          ✓ 11 (full state machine + 5 audit entries)
[store reject path]                  ✓ 3  (reject from draft is allowed; terminal enforced)
[heuristic proposer]                 ✓ 9  (3 rules fire, agents/tags resolve, minSupport respected)
[proposer → store dedupe]            ✓ 3  (idempotent re-run; rejected doesn't block re-emit)
[evaluator aggregation]              ✓ 5  (empty + mean across 3 samples)
[evaluator full cycle]               ✓ 5  (ready after eval, deltas from comparator, replay invocations)
[evaluator replay failure]           ✓ 3  (partial failures → reduced sample_size, per_sample tracks both)
[applier target parsing]             ✓ 6  (config/config.dot/agent/task formats + malformed rejected)
[applier config_change]              ✓ 4  (dotted-key write, other keys unchanged, apply_result recorded)
[applier model_change]               ✓ 1  (llm_routing patched)
[applier prompt_change]              ✓ 3  (override jsonl written with proposal id)
[applier graph_change rejected]      ✓ 1  (D145: 15-A never mutates graph)
[applier requires approved]          ✓ 1  (non-approved state refused)
[full lifecycle]                     ✓ 10 (observe → propose → evaluate → approve → apply)

[smoke] OK  — 87 assertions
```

## Feature flag

```
USE_SELF_IMPROVEMENT=true     Phase 15-B onwards: proposer runs on cadence
                              Phase 15-A: no runtime effect; library only
```

## Design decisions

- **D141** — Proposals stored one-file-per-proposal (not per-state dirs). State lives in the JSON, mutated via atomic write+rename. UI wants list-all-states far more than list-queued-only.
- **D142** — Linear state machine with rejected as universal bail-out. `canTransition` is the single source of truth; illegal moves throw before touching disk.
- **D143** — Proposer is dependency-injected (15-A: heuristic; 15-B: LLM; optional 15-C: RL/Hermes-Tinker-Atropos). Same `createHeuristicProposer({rules})` pattern as Phase 9-A `fixRouter` / Phase 13-A `nodeStubs` / Phase 14-A `handlerRegistry`.
- **D144** — Evaluator uses replay + a stub `compareOutcomes` function. Real outcome comparison (cost from artifact sums, success-rate from LLM grader, latency from artifact timings) is 15-B once OpenRouter credit is live.
- **D145** — Applier edits **only** Phase 12-A registry-known configs and the `_prompt-overrides/<agent>.jsonl` log. Never touches graph code. `graph_change` kind exists in the type system but throws at apply — reserved for Phase 18 marketplace.
- **D146** — All proposals require explicit `super_admin` approval before apply. No auto-apply in 15-A regardless of evaluation score. Auto-apply-on-green may be a future config-gated mode (15-C or later).

## Rollback

15-A has no runtime hooks. The library exists but nothing calls it on factory pipelines. Removal = deleting the directory. No graph files, `tools.js`, `telemetry.mjs`, memory-layer, admin-substrate, concurrency, or replay code is touched.

## What 15-B adds

- **LLM proposer** that reads memory + artifact samples, produces structured proposals with real (not templated) `change.to` content
- **Real comparators**: cost-delta from `artifact.cost_usd` sums, success-rate from an LLM-graded outcome, latency-delta from artifact timings
- **Scheduled proposer runs** via Phase 14-A queue: `kind: "self_improvement_propose"` enqueued on cadence (daily/weekly configurable)
- **React UI** (pulls from Phase 12-B admin panel) — list proposals by state, diff viewer for `change.to` vs current, approve/reject with note, per-proposal evaluation drill-down
- **Prompt hot-swap consumer**: graph nodes read `_prompt-overrides/<agent>.jsonl` at startup, take the latest entry as system-prompt suffix (gated by feature flag)
- **Auto-apply mode for low-risk kinds** (config nudges with narrow numeric moves) — still Super-Admin-configurable per kind
- **Proposal lifecycle metrics** in cost dashboard: proposals/week, approval rate, applied count, mean cost delta per applied proposal

## What 15-C (or later) may add

- **Hermes Tinker-Atropos integration** as the proposer brain (RL-driven; reward signal = outcome deltas from evaluator)
- **Rollback automation**: every applied proposal tagged; revert proposal creates an "undo" proposal automatically
- **Cross-project generalization**: proposals that clear evaluation on one project auto-evaluate against peer projects before wider apply
- **Graph topology mutations** (only after Phase 18 marketplace establishes the versioned-module boundary)
