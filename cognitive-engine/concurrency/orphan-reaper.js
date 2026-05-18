/**
 * Phase 14-B remainder — orphan-reaper for the filesystem queue.
 *
 * Problem: when telemetry crashes mid-job, the job sits in `in-flight/`
 * with `leased_at` stamped but never transitions to `done/` or `failed/`.
 * Without intervention it stays leased forever — no worker will re-lease
 * a file already in in-flight/ (that's the whole point of the atomic
 * rename semantics in D135/D136).
 *
 * Solution: on every telemetry boot, scan `in-flight/` for jobs whose
 * `leased_at` is older than the lease timeout (default 30 min). For
 * each stale job, call `queue.fail(jobId, "lease expired")`. The
 * existing fail() machinery handles the requeue-or-fail decision based
 * on `max_attempts`:
 *   - attempt < max_attempts → requeue (job goes back to queue/, picks
 *     a fresh worker on next lease cycle)
 *   - attempt ≥ max_attempts → move to failed/ (no more retries)
 *
 * This is the bounded-recovery path Phase 14-A's D136 named explicitly:
 * "Crash recovery — re-leasing orphan in-flight — is a 14-B concern."
 *
 * Why one-shot on boot (not periodic):
 *   - Real LLM cycles can take 5-15 minutes; we don't want a periodic
 *     reaper interrupting a healthy long-running job.
 *   - A telemetry crash is a one-time event; once we restart and reap,
 *     subsequent jobs are managed by the live worker loop.
 *   - If "periodic during long uptime" becomes desirable later (e.g.
 *     for jobs whose worker dies without the whole telemetry process
 *     dying), wrap reapOrphans in a setInterval. Today's reality
 *     doesn't demand it.
 *
 * Why default timeout is 30 minutes:
 *   - Longest legitimate LLM cycle in the factory today: an Opus-tier
 *     architect pass with depth=deep can take 5-10 min. 30 min gives
 *     3x safety margin.
 *   - Configurable via env LEASE_TIMEOUT_MS for environments where
 *     architect cycles go deeper or LLM latency is higher.
 *   - Adjustable via the `timeoutMs` arg to reapOrphans.
 *
 * Failure isolation: the reaper does NOT throw on per-job failures.
 * A stale job that can't be re-failed (e.g. the in-flight/ file is
 * corrupt or already gone) gets logged into `errors[]` and the reaper
 * continues with the next job. Reaper boot-failure must not block
 * worker boot.
 */

const DEFAULT_LEASE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Scan the queue's in-flight directory for stale leases and re-fail them.
 *
 * @param {object} args
 * @param {object} args.queue                            createQueue() result
 * @param {number} [args.timeoutMs]                      lease timeout; defaults to
 *   process.env.LEASE_TIMEOUT_MS (parsed as integer) → DEFAULT_LEASE_TIMEOUT_MS
 * @param {Date|number} [args.now]                       reference clock (for tests)
 * @param {{ info: Function, warn: Function }} [args.logger]
 * @returns {Promise<{ scanned: number, reaped: number, kept: number, errors: Array<{ id, error }>, requeued_ids: string[], failed_ids: string[] }>}
 */
export async function reapOrphans({ queue, timeoutMs, now, logger } = {}) {
  if (!queue?.listInFlight || !queue?.fail) {
    throw new Error("reapOrphans: queue with listInFlight + fail required");
  }

  const effectiveTimeoutMs = timeoutMs ?? parseEnvTimeout() ?? DEFAULT_LEASE_TIMEOUT_MS;
  const nowMs = (now instanceof Date) ? now.getTime() : (typeof now === "number" ? now : Date.now());

  const log = logger || { info: () => {}, warn: () => {} };

  const inFlight = await queue.listInFlight();
  const errors = [];
  const requeued_ids = [];
  const failed_ids = [];
  let reaped = 0;
  let kept = 0;

  for (const job of inFlight) {
    let leasedAtMs;
    try { leasedAtMs = new Date(job.leased_at).getTime(); } catch { leasedAtMs = NaN; }
    if (!Number.isFinite(leasedAtMs)) {
      // Pathological: in-flight job with no parseable leased_at. Treat as
      // immediately stale — we can't tell when it was leased.
      log.warn(`[reaper] ${job.id} has invalid leased_at='${job.leased_at}' — treating as stale`);
    } else if (nowMs - leasedAtMs < effectiveTimeoutMs) {
      kept += 1;
      continue;
    }

    try {
      const result = await queue.fail(job.id, new Error(`lease expired (reaped at ${new Date(nowMs).toISOString()}; leased_at=${job.leased_at})`));
      if (result.requeued) {
        requeued_ids.push(job.id);
        log.info(`[reaper] ${job.id} requeued (attempt ${result.attempt}/${job.max_attempts})`);
      } else {
        failed_ids.push(job.id);
        log.info(`[reaper] ${job.id} → failed/ (exhausted ${result.attempts} attempts)`);
      }
      reaped += 1;
    } catch (err) {
      errors.push({ id: job.id, error: err?.message || String(err) });
      log.warn(`[reaper] ${job.id} failed to reap: ${err?.message || err}`);
    }
  }

  return {
    scanned: inFlight.length,
    reaped,
    kept,
    errors,
    requeued_ids,
    failed_ids,
  };
}

function parseEnvTimeout() {
  const raw = process.env.LEASE_TIMEOUT_MS;
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export { DEFAULT_LEASE_TIMEOUT_MS };
