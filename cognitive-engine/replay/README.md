# Replay Engine (Phase 13-A)

Time-travel through past LangGraph runs. Pick a `run_id`, replay from any node with frozen upstream inputs, or with substituted artifacts to test what-if scenarios. Built directly on Phase 6-A artifact store and Phase 7-A artifact walker.

## Status: Phase 13-A scaffolding

36 smoke-test assertions pass on a synthetic 4-artifact recorded run. **No real LLM execution yet** (13-A uses stubs); 13-B wires real agent invocation when OpenRouter credit allows.

## Files

- `types.js` — `RunSnapshot`, `ReplayPlan`, `NodeStub`, `ReplayResult` shapes + `deriveReplayRunId`/`nextReplaySequence` helpers
- `run-collector.js` — `collectRun(workspaceRoot, runId)` walks all projects' artifact stores, returns ordered snapshot
- `planner.js` — `buildReplayPlan(snapshot, {replayFromArtifactId, substitutions, ...})` builds the dependency-aware execution plan
- `executor.js` — `executeReplay(plan, {projectDir, nodeStubs, snapshot})` walks the plan, invokes stubs, writes new artifacts with proper lineage
- `smoke-test.js` — 36 assertions across collector, planner (2 modes), executor (3 cases)

## Replay model

A recorded run is the set of artifacts sharing one `produced_by.run_id`, linked by `parent_ids`:

```
ART-0001  spock     run-abc
   │
   ├──→ ART-0002  troi      run-abc  parent: ART-0001
   │       │
   │       └──→ ART-0004  obrien    run-abc  parents: ART-0002, ART-0003
   │              ▲
   └──→ ART-0003  tuvok     run-abc  parent: ART-0001
            │
            └──────────────────┘
```

A **replay** picks a pivot artifact and re-executes that artifact's producing node + every descendant. Everything upstream stays frozen as input.

```
buildReplayPlan(snapshot, { replayFromArtifactId: ART-0002 })
  → replay_artifact_ids: [ART-0002, ART-0004]    (troi + obrien)
  → frozen_artifact_ids:  [ART-0001, ART-0003]   (spock + tuvok)
  → new_run_id:           "run-abc.replay.1"
```

Executor writes new artifacts with:
- `produced_by.run_id = new_run_id`
- `parent_ids` rewritten: replayed parents → new ids; frozen parents → original ids
- `tags: ["replay", "source:run-abc"]`
- `meta.replays_artifact_id` → original artifact id (back-pointer)

## Substitution mode

Optionally replace an artifact with a different one before replay. The substituted artifact is treated as frozen input. Use case: "what if Spock's triage were better — let me give Troi this hand-edited spec instead and see what code comes out."

```js
buildReplayPlan(snapshot, {
  replayFromArtifactId: ART-0002,            // start replay at troi
  substitutions: { ART-0001: ART-0099 },     // swap spock's spec
})
```

Substituted artifacts can come from any project / any run — executor resolves them via `getArtifact()` if not in the original snapshot.

## API

```js
import { collectRun, listRunIds } from "./replay/run-collector.js";
import { buildReplayPlan } from "./replay/planner.js";
import { executeReplay } from "./replay/executor.js";

const snap = await collectRun(workspaceRoot, "run-abc");

const plan = buildReplayPlan(snap, {
  replayFromArtifactId: "ART-0002",
  substitutions: {},                                    // optional
  existingRunIds: await listRunIds(workspaceRoot),      // for sequence calc
});

const result = await executeReplay(plan, {
  projectDir: "/path/to/2026-04-23_demo",
  snapshot: snap,
  nodeStubs: {
    troi: async ({ original, parents, new_run_id }) => ({
      kind: "code_output",
      content: "// rewritten code",
      agent: "troi",
      cost_usd: 0.10,
    }),
    obrien: async ({ original, parents }) => ({
      kind: "deploy_status",
      content: "deployed",
      agent: "obrien",
      cost_usd: 0.01,
    }),
  },
});
// result = { ok, new_run_id, new_artifact_ids, produced, duration_ms }
```

## Stub contract

A `NodeStub` receives:
- `original` — the artifact this stub is replacing (full metadata)
- `parents` — resolved parent artifacts (from snapshot, or substituted, or just-produced in this replay)
- `new_run_id`, `project_id` — for tagging

Returns `{kind, content, agent?, model?, node?, cost_usd?, latency_ms?}` — agent/model/node default to original's.

13-A stubs are user-supplied for testing. 13-B will provide a default LLM-backed stub that re-invokes the original agent with the new parent context.

## Why stubs in 13-A

- **No LLM cost.** Smoke tests run free.
- **Deterministic.** Tests assert exact lineage and content; LLM responses are non-deterministic.
- **Stub interface IS the spec for 13-B.** Real LLM execution slots in as one stub registration; no API change.

## Smoke test

```
$ node replay/smoke-test.js
[run-collector]                              ✓ 8 assertions
[id helpers]                                 ✓ 4 assertions
[planner — replay from troi (mid-graph)]     ✓ 8 assertions
[planner — replay from spock (root)]         ✓ 3 assertions
[executor — frozen-input replay from troi]   ✓ 13 assertions (lineage, tags, meta correct)
[executor — substitution mode]               ✓ 2 assertions (substituted parent visible to stub)
[executor — missing stub]                    ✓ 2 assertions (graceful failure)

[smoke] OK  — 36 assertions
```

## Feature flag

```
USE_REPLAY=true     # 13-B onwards: HTTP endpoint exposes replay; 13-A: no runtime effect
```

## Design decisions

- **Replay is a separate library** (D131) — graph files unchanged. Same scaffolding discipline as Phases 5-A through 12-A.
- **New run_id format `<source>.replay.<N>`** (D132) — preserves lineage in the run_id itself; greppable.
- **Stubs in 13-A; real LLM execution in 13-B** (D133) — substrate first, costly side later.
- **Frozen + substitution modes both supported in 13-A** (D134) — same engine, different parameters.
- **Replay artifacts written to the same `_artifacts/` store** (D135) — replays are first-class history; no shadow store to manage.

## Rollback

13-A has no runtime hooks. The library exists but nothing calls it. Removal = deleting the directory.

## What 13-B adds

- Default LLM stub that re-invokes the original agent with new parent context
- HTTP endpoint `POST /api/replay/{run_id}` for triggering replays from admin UI
- React UI: timeline view, side-by-side artifact diff (original vs replayed)
- Cross-pipeline replay (pre_dev → dev → post_dev as one continuous timeline)
- Cost guardrail: replay always counts against same budget caps as live runs
- Phase 15 (Self-Improvement) integration: replay proposed graph changes against past runs to evaluate
