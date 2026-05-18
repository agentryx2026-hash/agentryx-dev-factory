# Phase 14 — Decisions Log

## D136 — Filesystem-backed JSONL queue, not Redis/SQLite

**What**: Jobs stored as one JSON file per state directory under `<workspace_root>/_jobs/`. State transitions are atomic file writes + unlinks.

**Why**:
- **Zero dependencies**: works on every factory VM with no extra services to deploy.
- **Debuggable via `ls`**: ops can inspect queue state without admin tools. `ls _jobs/queue/` shows pending, `_jobs/in-flight/` shows what workers are doing.
- **POSIX rename atomicity**: same-filesystem rename is atomic, so two workers racing to lease the same job → exactly one succeeds. Other gets ENOENT/EEXIST and tries the next.
- **Persistent across restarts**: queue survives process crashes. (Crash recovery — re-leasing orphan in-flight — is a 14-B concern.)
- **Phase 11-A pattern alignment**: same one-file-per-record approach as artifact store and memory layer. Consistent mental model.

**Tradeoff**: not horizontally scalable across hosts. Acceptable for v0.0.1 single-VM factory; Phase 20 (Public Release) would migrate to Redis or a real queue service if needed.

## D137 — In-process async workers, not OS processes

**What**: `runSchedulerOnce` spawns N async functions ("workers") in the same Node process. They share memory, share modules, share the event loop.

**Why**:
- **Sufficient isolation for the substrate**: each job gets its own working directory and project_id stamp; conflicts are at the data layer, not memory.
- **Simpler to test**: no subprocess teardown, no IPC, no signal handling.
- **Existing graph code is heavy on CPU-bound work in subprocesses already**: when 14-B registers real handlers, the handler will spawn `pre_dev_graph.js` as a child process anyway. The in-process worker just orchestrates.
- **OS-process worker pool deferred to 14-B (or later)**: easy upgrade — wrap each `workerLoop` in a worker_threads or child_process boundary. Engine API stays the same.

**Tradeoff**: a runaway handler can OOM the whole pool. 14-B can mitigate via subprocess wrapping or memory limits.

## D138 — Round-robin per-project as default scheduling policy

**What**: Default policy is `round_robin`. Tracked via `servedCounts: Map<project_id, number>` updated at lease time.

**Why**:
- **Fairness against starvation**: one project enqueueing 100 jobs shouldn't block others. Round-robin guarantees every project with queued work gets attention before any project gets a second turn.
- **Simple to reason about**: pick project with smallest `servedCounts` value, ties broken by oldest queued job. Two-line ordering.
- **Switchable to fifo or priority via config**: P1 (configurability) — operators with different needs can change without code edit.
- **Bug discovery payoff**: initial implementation used "oldest-bucket-first" which silently degraded to fifo. Adding `servedCounts` made the round-robin behavior real and testable.

**Tradeoff**: doesn't account for job size or cost. A project with 100 cheap jobs gets the same share as a project with 100 expensive jobs. Phase 14-B can add weighted round-robin if cost-aware fairness becomes important.

## D139 — Handler registry as dependency injection

**What**: Handlers registered via `registry.register(kind, handlerFn)`. Scheduler invokes `registry.get(kind)` per job. No global registration, no module-level side effects.

**Why**:
- **Same pattern as Phase 9-A `fixRouter` and Phase 13-A `nodeStubs`**: established convention across phases. Tests register stubs; production registers real handlers.
- **Explicit dependencies**: looking at a `runSchedulerOnce` call, you see exactly which handlers it has access to. No hidden registration order surprises.
- **Easy to test in isolation**: smoke test creates a fresh registry, registers exactly one stub, and verifies behavior. No teardown needed.
- **Multi-tenant or per-environment registries possible**: 14-B may want separate registries per tenant (different job kinds available per customer). Constructor pattern supports this trivially.

## D140 — Per-job working directory under `<workspace>/_jobs/work/<JOB-id>/`

**What**: Before invoking a handler, scheduler creates `<workspace>/_jobs/work/<JOB-id>/` and passes its path as `ctx.workingDir`.

