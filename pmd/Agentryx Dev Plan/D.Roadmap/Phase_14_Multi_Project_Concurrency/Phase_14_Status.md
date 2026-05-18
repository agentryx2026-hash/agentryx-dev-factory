# Phase 14 — Status: 14-A + 14-B Tier B + per-project quotas COMPLETE ✅  (14-B remainder DEFERRED — legacy-path migration + 16-B/17-B/19-B handler kinds)

**Phase started**: 2026-04-23
**Phase 14-A closed**: 2026-04-23 (substrate — filesystem queue + worker pool + atomic POSIX-rename leasing + round-robin fairness)
**Phase 14-B Tier B closed**: 2026-05-10 (`pre_dev` / `dev` / `post_dev` handlers registered + long-lived worker daemon + submit endpoint + UI form)
**Phase 14-B per-project quotas closed**: 2026-05-10 (HTTP 429 budget gate at `/api/factory-admin/queue/submit`, fail-open)
**Duration**: 14-A single session; 14-B Tier B ~30 min over the substrate; quotas ~20 min

---

## Phase 14-B Tier B — what shipped

**`cognitive-engine/concurrency/handlers/factory-handlers.js`** (new):
- `registerFactoryHandlers(registry, { onLog })` — registers 3 kinds (`pre_dev` / `dev` / `post_dev`), each handler spawns the corresponding graph subprocess
- `factoryHandlerKinds()` — convenience export for UI choice lists
- `spawnGraph(graphFile, args, { onLog })` helper — Phase 16-B / 17-B handlers reuse it when they ship
- `onLog` hook pipes stdout/stderr lines from the spawned graph into telemetry's SSE Live Trace stream; founder sees pipeline output streaming in the sidebar

**Worker boot** in `factory-dashboard/server/telemetry.mjs`:
- `bootQueueWorker()` (idempotent, fail-open):
  - imports queue / handler-registry / scheduler / factory-handlers
  - registers the 3 handlers on a fresh registry
  - calls `runSchedulerOnce({ drainOnly: false, parallelism: 2, policy: 'round_robin', poll_interval_ms: 1000 })` — long-lived polling worker
  - `.catch()` wraps the worker promise; a worker crash doesn't take telemetry down; `queueWorkerStarted` resets so the worker can be rebooted via re-call
- `server.listen()` callback now boots both daemons:
  - `bootCadenceDaemon()` — Phase 21-A.1 architect daemon
  - `bootQueueWorker()` — Phase 14-B queue worker

**Submit endpoint**:
- `POST /api/factory-admin/queue/submit` — body `{ kind, project_id, payload?, priority?, max_attempts? }`
- validates kind against the 3 known kinds
- validates project_id presence
- calls `queue.enqueue(...)` and returns `{ ok, job }`
- audits via Live Trace (`📥 Queue: enqueued <kind> for project <id>`)

**UI** (Admin · Configuration → 📊 Queue panel):
- Collapsible "📥 Submit a job to the queue" form: kind dropdown + project_id input + payload JSON input + Submit button
- Existing 4-stat strip (queued / in-flight / done / failed) + queued list + in-flight list keep auto-refreshing every 5s — founder sees job state evolve live after submission

**Live verification**: `journalctl -u factory-telemetry.service` shows on restart: `📥 Queue worker started — kinds: pre_dev, dev, post_dev` alongside `📅 Architect cadence daemon started`. Endpoint validates: `POST {kind:'bogus'}` → 400; `POST {kind:'pre_dev'}` (no project_id) → 400.

## Why this is the critical-path keystone

Per `04_B_Tier_Marathon.md`: 14-B unlocks **16-B, 17-B, 19-B** (training-gen, training-videos, customer-portal). Each of those phases needs queue infrastructure before they can ship; with 14-B Tier B in place, they each register their own handler kind on the same registry without re-doing the worker work. Plus multi-project concurrency activates: round-robin fairness across `project_id` shields multi-tenant work from head-of-line blocking.

## Phase 14-B per-project quotas — what shipped (2026-05-10)

