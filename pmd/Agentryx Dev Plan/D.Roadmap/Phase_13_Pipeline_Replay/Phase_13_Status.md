# Phase 13 — Status: 13-A + 13-B Tier B + 13-B LLM-stub substrate COMPLETE ✅  (full 13-B close-out: real Sonnet cycle validation + side-by-side diff UI deferred)

**Phase started**: 2026-04-23
**Phase 13-A closed**: 2026-04-23 (replay engine: collector / planner / executor)
**Phase 13-B Tier B closed**: 2026-05-09 (read-only Replay UI, same session as the visible-factory sprint after Phase 21-A.1)
**Phase 13-B LLM-stub substrate closed**: 2026-05-11 (default NodeStub + execute endpoint + smoke; dispatcher defaults to in-process stub, opts into real Sonnet/Opus via body.dispatcher)

## Phase 13-B LLM-stub substrate — what shipped (2026-05-11)

**`cognitive-engine/replay/llm-stub.js`** (new, ~175 lines):
- `createLLMNodeStub({llmCall, agentSystemPrompts?, maxOriginalChars?, maxParentChars?})` — returns a Phase 13-A `NodeStub`-shaped function. Builds prompt from original artifact + resolved parents; calls injected `llmCall`; returns `{kind, content, agent, model, node, cost_usd, latency_ms}`.
- `buildReplayPrompt({original, parents, agentSystemPrompts, maxOriginalChars, maxParentChars})` — pure prompt-builder (exported separately for testability + reuse).
- `createLLMNodeStubsForPlan(plan, snapshot, deps)` — convenience: produces a `{agent_name → stub}` map for every unique agent in the plan's replay set.
- `DEFAULT_AGENT_SYSTEM_PROMPTS` — per-agent prompt for all 10 named agents (Picard / Sisko / Troi / Jane / Spock / Torres / Tuvok / Data / Crusher / O'Brien); unknown agents fall back to `GENERIC_SYSTEM_PROMPT`.
- Truncation defaults: 4000 chars for ORIGINAL, 1500 chars per parent — keeps prompt budget tight; override per-call if needed.
- **Re-produce, don't re-decide** (preserves D133): the stub is asked to produce a fresh sample of the same step, not to revise the architecture.

**`POST /api/factory-admin/replay/runs/:id/execute`** in `factory-dashboard/server/telemetry.mjs`:
- Body: `{ replay_from_artifact_id, substitutions?, dispatcher?, project_dir? }`
- Loads snapshot → builds plan → constructs `nodeStubs` map via `createLLMNodeStubsForPlan` → calls `executeReplay`
- Dispatcher selection:
  - `dispatcher: "stub"` (default) — in-process stub `llmCall`; `$0` cost, fast, no LLM dependency
  - `dispatcher: "sonnet"` / `"opus"` — routes through `loadArchitect()` + `pickDispatcher()` + the Phase 21-B LLM dispatcher (same machinery the cadence cycles use). Fails open to stub if dispatcher init fails (substrate must not block on LLM infra failure).
- Logs `🔁 Replay started ... (N steps)` + `✅/⚠️ Replay complete ...` to Live Trace.
- Returns the `ReplayResult` from `executeReplay`.

**Smoke test** — `cognitive-engine/replay/llm-stub.smoke.js`:
- **39 assertions** across 10 scenarios — buildReplayPrompt (agent-specific + generic-fallback + truncation); createLLMNodeStub (happy path + invalid result + missing fields + cost/latency defaults + dep validation + custom prompts merge); createLLMNodeStubsForPlan (one-stub-per-unique-agent); DEFAULT_AGENT_SYSTEM_PROMPTS roster completeness (10 agents)
- All pass; no real LLM, no real artifact store

## What stays for full 13-B close-out

- **First real LLM cycle through the endpoint** — founder action: flip `USE_ARTIFACT_STORE=on`, run a real pipeline that produces replayable artifacts, then POST to the execute endpoint with `dispatcher: "sonnet"`. Validates the LLM stub produces sensible replay output end-to-end.
- **Side-by-side diff UI** — Replay page extension that compares original artifact content vs replayed content for any replayed step. Visual confirmation that "same step, fresh sample" produces interesting variation.
- **Cross-pipeline replay UI** — `substitutions` parameter is plumbed at the executor level (D134) but lacks a UI to construct cross-pipeline plans.
- **Cost aggregation in UI** — replays have `cost_usd` per artifact; Replay UI doesn't yet aggregate "this replay cost $X total" — small addition.
**Duration**: 13-A single session; 13-B Tier B ~10 minutes elapsed (composition over `listRunIds` + `collectRun`)

---

## Phase 13-B Tier B — what shipped (read-only)

**Backend** (`factory-dashboard/server/telemetry.mjs`):
- `GET /api/factory-admin/replay/runs` — calls `listRunIds(AGENT_WORKSPACE)`, returns the list with a friendly empty-state note when 0 runs (explains `USE_ARTIFACT_STORE` is the missing flag)
- `GET /api/factory-admin/replay/runs/:id` — calls `collectRun(AGENT_WORKSPACE, runId)`, returns the full RunSnapshot

**Frontend** (`factory-dashboard/src/components/Replay.tsx`, sidebar item 5):
- Two-column layout: run list (left) + run detail (right)
- Run detail header strip: `project_id` / `run window` / `agents` / `total cost`
- Chronological artifact timeline: per-artifact card with `id` + agent pill (color-coded per Star Trek name) + `kind` + `node` + timestamp
- Click an artifact to expand → model + cost + latency + `parent_ids` (implicit DAG)
- Empty-state banner explains exactly what's needed: flip `USE_ARTIFACT_STORE` (Admin → Flags), let a pipeline run, surface populates automatically

## What stays for full 13-B (deferred — needs OpenRouter)

- **Default LLM stub** that re-invokes the original agent during replay (replaces test-injected `nodeStub`). Needs OpenRouter credit + the cognitive-engine pipeline running real LLM calls.
- **`POST /api/factory-admin/replay/runs/:id/execute`** — substitution mode (frozen vs fresh inputs)
- **Cross-pipeline replay** — replay one run inside another's context
- **Side-by-side diff view** — compare two runs on the same task

Empty today because Phase 6-B (`USE_ARTIFACT_STORE`) is OFF — pipelines aren't writing replayable artifacts. Wired-but-empty until 6-B flips on (which itself needs OpenRouter for the real pipeline cycle).

---

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 13-A.1 | `replay/types.js` — RunSnapshot, ReplayPlan, NodeStub, ReplayResult shapes + id helpers | ✅ done |
| 13-A.2 | `replay/run-collector.js` — gather artifacts for a run_id from workspace | ✅ done |
| 13-A.3 | `replay/planner.js` — build dependency graph, identify replay subset, derive new run_id | ✅ done |
| 13-A.4 | `replay/executor.js` — execute plan with stubbed nodes, write new artifacts with proper lineage | ✅ done |
| 13-A.5 | Smoke test — 36 assertions across collector, planner (2 modes), executor (3 cases) | ✅ done — all pass |
| 13-A.6 | `replay/README.md` + flag docs | ✅ done |
| 13-B | Default LLM stub + HTTP endpoint + React UI + cross-pipeline replay | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/replay/types.js` (new, ~75 lines)
- `RunArtifact`, `RunSnapshot`, `ReplayPlan`, `NodeStubInput`, `NodeStubOutput`, `ReplayResult` JSDoc shapes
- `deriveReplayRunId(sourceRunId, seq)` — builds `<source>.replay.<N>` format
- `nextReplaySequence(existingRunIds, sourceRunId)` — finds next unused number
- `SCHEMA_VERSION = 1`

### `cognitive-engine/replay/run-collector.js` (new, ~55 lines)
- `collectRun(workspaceRoot, runId)` — uses Phase 7-A `walkArtifacts()`, filters by `produced_by.run_id`
- Returns ordered `RunSnapshot` (sorted by `produced_at`)
- Validates single-project assumption (throws if a run spans multiple projects)
- `listRunIds(workspaceRoot)` — distinct run_ids visible across all projects

### `cognitive-engine/replay/planner.js` (new, ~60 lines)
- `buildReplayPlan(snapshot, params)` — walks `parent_ids` edges, computes:
  - `replay_artifact_ids`: pivot + all descendants (in temporal order)
  - `frozen_artifact_ids`: parents of replay set that are NOT themselves in replay set
  - `new_run_id`: derived via `deriveReplayRunId` + `nextReplaySequence`
- Supports `substitutions` map (artifact_id → replacement_id)

### `cognitive-engine/replay/executor.js` (new, ~95 lines)
- `executeReplay(plan, ctx)` — runs through `replay_artifact_ids` in temporal order
- For each: resolves parents (frozen / substituted / freshly-replayed), invokes registered stub, writes new artifact via Phase 6-A `writeArtifact()`
- Stubs receive original artifact + resolved parents + new_run_id + project_id
- New artifacts tagged `["replay", "source:<source_run_id>"]` and meta `replays_artifact_id` back-pointer
- Substituted parents from outside snapshot are resolved via `getArtifact()` from disk
- Errors return `{ok: false, error}` — never throws

### `cognitive-engine/replay/smoke-test.js` (new, ~165 lines)
- Builds synthetic 4-artifact recorded run (spock → troi/tuvok → obrien) + 1 noise artifact in different run
- Tests 7 scenarios:
  - run-collector: matched filter, agent ordering, missing run, distinct run_ids
  - id helpers: format + sequence calculation
  - planner from mid-graph: 2 replay + 2 frozen, including sibling-as-frozen-parent case
  - planner from root: all replay, nothing frozen, sequence picks next available
  - executor frozen-input replay: 13 assertions including parent-rewrite (new troi → frozen spock; new obrien → frozen tuvok + new troi)
  - executor substitution mode: external artifact resolved correctly via getArtifact
  - executor missing stub: graceful failure with descriptive error

### `cognitive-engine/replay/README.md` (new)
- Replay model diagram, substitution mode example, API, stub contract, design decisions, 13-B preview

### Unchanged
- Graph files, artifact store, memory layer, courier, verify integration, cost tracker, admin substrate, telemetry.mjs — all untouched
- Zero regression risk

## Smoke test highlight

```
[executor — frozen-input replay from troi]
  ✓ executor ok
  ✓ 2 new artifacts written
  ✓ troi has 1 parent (spock, frozen)
  ✓ obrien has 2 parents (troi-new + tuvok-frozen)
  ✓ new troi parent = original spock (frozen)
  ✓ new obrien parent includes original tuvok (frozen)
  ✓ new obrien parent includes NEW troi (replayed)
  ✓ new artifact tagged replay
  ✓ meta tracks original

[executor — substitution mode]
  ✓ troi saw substituted spock id (ART-0008)
```

## Bug caught + fixed during smoke test

First implementation of `executor.js` only resolved parents from `ctx.snapshot`. When substitution pointed at an artifact from a DIFFERENT run (not in snapshot), the parent resolved to a placeholder `{agent: "?"}` and the stub couldn't find it by agent name. Fixed by adding fallback `getArtifact(projectDir, resolvedId)` lookup. Lesson noted.

## Why 13-B deferred

13-B = default LLM stub + HTTP endpoint + React UI + cross-pipeline replay. Requires:
- **OpenRouter credit** for default stub to re-invoke real agents
- **Server changes** in `factory-dashboard/server/telemetry.mjs` to expose replay endpoints
- **React UI work** for timeline + side-by-side diff views
- **Cross-pipeline coordination** — pre_dev → dev → post_dev replay across 3 separate graph runners

Ship 13-A as the firm engine; 13-B layers UI + LLM atop a tested substrate.

## Feature-flag posture

| Flag | Default | Effect |
|---|---|---|
| (existing 8 flags ...) | off | Phases 4-12 |
| `USE_REPLAY` | off | Phase 13 — no runtime effect in 13-A; 13-B exposes HTTP endpoint |

## Phase 13-A exit criteria — met

- ✅ `replay/types.js` — full type system + id helpers
- ✅ `replay/run-collector.js` — workspace walker + run filter
- ✅ `replay/planner.js` — descendant identification + frozen-set computation + new run_id
- ✅ `replay/executor.js` — stub invocation + lineage rewrite + substitution support
- ✅ Smoke test — **36 assertions all pass**
- ✅ Substitution mode works against artifacts outside the original snapshot
- ✅ Missing-stub case fails gracefully (returns `{ok: false}`, no throw)
- ✅ Zero changes to graph files, artifact store, memory layer, or any other module
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 13-B (LLM stub + UI + HTTP) deferred

Phase 13-A is **wired, tested, and ready**. Engine substrate firm; 13-B builds the operator-facing layer.
