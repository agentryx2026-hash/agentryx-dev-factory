# Phase 14 — Status: 14-A COMPLETE + queue read UI ✅  (14-B remainder DEFERRED — handlers + per-project quotas)

**Phase started**: 2026-04-23
**Phase 14-A closed**: 2026-04-23
**Duration**: single session
**UI surface added**: 2026-05-09 — Dev-Hub Admin → 📊 Queue panel: 4-stat strip (queued / in-flight / done / failed via `queue.stats()`), live queued + in-flight job lists with priority and worker IDs, auto-refresh every 5s. **Still pending**: real factory handlers (`pre_dev` / `dev` / `post_dev` / `project_intake` / `training_gen` / `training_video_render`) registered in the queue, HTTP submission, per-project quotas wired to Phase 11-A, crash recovery. Real submissions need OpenRouter for the LLM-driven graphs.

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 14-A.1 | `concurrency/types.js` — Job/JobState/SchedulerConfig/WorkerStatus shapes | ✅ done |
| 14-A.2 | `concurrency/queue.js` — filesystem-backed queue with atomic lease/complete/fail | ✅ done |
| 14-A.3 | `concurrency/scheduler.js` — worker pool + 3 scheduling policies | ✅ done |
| 14-A.4 | `concurrency/handler-registry.js` — kind→handler dependency injection | ✅ done |
| 14-A.5 | Smoke test — 28 assertions across 7 test groups | ✅ done — all pass |
| 14-A.6 | `concurrency/README.md` + flag docs | ✅ done |
| 14-B | Real factory handlers + HTTP submission + UI + per-project quotas | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/concurrency/types.js` (new, ~50 lines)
- `Job`, `JobState`, `SchedulerConfig`, `WorkerStatus`, `JobHandler` JSDoc shapes
- 4 job states: queued / leased / done / failed
- 3 scheduling policies: round_robin / priority / fifo
- `nowIso()` timestamp helper

### `cognitive-engine/concurrency/queue.js` (new, ~140 lines)
- `createQueue(rootDir)` returns queue instance with methods:
  - `enqueue({project_id, kind, payload, priority?, max_attempts?})` → Job
  - `lease(jobId, workerId)` → Job | null (atomic write+unlink, race-safe)
  - `complete(jobId, result)` → Job (moves in-flight → done)
  - `fail(jobId, error)` → `{requeued, attempts}` (requeues if attempts left, else moves to failed)
  - `listQueued()`, `listInFlight()`, `stats()`
- Filesystem layout: `<root>/_jobs/{queue,in-flight,done,failed,work}/`
- Monotonic JOB-NNNN ids via `_seq` file

### `cognitive-engine/concurrency/handler-registry.js` (new, ~25 lines)
- `createHandlerRegistry()` → `{register, get, has, list, clear}`
- Same dependency-injection pattern as Phase 9-A `fixRouter` and Phase 13-A `nodeStubs`

### `cognitive-engine/concurrency/scheduler.js` (new, ~125 lines)
- `runSchedulerOnce({queue, registry, workspaceRoot, config, drainOnly})` → `{processed, failed, workers}`
- N async workers (default 2) running parallel `workerLoop`
- Per-job working directory created at `<root>/_jobs/work/<JOB-id>/`
- Worker tracks state (idle/busy/shutdown), current_job_id, current_project_id, jobs_done, jobs_failed
- `pickNextJob(queued, policy, {servedCounts})` decides next job per policy
- `servedCounts` Map shared across workers — enables true round-robin fairness

### `cognitive-engine/concurrency/smoke-test.js` (new, ~190 lines)
- **28 assertions across 7 test groups**:
  - queue basics (6): id assignment, listQueued, stats, validation
  - lease atomicity (5): two workers race → only one succeeds
  - complete + fail + retry (5): success path + transient retry + permanent failure
  - scheduling policies (3): fifo, priority, round_robin all pick correct job
  - fairness end-to-end (4): 12 jobs, 2 workers, first 4 leased span all 4 projects
  - handler failure + retry (3): transient failure retried, succeeds on 2nd attempt
  - missing handler (2): graceful failure, moved to failed/

### `cognitive-engine/concurrency/README.md` (new)
- Layout diagram, lifecycle flow, scheduling policies table, API examples, fairness proof, decisions, 14-B preview

### Unchanged
- Graph files, `tools.js`, `telemetry.mjs`, all other modules — untouched
- Zero regression risk

## Smoke test highlight

```
[lease atomicity]
  ✓ exactly one worker leases (got 1)

[fairness end-to-end]
  ✓ 12 jobs processed (got 12)
  ✓ 0 failed
  ✓ first 4 jobs span all 4 projects (got 4: alpha,beta,gamma,delta)

[handler failure + retry]
  ✓ job eventually succeeded
  ✓ handler called 2x (got 2)
```

## Bug caught + fixed during smoke testing

First implementation of `pickNextJob` for round_robin sorted buckets by oldest-queued-job-timestamp. Result: when alpha's 3 jobs were enqueued before beta's, all 3 alpha jobs got served before any beta job — same as fifo, not round-robin.

Fix: introduced `servedCounts` Map maintained by the scheduler; passed into `pickNextJob` so round_robin sorts by served-count first, oldest-job second. Increment is at lease time (before handler runs) so concurrent workers see updated counts immediately. Smoke test then proved real fairness: first 4 leases span all 4 projects.

Lesson: "round-robin by bucket" is a misleading name when buckets carry timestamps; needed an explicit served-count signal.

## Why 14-B deferred

14-B = real factory job handlers + HTTP endpoint + UI + per-project quotas. Requires:
- **Real handler implementations** that spawn `pre_dev_graph.js`, `dev_graph.js`, `post_dev_graph.js` as subprocess workers
- **HTTP submission endpoint** in `factory-dashboard/server/telemetry.mjs` for queue submissions
- **React UI** showing queue depth, worker pool, per-project status
- **Per-project quota enforcement** wired to Phase 11-A cost-tracker (max parallel jobs / max budget per worker)
- **Crash recovery**: detect orphan in-flight jobs after restart, requeue
- **OpenRouter credit** to validate end-to-end factory runs through the queue

Ship 14-A as the firm engine; 14-B layers production wiring atop a tested substrate.

## Feature-flag posture

| Flag | Default | Effect |
|---|---|---|
| (existing 8 flags ...) | off | Phases 4-12 |
| `USE_REPLAY` | off | Phase 13 — awaits 13-B |
| `USE_JOB_QUEUE` | off | Phase 14 — awaits 14-B |

## Phase 14-A exit criteria — met

- ✅ `concurrency/` scaffolded (types, queue, scheduler, handler-registry, smoke-test, README)
- ✅ Atomic lease verified — two workers racing → exactly one succeeds
- ✅ Fairness verified — round-robin spans all projects in first N leases
- ✅ Retry semantics verified — transient failures requeue; permanent failures land in failed/
- ✅ Handler dependency injection works (stubs in test, real in 14-B)
- ✅ **28 smoke-test assertions all pass**
- ✅ Bug caught + fixed during testing (round-robin via servedCounts, not just timestamps)
- ✅ Zero changes to graph files, tools.js, telemetry.mjs, or any other module
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 14-B real handlers + HTTP + UI + quotas deferred

Phase 14-A is **wired, tested, and ready**. Engine is firm — 14-B builds the production wiring.