**`cognitive-engine/cost-tracker/project-quota.js`** (new, ~150 lines):
- `checkProjectQuota({ project_id, workspaceRoot, thresholds?, now?, getRollupFn? })` → `{ ok: true } | { ok: false, breach: { key, window, hard_cap_usd, current_usd } }`
- `windowRange(window, now)` — UTC bounds for `daily` / `weekly` (ISO Mon-Sun) / `monthly` / `all_time`
- `loadThresholds(path?)` — reads `configs/cost-thresholds.json`, defaults to empty list if missing (no policy → implicit pass)
- `QuotaExceededError` for callers that prefer throw-based flow
- Pure stub-injectable `getRollupFn` for tests — no fixture filesystem needed
- Scope rule: consults `global` + `project:*` only; `agent:*` and `model:*` deliberately skipped (queue doesn't know which model a job will use; those remain post-call alerts)

**`/api/factory-admin/queue/submit` gate** in `factory-dashboard/server/telemetry.mjs`:
- Before `queue.enqueue`, lazy-imports the quota helper and runs it against `QUEUE_WORKSPACE`
- On breach → HTTP 429 with `{ error: 'quota exceeded', breach: {...} }`; Live Trace logs `🚫 Queue: refused <kind> for "<id>" — quota breached (...)`
- Fail-open: a broken cost-thresholds.json or rollup error logs a warning and lets the submission through (better to over-spend than to block legitimate work because of a config typo)

**`configs/cost-thresholds.json`** seed:
- Added `project:_example` daily entry with inline documentation describing the copy-and-rename usage pattern
- Top-level `_key_format` + `_gate_scope` comments explain which keys the 14-B gate honors

**Smoke test** — `cognitive-engine/cost-tracker/project-quota.smoke.js`:
- **31 assertions** across windowRange math, threshold loading, breach detection, scope rules, boundary case (`current_usd === hard_cap_usd` counts as breach), agent-threshold-skipped, empty-thresholds-list, argument validation, QuotaExceededError shape
- All pass — no filesystem fixtures required (rollup stubbed via `getRollupFn` injection)

**Why "fail-open at the HTTP boundary" instead of "fail-closed inside queue.enqueue"**:
- Decision D212. The concurrency module stays unaware of cost tracking — keeps queue.js standalone, matches D139 (handler-registry-as-DI) philosophy.
- The HTTP submit endpoint is the only path that takes externally-originated jobs; internal scheduler.lease() doesn't need the gate (it operates on already-vetted jobs).
- Fail-open posture is intentional: a broken thresholds.json should never make the queue inaccessible. Cost overruns are recoverable (we can refund / reroute); queue downtime during a customer demo isn't.

## Phase 14-B orphan reaper — what shipped (2026-05-11)

**`cognitive-engine/concurrency/orphan-reaper.js`** (new, ~120 lines):
- `reapOrphans({queue, timeoutMs?, now?, logger?})` → `{scanned, reaped, kept, errors, requeued_ids, failed_ids}`
- Scans `_jobs/in-flight/` once; for each job whose `leased_at` is older than `LEASE_TIMEOUT_MS` (default 30 min), calls `queue.fail(jobId, "lease expired")`. The existing `fail()` machinery handles the requeue-or-fail decision based on `max_attempts`.
- `DEFAULT_LEASE_TIMEOUT_MS = 30 * 60 * 1000` — covers Opus-tier architect cycles (5-10 min) with 3x safety margin
- Configurable via `LEASE_TIMEOUT_MS` env or per-call `timeoutMs` arg
- Failure-isolated: per-job errors land in `errors[]`, reaper continues
- Invalid `leased_at` (corrupt JSON) treated as immediately stale + warn-logged

**`bootQueueWorker` wiring** in `factory-dashboard/server/telemetry.mjs`:
- Reaper runs ONCE on every telemetry boot, before the worker pool starts polling
- Logs `🩹 Orphan reaper: scanned=N reaped=M ...` summary (only when something was reaped, to avoid log noise on healthy boots)
- Reaped count goes into Live Trace so the founder sees re-leased jobs during restart recovery
- Fail-open: reaper exception logged + worker boot continues (NEVER blocks pipeline handlers)

**Why one-shot on boot (not periodic)** — D223:
- Real LLM cycles take 5-15 min; a periodic reaper would interrupt healthy long-running jobs
- Telemetry crash is a one-time event per restart; once we reap on boot, the live worker loop manages everything else
- "Periodic during long uptime" can wrap `reapOrphans` in `setInterval` later if a use case emerges (e.g. worker dies without telemetry dying)

**Smoke test** — `cognitive-engine/concurrency/orphan-reaper.smoke.js`:
- **30 assertions** across 8 scenarios using a real tmp queue (not stubs) — exercises actual filesystem rename + fail() interaction
- Empty queue → no-op
- 3 in-flight (2 stale, 1 fresh) → 2 reaped to queue/, 1 kept in in-flight/
- Stale job at max_attempts → moved to failed/ (not requeued)
- Idempotent: second reap after first finds nothing stale
- Invalid `leased_at` → treated as stale
- Custom `timeoutMs` honored (5-min-old job: kept under default 30-min; reaped under 1-min)
- `LEASE_TIMEOUT_MS` env override works
- Arg validation: 3 missing-dep variants throw
- All pass

## What stays for 14-B remainder

- **Real handler registration** for `project_intake` (19-B) — same registry pattern, lands when 19-B ships
- **Migrate legacy paths** — `/api/factory/{pre-dev,dev,post-dev}` in telemetry.mjs still inline-spawn; today both paths exist (legacy + queue-based), but legacy can retire when 19-B makes queue-based the only path for customer-submitted work
- **Warn-tier notifications** — quota gate honors `hard_cap_usd` (refuse). `warn_usd` (alert via Courier without refusing) is a Phase 10-B follow-on once Courier backends are live.
- **Periodic reaper** (optional) — current reaper is one-shot on boot. Periodic mode (`setInterval` wrapping `reapOrphans`) lands if a worker-died-without-telemetry-dying case ever surfaces.

---

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
