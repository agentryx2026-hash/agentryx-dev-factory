# Phase 15 — Decisions Log

## D141 — Proposals stored one-file-per-proposal, not per-state directories

**What**: `<workspace>/_proposals/PROP-NNNN.json` with state inside the JSON, mutated via atomic write+rename. Audit log append-only at `_audit.jsonl`. Contrast Phase 14-A jobs which use per-state directories.

**Why**:
- **UI expects list-all-states** far more often than list-queued-only. A single `readdir` returns every proposal the reviewer needs to see; filtering happens in memory. In Phase 14-A jobs, workers care only about `queue/` for lease; here the human reviewer cares about `ready/` AND `approved/` AND `applied/` together.
- **Slower transition rate**: proposals move through states on human timescales (hours → days). The throughput Phase 14-A optimized for (many races per second) isn't the bottleneck. Atomic write+rename of one JSON is sufficient.
- **Immutable audit in a separate file**: the JSONL append gives a tamper-resistant history without bloating the proposal document.

**Tradeoff**: no cheap "what's queued for review right now?" — you readdir everything and filter. At 10k proposals that's a full scan per list call. Acceptable for R&D factory; Phase 15-B may add a small sqlite index if scale demands.

## D142 — Linear state machine with rejected as universal bail-out

**What**: Legal transitions: `draft → evaluating → ready → approved → applied`. Any non-terminal state can move to `rejected`. `rejected` and `applied` are terminal — no way back. Enforced in `types.js::canTransition`, asserted before disk write in `store.transition`.

**Why**:
- **Only one forward direction**: reduces the matrix of things tests must cover. Any deviation from the single flow is either a reject or an illegal-transition error.
- **Rejected-from-any-non-terminal matches human workflow**: operators may want to kill a proposal before even evaluating it (obviously bad, duplicate of existing, off-scope). Forcing them to send it through evaluation would burn replay budget for nothing.
- **Applied is terminal, not reversible**: if an applied change needs undoing, the answer is "create a new proposal that proposes the opposite change" — that way the undo also gets reviewed, evaluated, and audited. Preserves the "every factory change is reviewed" invariant.
- **`canTransition` in types.js is the single source of truth**: store, UI (when it arrives), CLI, tests all import the same predicate. No drift between layers.

**Tradeoff**: no "re-open this rejected proposal" action. The workflow says "create a fresh one." Two extra clicks in the UI — worth it for immutability.

## D143 — Proposer is dependency-injected; multiple brains can coexist

**What**: `createHeuristicProposer({rules, minSupport})` returns `{id, propose(ctx)}`. 15-A ships one heuristic proposer with 3 rules. 15-B will ship an LLM proposer. Possible 15-C adds an RL / Hermes-Tinker-Atropos proposer. The `store.create` call stamps `created_by: proposer.id` so the audit log tracks which brain proposed what.

**Why**:
- **Same DI pattern as Phase 9-A `fixRouter`, Phase 13-A `nodeStubs`, Phase 14-A `handlerRegistry`**: convention now — callers provide a function the engine invokes at the right moment. No global state, no side effects at module load.
- **Configurability-first** (P1): multiple proposer implementations can run in parallel and their proposals compared in the Verify portal. The "best brain" debate is data-driven, not architectural.
- **Easy to test**: smoke test injects a fake memory → heuristic proposer → store. Fake memory is 10 lines. Real memory-layer integration is just a constructor arg swap.

**Tradeoff**: no registry of installed proposers in 15-A — caller imports the one it wants. Phase 18 (marketplace) will add discovery. Deferred.

## D144 — Evaluator is a harness with dependency-injected comparator and plan builder

**What**: `evaluateProposal(proposal, ctx)` takes `ctx.runReplay` + `ctx.compareOutcomes` + optional `ctx.buildPlan`. 15-A ships defaults: `defaultBuildPlan` (pivot on last artifact) and `defaultCompareOutcomes` (stub that returns zero deltas).

**Why**:
- **Real comparators need LLM-graded outcomes AND graph-written artifact costs** — both unavailable in 15-A. Shipping the harness with stubs proves the contract without blocking on OpenRouter credit.
- **`buildPlan` as an injection point**: different proposal kinds need different pivots. A `prompt_change` for Troi should pivot on the first Troi artifact; a `model_change` for Spock on the first Spock artifact; a `config_change` pivots on nothing (rerun the whole pipeline). 15-A's default is a placeholder; 15-B's LLM-aware planner will specialize by kind.
- **Replay failure tolerance baked in** (smoke test proves): if `runReplay` returns `{ok:false}` or throws for one sample, other samples still count. `sample_size` decrements; reviewer sees the reduced support in the evaluation result.
- **Queue integration optional in 15-A**: caller decides whether to run replays inline (fast, small sample) or enqueue them via Phase 14-A (slow, large sample, parallel). Evaluator itself has no opinion.

**Tradeoff**: the stub comparator makes the evaluator meaningless in 15-A for actual decisions — every proposal scores 0/0/0. That's fine: 15-A's claim is "the lifecycle works," not "self-improvement actually improves the factory today." The real test comes in 15-B.

## D145 — Applier edits only registry-known configs and prompt overrides; never graph code

**What**: `config_change` goes through Phase 12-A `writeConfig` (registry-gated). `model_change` patches the Phase 2 `llm_routing` config via the same path. `prompt_change` appends to `_prompt-overrides/<agent>.jsonl` (the graph doesn't consume this yet — 15-B adds the reader). `graph_change` throws an error at apply time.

**Why**:
- **Clear blast-radius boundary**: config writes are reversible (rewrite the file; restart). Prompt overrides are additive (append-only log; disabling the feature flag reverts). Graph code edits can break the factory unrecoverably.
- **Phase 18 territory**: structural pipeline changes are modules-as-packages work (Marketplace phase). Letting the self-improvement proposer touch graph code before marketplace versioning exists would be self-sabotage.
- **Atomicity carried through from Phase 12-A**: `writeConfig` does temp-file + rename. The applier inherits atomicity for free.
- **Prompt overrides as a log, not a replacement**: appending every accepted change preserves history. 15-B's consumer can take the latest entry, or concatenate, or apply all. Policy decision deferred to when we have real usage data.

**Tradeoff**: `prompt_change` in 15-A has no runtime effect — the override file is written but nothing reads it. That's intentional: 15-A's audit loop (review → approve → check the override file exists) proves the flow; the hot-swap consumer is 15-B.

## D146 — All proposals require explicit Super Admin approval; no auto-apply in 15-A

**What**: The applier refuses any proposal not in `approved` state. There's no auto-approve, no green-score auto-apply, no threshold magic. `store.approve(id, {reviewer})` requires a reviewer string; applier's action is gated by the state check.

**Why**:
- **Trust before automation**: we're in v0.0.1 R&D. We don't yet know what a "good" evaluation result looks like. Auto-applying on green could silently bake in regressions that the stub comparator can't detect.
- **Audit clarity**: every applied change has a reviewer name in the audit log. When a future change misbehaves, the audit log points to a specific human who approved it.
- **Easy to relax later**: 15-C may introduce `auto_apply_on_green: {max_risk_kinds, min_sample_size, min_cost_delta}` — an additive config. Tightening autonomy after granting it is harder than the reverse.
- **Matches D145's safety posture**: both decisions (narrow applier + mandatory human gate) belt-and-suspender the guarantee that self-improvement can't silently break the factory.

**Tradeoff**: review becomes the bottleneck once 15-B emits many proposals. Mitigation: filtered queues by kind, bulk-review UI, per-kind reviewer delegation. All 15-B design work, not blockers for 15-A.
