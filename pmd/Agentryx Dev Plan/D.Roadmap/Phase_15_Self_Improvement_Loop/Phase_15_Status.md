# Phase 15 — Status: 15-A COMPLETE ✅  (15-B DEFERRED)

**Phase started**: 2026-04-23
**Phase 15-A closed**: 2026-04-23
**Duration**: single session

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 15-A.1 | `self-improvement/types.js` — Proposal/ProposalKind/ProposalState/EvaluationResult shapes + transition table | ✅ done |
| 15-A.2 | `self-improvement/store.js` — filesystem-backed proposal store with state machine + audit log | ✅ done |
| 15-A.3 | `self-improvement/proposer.js` — heuristic proposer (3 rules) + `runProposerIntoStore` dedupe wrapper | ✅ done |
| 15-A.4 | `self-improvement/evaluator.js` — replay-driven scoring harness with dependency-injected comparator | ✅ done |
| 15-A.5 | `self-improvement/applier.js` — config / prompt / model writers; graph_change guard | ✅ done |
| 15-A.6 | Smoke test — 87 assertions across 16 test groups | ✅ done — all pass |
| 15-A.7 | `self-improvement/README.md` + `USE_SELF_IMPROVEMENT` flag registered in admin-substrate | ✅ done |
| 15-B | Real LLM proposer + real comparators + scheduled runs + UI + prompt hot-swap | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/self-improvement/types.js` (existed pre-session, ~100 lines)
- `Proposal`, `ProposalKind` (4), `ProposalState` (6), `ProposalChange`, `ProposalRationale`, `EvaluationResult` JSDoc shapes
- State transition table + `canTransition` guard
- `SCHEMA_VERSION = 1`, `PROPOSAL_KINDS`, `PROPOSAL_STATES`, `TERMINAL_STATES`

### `cognitive-engine/self-improvement/store.js` (new, ~210 lines)
- `createProposalStore(rootDir)` returns store instance:
  - `create({kind, change, rationale, created_by})` → Proposal (state=draft)
  - `get(id)`, `list({state?, kind?, limit?})`, `stats()`
  - `transition(id, to, {actor, patch, note})` — state-machine gated
  - `approve(id, {reviewer, note})`, `reject(id, {reviewer, note})` — shorthands
  - `readAudit({target, limit})` — returns audit entries, newest first
- Layout: `<root>/_proposals/PROP-NNNN.json` + `_audit.jsonl` + `_seq`
- Atomic write: temp file + rename; state machine enforced before disk touch

### `cognitive-engine/self-improvement/proposer.js` (new, ~180 lines)
- `createHeuristicProposer({minSupport, rules})` → `{id, propose(ctx)}`
- `DEFAULT_RULES` — 3 heuristic rules:
  - **Rule 1 (prompt clustering)**: ≥N `lesson` observations sharing (agent, primary_tag) → `prompt_change`
  - **Rule 2 (model underperformance)**: ≥N `pattern` observations tagged `cost_high` or `slow` on an agent → `model_change`
  - **Rule 3 (config drift)**: ≥N `decision` observations tagged `threshold_tuned` + `config:<id>` → `config_change`
- `runProposerIntoStore({proposer, store, ctx})` — persists drafts with idempotent dedupe keyed on `(kind, target, summary)`; rejected proposals aren't part of the dedupe blocklist so they can be re-emitted

### `cognitive-engine/self-improvement/evaluator.js` (new, ~130 lines)
- `evaluateProposal(proposal, ctx)` → `EvaluationResult` (aggregates deltas across sample)
- `aggregateDeltas(deltas[])` — arithmetic mean of cost/latency/success-rate deltas + `sample_size`
- `evaluateAndStore({proposal, store, ctx, actor})` — state: `draft → evaluating → ready` with evaluation patched
- Dependency-injected: `ctx.runReplay`, `ctx.compareOutcomes`, `ctx.buildPlan` — tests stub; production wires Phase 13-A `executeReplay` + real comparator (15-B)
- Tolerant: replay failures are recorded per-sample; evaluation still completes with reduced sample_size

### `cognitive-engine/self-improvement/applier.js` (new, ~175 lines)
- `applyProposal(proposal, ctx)` — refuses non-approved state, dispatches by kind
- `parseTarget(target)` — parses `config:<id>`, `config:<id>.<dot.path>`, `agent:<id>.<field>`, `task:<agent>.<field>`
- `applyConfigChange` — uses Phase 12-A `configIO.writeConfig`; supports nested-key writes via `setDotPath`
- `applyModelChange` — patches `llm_routing` task routing entry via same writeConfig
- `applyPromptChange` — appends to `<workspace>/_prompt-overrides/<agent>.jsonl` (graph doesn't consume yet)
- `graph_change` **throws** (D145) — Phase 15-A does not mutate graph code
- `applyAndStore({proposal, store, ctx, actor})` — applies + transitions to `applied` with summary

### `cognitive-engine/self-improvement/smoke-test.js` (new, ~620 lines)
- **87 assertions across 16 test groups**:
  - types & state machine (14)
  - store basics (8), transitions & audit (11), reject path (3)
  - heuristic proposer (9), proposer→store dedupe (3)
  - evaluator aggregation (5), full cycle with fake replay (5), replay failure tolerance (3)
  - applier target parsing (6), config_change (4), model_change (1), prompt_change (3)
  - applier graph_change rejected (1), requires-approved (1)
  - full lifecycle end-to-end (10)

### `cognitive-engine/self-improvement/README.md` (new)
- State machine diagram, lifecycle flow, proposal kinds table, API examples, smoke summary, decisions, 15-B/15-C preview

### `cognitive-engine/admin-substrate/registry.js` (modified)
- Added `USE_SELF_IMPROVEMENT` feature flag (9 total now)
- Admin smoke test updated (8 → 9) — 41 assertions still pass

### Unchanged
- Graph files (`dev_graph.js`, `factory_graph.js`, `post_dev_graph.js`, `pre_dev_graph.js`)
- `tools.js`, `telemetry.mjs`, memory-layer, concurrency, replay, artifacts, all other phases
- Zero regression risk

## Smoke test highlight

```
[full lifecycle: memory → propose → evaluate → approve → apply]
  ✓ lifecycle: 1 draft from memory
  ✓ lifecycle: ready after evaluation
  ✓ lifecycle: positive improvement signal
  ✓ lifecycle: approved
  ✓ lifecycle: applied
  ✓ audit: create first
  ✓ audit: 5 entries (create + 4 transitions) for full flow (got 5)
  ✓ lifecycle: override file written with proposal id
  ✓ lifecycle: stats show 1 applied