**Why**:
- **Isolation**: handler can `cd` into this directory and dump intermediate files without colliding with other concurrent jobs.
- **Inspectable**: ops can `ls _jobs/work/JOB-0042/` to see what a job produced. After cleanup (14-B policy), older work dirs can be archived or deleted.
- **Contract for 14-B handlers**: real `pre_dev`/`dev`/`post_dev` handlers will set this as the project dir or as a scratch space. Either way, the path is given, not invented.
- **Decouples job identity from project identity**: a project may have many jobs; each gets its own working dir. Cleanup can be per-job rather than per-project.

**Tradeoff**: `_jobs/work/` grows unbounded without cleanup. 14-B should add a "delete work dir on done" or "archive after N days" policy. Today (14-A), nothing cleans up — acceptable for tests since smoke test rms its tmp dir afterwards.

## D211 — 14-B Tier B: handlers as a separate module + worker boot inside telemetry process (added 2026-05-10)

**What**: Phase 14-B Tier B registers `pre_dev` / `dev` / `post_dev` handlers via a dedicated module (`cognitive-engine/concurrency/handlers/factory-handlers.js`) rather than inline in the queue substrate or in telemetry. The long-lived worker daemon (`runSchedulerOnce({ drainOnly: false })`) boots inside the existing `factory-telemetry.service` process alongside the Phase 21-A.1 architect cadence daemon — no new systemd unit.

**Why a separate handlers module**:
- Handler implementations are *content* (what each kind does); the queue substrate is *machinery* (how kinds get scheduled). Mixing them violates Phase 14-A's D138 separation.
- Phase 16-B (training_gen) and Phase 17-B (training_video_render) and Phase 19-B (project_intake) each add their own handler kind. Each can land in its own file under `concurrency/handlers/` without touching `concurrency/queue.js` or `concurrency/scheduler.js`.
- Test ergonomics: handler registry is test-injectable. Smoke tests can stub all three handlers without spawning real graphs.
- The `onLog` hook on `registerFactoryHandlers(registry, { onLog })` decouples the handler from telemetry's SSE stream — handlers don't import from `factory-dashboard/server/telemetry.mjs`. Telemetry passes the hook in at boot time. Same dependency-injection pattern as Phase 9-A `fixRouter`, Phase 13-A `nodeStubs`, Phase 14-A `handlerRegistry`, Phase 15-A `proposer`.

**Why worker daemon inside telemetry process**:
- Same reasoning as Phase 21-A.1's cadence daemon (D202): zero-dep, no new systemd unit, no new supervision setup, no new restart story.
- The `factory-telemetry.service` is already managed by systemd with `Restart=on-failure`; the worker inherits that resilience.
- For v0.0.1 single-VM single-founder, in-process is the right scale. Multi-host worker pool waits for v3 multi-tenant pressure.
- Fail-open: `runSchedulerOnce(...).catch(...)` so a worker crash doesn't take telemetry down; `queueWorkerStarted` resets to allow re-boot.

**Tradeoff**: telemetry process gets two long-lived loops (cadence daemon + queue worker). If either holds the event loop synchronously, both stall. Mitigation: both await all I/O; both rely on per-call timeouts. If a worker call hangs (e.g. a `spawn()` that never exits), it blocks one of two parallelism slots; the other slot keeps processing. At parallelism=2, full deadlock is unlikely.

## D212 — Per-project quota gate at the HTTP boundary, not inside queue.enqueue (added 2026-05-10)

**What**: Phase 14-B per-project quotas live in `cost-tracker/project-quota.js` and are invoked from `/api/factory-admin/queue/submit` *before* `queue.enqueue(...)`. The `concurrency/queue.js` module is unchanged — it has no knowledge of cost tracking, thresholds, or budgets.

**Why HTTP boundary, not inside the queue**:
- **Module-level separation**: `concurrency/` is machinery (how jobs flow). `cost-tracker/` is policy (how much they can cost). Mixing them inside `queue.enqueue` would make the concurrency module impossible to test or reuse without a cost-tracker.
- **Mirrors D139's DI pattern**: handlers are injected, not imported globally; quotas follow the same posture — the gate is a *caller's* responsibility, not the queue's.
- **Internal callers don't need the gate**: scheduler.lease() operates on jobs that have already passed the gate (or were enqueued by trusted internal code). Putting the gate in enqueue would force every internal caller to either disable it or worry about quotas they don't conceptually own.
- **Future endpoints get the gate by composition**: when Phase 19-B's customer portal adds its own submission path, it imports `checkProjectQuota` directly — no queue-coupling required.

