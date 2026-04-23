# Phase 15 — Self-Improvement Loop

**One-liner**: Agents propose changes to the pipeline (graph topology, prompts, model assignments) based on observed failures and lessons. All proposals gated by Super Admin approval before merge. Evaluation uses Phase 13 replay against past runs.

**Pre-2026-04-21 sketch noted Hermes Tinker-Atropos as a candidate** — that remains a future option for the actual proposer-LLM brain. **Phase 15-A ships the substrate** (proposal lifecycle + evaluator harness + approval store) regardless of which proposer eventually fills the brain slot.

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 ("read existing code before scoping"):

- **Phase 7-A memory layer** stores `lesson` and `pattern` observations — the natural input. "Troi hallucinates auth middleware" is a Proposal-worthy lesson.
- **Phase 13-A replay engine** lets us re-execute past runs with substituted artifacts — exactly what's needed to evaluate "what if we changed the spec to include auth?"
- **Phase 14-A concurrency** lets us run experiments (replays of N past runs) without blocking real factory work.
- **Phase 12-A admin substrate** has 4-level role hierarchy + audit log — the approval workflow drops in.
- **No proposer-LLM exists yet** in v0.0.1. 15-A scaffolding includes a stub proposer; real LLM proposer is 15-B (and potentially 15-C/D for Tinker-Atropos integration).

## Design

A **Proposal** is a structured suggestion to change one of:
- Prompt template for a named agent
- LLM tier / model assigned to a task
- Graph node ordering / inclusion
- Config value (cost threshold, courier routing, etc.)

```
memory observations (Phase 7-A)
        │
        ▼
  proposer (LLM-backed in 15-B; stub in 15-A) — emits Proposals
        │
        ▼
  approval store (Phase 12-A audit log + new state machine)
        │
        ▼
  evaluator — uses Phase 13-A replay + Phase 14-A concurrency
        │
        ▼
  EvaluationResult (cost delta, success rate delta, sample size)
        │
        ▼
  Super Admin reviews via admin UI (Phase 12-B), approves/rejects
        │
        ▼
  on approve: applier writes the change to config files / templates / graphs
        │
        ▼
  audit log records the merge
```

## Scope for this phase (15-A: substrate)

Mirrors 5-A through 14-A pattern.

| Sub | What | Deliverable |
|---|---|---|
| 15-A.1 | `self-improvement/types.js` — Proposal, ProposalKind, ProposalState, EvaluationResult shapes | ✅ |
| 15-A.2 | `self-improvement/store.js` — proposal storage with state machine (draft → evaluating → ready → approved/rejected → applied) | ✅ |
| 15-A.3 | `self-improvement/proposer.js` — extract Proposals from memory observations (heuristic stub; LLM in 15-B) | ✅ |
| 15-A.4 | `self-improvement/evaluator.js` — score Proposals via replay sample (uses Phase 13-A) | ✅ |
| 15-A.5 | `self-improvement/applier.js` — apply approved Proposals to config/templates (file-write only; no graph mutation) | ✅ |
| 15-A.6 | Smoke test — full lifecycle on a synthetic memory + recorded run | ✅ |
| 15-A.7 | `self-improvement/README.md` + flag docs | ✅ |

**Out of scope for 15-A** (deferred to 15-B/C):

- Real LLM proposer (heuristic stub for now)
- Hermes Tinker-Atropos integration
- React UI for the approval workflow (relies on Phase 12-B admin UI)
- Prompt-template hot-swap (requires graph runtime support)
- Auto-apply mode for low-risk proposal kinds (always Super-Admin-gated in 15-A)

## Why this scope is right

- **Substrate first, brain later.** The proposal lifecycle, evaluator harness, and applier are the durable pieces. The brain (heuristic vs LLM vs RL) is swappable.
- **Phase 13-A replay is THE evaluator's power tool.** Without replay, evaluating "what if Troi got a better spec?" requires running real LLM calls on every project — expensive. With replay, you sample N recorded runs cheaply.
- **Phase 14-A queue lets evaluation run in background.** Submit a batch of replay jobs, scheduler runs them at low priority while real work continues.
- **Phase 12-A admin substrate provides approval gating + audit for free.** New "proposal" config kind in registry is a 1-line addition.
- **Heuristic proposer in 15-A is enough to ship the lifecycle.** Walks `memory-layer/index.jsonl`, finds repeated `lesson` observations with same tags, emits a Proposal. Crude but proves the contract.

## Phase close criteria

- ✅ `self-improvement/` scaffolded
- ✅ Proposal state machine implemented and audit-logged
- ✅ Heuristic proposer extracts Proposals from synthetic observations
- ✅ Evaluator scores Proposals via replay against synthetic recorded runs
- ✅ Applier writes config changes to disk (atomic via Phase 12-A `config-store`)
- ✅ Smoke test: full lifecycle (observe → propose → evaluate → approve → apply)
- ✅ `USE_SELF_IMPROVEMENT` flag documented (no runtime effect in 15-A)
- ✅ No changes to graph files, memory layer, replay engine, concurrency engine, or admin substrate
- ✅ Phase docs: Plan (expanded), Status, Decisions (D141-Dxx), Lessons

## Decisions expected

- **D141**: Proposals stored as files under `<workspace>/_proposals/` (same JSONL pattern as queue + memory)
- **D142**: Proposal state machine: `draft → evaluating → ready → approved | rejected → applied` (one direction only)
- **D143**: Proposer is dependency-injected (heuristic in 15-A; LLM in 15-B; Hermes-RL in possible 15-C)
- **D144**: Evaluator uses replay + a stub `compareOutcomes` function — real outcome comparison is a deeper LLM eval task in 15-B
- **D145**: Applier ONLY edits Phase 12-A registry-known configs and template files — never modifies graph code
- **D146**: All proposals require explicit `super_admin` approval — no auto-apply in 15-A regardless of evaluation score
