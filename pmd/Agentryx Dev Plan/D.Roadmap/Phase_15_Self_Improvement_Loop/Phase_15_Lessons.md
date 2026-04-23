# Phase 15 — Lessons Learned

Phase 15-A closed: 2026-04-23. Duration: single session.

## What surprised us

1. **The lifecycle fits in 5 audit entries.** Create → evaluating → ready → approved → applied. That's it. Every smoke-test attempt that assumed 6+ entries was wrong; the transition from draft happens via `create`, not a separate "move to draft" event. Clean insight: `create` IS the draft-state entry, not a precondition for one. Worth remembering for Phase 15-B's UI timeline view.

2. **The proposer/evaluator/applier split is the right seam.** Every time we tried to merge two of them, the test surface blew up. Keeping them as three independent functions (each dependency-injected) made the smoke test a library of 16 small tests instead of one giant integration test. Same pattern that worked in Phase 13-A (planner / executor / run-collector) — seems to generalize.

3. **Dedupe by `(kind, target, summary)` works for heuristic proposers, but won't for LLM proposers.** The heuristic yields stable text given the same observations, so re-running produces identical proposals that the blocklist catches. An LLM proposer will vary its wording each run — dedupe will need to match on `(kind, target)` or on semantic-equivalence via an embedding. Note for 15-B.

4. **Applier requires `approved` state, not just `!terminal`.** First draft let `ready` → apply work directly. That removed the Super Admin gate. Tightened to `=== "approved"` and added a test that proves non-approved is refused. Trust-before-automation (D146) applies at every enforcement layer, not just the state-machine transitions.

## What to do differently

1. **`buildPlan` default is a placeholder.** It pivots on the last artifact of each snapshot — which is wrong for most proposal kinds. A `prompt_change` on Troi should pivot on Troi's first artifact, not the pipeline's last. 15-B must specialize `buildPlan` per kind. Left a TODO in `evaluator.js` and a matching note in the README.

2. **Dedupe skipping rejected entries is borderline correct.** Rejection means "not this one"; re-emitting the same draft later is fine IF memory has accumulated more supporting evidence. But if memory is static, we'll re-emit forever. 15-B should track rejection-count per-key and stop after N rejections, or require new supporting-observations before re-emit.

3. **The smoke test's `testRunProposerIntoStore` exposes the rejection-reemit subtle behavior.** That test will flip if 15-B changes dedupe policy. Left the assertion clear enough that the next maintainer understands the tradeoff.

4. **No timeout on `evaluator.runReplay`.** Borrowed from Phase 14-A lesson #1 — a hang in replay is a hang in evaluation. 15-B should wrap `runReplay` in a `Promise.race` with a per-kind timeout.

## What feeds next phases

### Phase 15-B (deferred) — brain + production wiring
- **LLM-backed proposer**: reads observations + sample of artifacts, emits structured diffs against real prompts/configs. Model choice: Opus 4.7 for nuance (low volume / high value), or Sonnet 4.6 for scale.
- **Real comparators**: cost from `artifact.cost_usd` sums; success-rate from LLM-graded outcomes (uses existing Phase 2 routing); latency from artifact timings. Depends on Phase 6-B graph dual-write being live.
- **Scheduled proposer via Phase 14-A queue**: `kind: "self_improvement_propose"` enqueued on cadence; scheduler runs at low priority.
- **React UI**: integrated into Phase 12-B admin panel. Tabs: Draft / Evaluating / Ready / Approved / Applied / Rejected. Diff viewer for `change.to` vs current. Approve/reject with note.
- **Prompt hot-swap consumer**: graph nodes read `_prompt-overrides/<agent>.jsonl` at startup, take the latest applied entry as a prompt suffix. Gated by `USE_SELF_IMPROVEMENT=true` (flag already registered).
- **Auto-apply mode** for narrow low-risk config kinds (Super Admin opt-in per kind). Requires scoring confidence threshold and min sample_size.
- **Metrics** in cost dashboard: proposals/week, approval rate, applied count, mean cost delta per applied proposal.

### Phase 12-B — Admin UI
- Self-Improvement tab consumes `store.list` + `store.readAudit` + `store.approve/reject` directly. Backend is a thin HTTP wrapper over the store.
- Audit log viewer shared with admin actions (appendAudit/readAudit already exist in Phase 12-A).

### Phase 14-B — Production handlers
- Add a `self_improvement_propose` handler to the registry — scheduled proposer runs land in the queue, processed at low priority.
- Add a `self_improvement_evaluate` handler — per-proposal evaluation, enqueueable as N replay sub-jobs under the round-robin fairness that Phase 14-A already ships.

### Phase 13-B — Replay
- Replay's `executeReplay` is the `runReplay` argument 15-B will pass to `evaluator`. No changes to replay needed — just wire the call.
- `nodeStubs` in replay become "proposal-aware stubs" that apply the proposed change mid-replay. Natural extension point.

### Phase 7-B/C/D — Memory Layer backends
- Heuristic proposer reads via `memory.recall({limit:500})`. With sqlite/postgres/vector backends, recall gets smarter (semantic search on tags, etc.). No proposer change needed — the interface is stable.

### Phase 18 — Pipeline Module Marketplace
- `graph_change` proposals get unlocked here. A module manifest includes "I can accept graph-topology proposals for my nodes" — the applier dispatches via the module's exposed API, not file edits.

## Stats

- **1 session**
- **$0.00 spent** (all stubs, no LLM calls; comparator injection worked)
- **0 new dependencies** (uses node built-ins only)
- **7 files created** in `cognitive-engine/self-improvement/`: `store.js`, `proposer.js`, `evaluator.js`, `applier.js`, `smoke-test.js`, `README.md`, plus pre-existing `types.js`
- **2 files modified**: `admin-substrate/registry.js` (+1 flag), `admin-substrate/smoke-test.js` (count bumps 8→9)
- **0 files modified** in: graph files, `tools.js`, `telemetry.mjs`, memory-layer, concurrency, replay, artifacts, cost-tracker, courier, admin-substrate core logic
- **4 phase docs**: Plan (expanded), Status, Decisions, Lessons
- **6 Decisions**: D141-D146

## Phase 15-A exit criteria — met

- ✅ `self-improvement/` scaffolded (types, store, proposer, evaluator, applier, smoke-test, README)
- ✅ Proposal state machine implemented and enforced pre-disk-touch
- ✅ Audit log append-only; 5 entries per full lifecycle (create + 4 transitions)
- ✅ Heuristic proposer with 3 rules, dependency-injected via `{rules, minSupport}`
- ✅ Proposer→store dedupe works idempotently across re-runs
- ✅ Evaluator scores via replay harness; tolerates per-sample failures
- ✅ Applier writes via Phase 12-A for configs; separate jsonl log for prompt overrides
- ✅ `graph_change` refused at apply time (D145)
- ✅ All applies gated by Super Admin approval (D146)
- ✅ **87 smoke-test assertions all pass**
- ✅ Admin-substrate smoke still green (41 assertions) with flag count bump
- ✅ Zero regression risk — graph files / tools.js / telemetry.mjs untouched
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 15-B brain + comparators + UI + hot-swap deferred (needs OpenRouter credit)

Phase 15-A is **wired, tested, and ready**. Substrate is firm — 15-B brings the brain.