**Why fail-open**:
- A broken `cost-thresholds.json` (typo, missing file, parser error) currently throws inside the gate. Fail-closed would make a single config mistake take down all job submission across the factory.
- Cost overruns are recoverable (we can refund, alert, reroute). Queue downtime during a customer demo isn't.
- The breach (if there's a real one) resurfaces on the next submission once thresholds.json is fixed — short window of over-spend, but no lockout.

**Why `global` + `project:*` only (not `agent:*` / `model:*`)**:
- At enqueue time we don't yet know which agent or which model the job will eventually invoke (handler chooses at runtime via `pickDispatcher`).
- `agent:*` and `model:*` are post-call alerts already wired through `cost-tracker/service.js` rollups + Phase 11-B Courier (when 11-B ships).
- Conflating pre-flight gates with post-call alerts in the same keying scheme would be confusing; the scope rule keeps each layer's intent obvious.

**Tradeoff**: a project that's projected to over-spend on its *next* call still gets that call accepted (gate looks at *current* spend, not predicted spend). Acceptable for v0.0.1 — predictive caps would need per-handler cost-model annotations that aren't built yet.

## Decision counter (Phase 14)

- D135–D139 — Phase 14-A (queue substrate, scheduler, handler-registry pattern, scheduling policies, per-job working dir)
- D211 — Phase 14-B Tier B (handlers module + worker-in-telemetry boot)
- D212 — Phase 14-B per-project quotas (HTTP-boundary gate + fail-open + global/project-only scope)
- Future Phase 14 work continues from D213.

## D223 — 14-B orphan reaper: one-shot on boot, fail-open, uses queue.fail() (added 2026-05-11)

**What**: Phase 14-B orphan reaper (`cognitive-engine/concurrency/orphan-reaper.js`) runs on every telemetry boot. It scans `_jobs/in-flight/` once for jobs whose `leased_at` is older than `LEASE_TIMEOUT_MS` (default 30 min) and calls `queue.fail(jobId, "lease expired")` on each. The existing `fail()` machinery decides requeue-or-fail based on `max_attempts` — no new state-transition code, just composition.

**Why one-shot on boot (not periodic)**:
- Real LLM cycles take 5-15 minutes (Sonnet) or longer (Opus deep). A periodic reaper would risk interrupting healthy long-running jobs that legitimately hold a lease.
- Telemetry crash is a one-time event per restart. Once we reap on boot, the live worker loop manages everything subsequently.
- Periodic mode (wrapping `reapOrphans` in `setInterval`) is a trivial future extension if a "worker dies without telemetry dying" case ever surfaces. Today's reality doesn't demand it.

**Why 30-minute default timeout**:
- Longest legitimate LLM cycle in the factory today: Opus-tier architect pass at depth=deep, ~5-10 min.
- 30 min gives ~3x safety margin against worst-case observed latency.
- Configurable via `LEASE_TIMEOUT_MS` env for environments where cycles go deeper or LLM latency is higher.
- Per-call override via `timeoutMs` arg for tests + ad-hoc tooling.

**Why fail-open (reaper exception never blocks worker boot)**:
- A broken reaper must not take down pipeline handlers. A factory that won't start because the reaper choked is worse than a factory that occasionally leaves an orphan in-flight.
- Reaper exception logs a warning + worker boot continues; orphans accumulate until next reap (next boot) — acceptable degradation.

**Why compose on queue.fail() instead of a new state-transition method**:
- `fail()` already encodes the requeue-or-failed decision based on `max_attempts`. Re-implementing it in the reaper would duplicate logic + risk divergence.
- The fail() error message ("lease expired (reaped at ...; leased_at=...)") becomes the job's `error` field — recoverable from the failed/ JSON for post-mortem.
- Reaper stays a "policy applier," not a state machine.

**Why per-job error isolation (errors[] continues)**:
- A single corrupt in-flight file (unparseable JSON, missing on disk between listInFlight and fail) must not abort the entire reaper run.
- Each per-job error lands in `errors[]` of the result; reaper continues to the next job.
- Logged via `logger.warn` so ops sees the corruption without alarm.

**Tradeoff acknowledged**: a stale job whose `leased_at` is *exactly* at the timeout boundary may flap between reaped (this run) and not-reaped (next run, after requeue) on quick restarts. Acceptable: the requeue path puts the job back in `queue/` immediately, so the next worker picks it up regardless — no work is lost.