[smoke] OK  — 87 assertions
```

## Why 15-B deferred

15-B = **brain + production wiring**. Requires:
- **Real LLM proposer** — emits structured diffs against real prompts/configs, not heuristic templates. Needs OpenRouter credit for evaluation throughput.
- **Real outcome comparators** — cost from `artifact.cost_usd`, success-rate from LLM-graded outcomes, latency from artifact timings. Depends on Phase 6-B graph dual-write (also deferred pending OpenRouter credit).
- **Scheduled runs via Phase 14-A queue** — `kind: "self_improvement_propose"` enqueued on cadence
- **React UI** (via Phase 12-B admin panel) — list by state, diff viewer, approve/reject with note
- **Prompt hot-swap consumer** — graph nodes read `_prompt-overrides/<agent>.jsonl` at startup (requires Phase 6-B / 8-B graph rewiring)
- **Auto-apply mode** for narrow low-risk kinds (Super Admin opt-in per kind)
- **Metrics** in cost dashboard: proposals/week, approval rate, applied count, mean cost delta per applied proposal

Ship 15-A as the firm substrate; 15-B layers the brain + UI + hot-swap on a tested lifecycle.

## Feature-flag posture

| Flag | Default | Effect |
|---|---|---|
| (existing 8 flags ...) | off | Phases 4-14 |
| `USE_SELF_IMPROVEMENT` | off | Phase 15-B onwards: proposer runs on cadence; 15-A library only |

## Phase 15-A exit criteria — met

- ✅ `self-improvement/` scaffolded (types, store, proposer, evaluator, applier, smoke-test, README)
- ✅ Proposal state machine implemented, audit-logged, and enforced on disk
- ✅ Heuristic proposer extracts Proposals from synthetic observations (3 rules: prompt/model/config)
- ✅ Evaluator scores Proposals via replay harness against snapshots; tolerant to replay failures
- ✅ Applier writes config changes atomically via Phase 12-A; prompt overrides to `_prompt-overrides/`
- ✅ Applier refuses `graph_change` (D145) and non-approved proposals
- ✅ Smoke test: full lifecycle (observe → propose → evaluate → approve → apply) **87 assertions pass**
- ✅ `USE_SELF_IMPROVEMENT` flag registered in admin-substrate (no runtime effect in 15-A)
- ✅ No changes to graph files, memory layer, replay engine, concurrency engine
- ✅ Only modification outside `self-improvement/` is registering the flag (+ its smoke-test bump)
- ✅ Phase docs: Plan (expanded), Status, Decisions (D141-D146), Lessons
- ⏳ 15-B real LLM + comparators + UI + hot-swap deferred (needs OpenRouter credit)

Phase 15-A is **wired, tested, and ready**. Substrate firm — 15-B builds the brain.
