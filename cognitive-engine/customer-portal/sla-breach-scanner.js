/**
 * Phase 19-B — SLA breach scanner (D228).
 *
 * Periodically scans every customer's active (non-terminal) submissions
 * and emits an `sla_breached` timeline event when the submission has
 * passed its `target_delivery_at` without reaching a terminal state.
 *
 * Why a background daemon (and not an on-demand HTTP call):
 *   - SLA breaches are time-driven, not event-driven. Nothing in the
 *     pipeline naturally fires when a submission "ages past target" —
 *     the only signal is wall-clock time advancing past a precomputed
 *     ISO timestamp.
 *   - The customer-facing GET /submissions/:id route already returns
 *     a fresh sla_status, so on-demand breach detection works for
 *     reads — but Courier notifications (10-B follow-on) need a *push*
 *     trigger to fire only once per actual breach event. That's the
 *     scanner's job.
 *
 * Why per-tick, not per-submission:
 *   - O(N customers + M submissions) per tick. Fine for v0.0.1 (single
 *     founder, < 100 submissions). When that breaks, swap for a
 *     per-submission setTimeout indexed by `target_delivery_at`.
 *   - Idempotency keeps us safe at any cadence: dedup happens via
 *     timeline scan, not via in-memory state, so the scanner can
 *     restart freely without re-firing breaches.
 *
 * Idempotency (D226 lesson applied):
 *   - Before emitting `sla_breached`, scan the submission's timeline
 *     for any existing `sla_breached` event. If one exists, skip — the
 *     breach has already been notified.
 *   - This is filesystem-durable: a telemetry restart between scans
 *     does NOT re-fire breach events.
 *   - Trade-off: one timeline read per breached submission per tick.
 *     For v0.0.1 scale (< 10 active breached submissions at any time)
 *     this is negligible. At scale we'd cache a "already-notified" set
 *     keyed by submission_id, persisted to disk.
 *
 * Fail-isolation:
 *   - A failure scanning one customer (e.g. corrupted submission file)
 *     does NOT halt the scan. Each customer is wrapped in try/catch;
 *     errors are logged + counted and the scan continues.
 *   - A failure emitting one breach event does NOT halt other breach
 *     emits in the same tick. Same per-emit try/catch.
 *
 * @typedef ScanResult
 * @property {number} scanned          customers iterated
 * @property {number} submissions_checked  active non-terminal submissions evaluated
 * @property {number} breaches_found   submissions sla.findBreaches returned
 * @property {number} raised           new sla_breached events emitted this tick
 * @property {number} deduped          breaches skipped because prior event exists
 * @property {string[]} raised_ids     SUB-IDs that received a fresh breach event
 * @property {{ scope: string, error: string }[]} errors
 * @property {string} computed_at      ISO timestamp scan finished
 */

/**
 * Build a scanner. Returns `{ runOnce, start, stop }`. `runOnce` is
 * exposed so callers (tests, admin debug endpoint) can trigger a
 * single scan synchronously.
 *
 * @param {Object} init
 * @param {Object} init.portal               Phase 19-A createCustomerPortal(...) instance
 * @param {number} [init.intervalMs]         tick period (default 5 minutes)
 * @param {(line: string) => void} [init.onLog]
 * @param {() => number} [init.now]          ms-since-epoch source (test injection); defaults to Date.now
 */
export function createSlaBreachScanner(init = {}) {
  if (!init?.portal?.accounts?.list ||
      !init?.portal?.submissions?.list ||
      !init?.portal?.timeline?.read ||
      !init?.portal?.sla?.findBreaches ||
      typeof init?.portal?.raiseSLABreach !== "function") {
    throw new Error("createSlaBreachScanner: deps.portal (customer-portal instance with accounts/submissions/timeline/sla/raiseSLABreach) required");
  }
  const portal = init.portal;
  const intervalMs = Number.isFinite(init.intervalMs) && init.intervalMs > 0 ? init.intervalMs : 5 * 60 * 1000;
  const log = (line) => { if (init.onLog) { try { init.onLog(line); } catch {} } };
  // The scanner does not consult `now` itself — the SLA engine does
  // (via its own injected `now`). We just pass it through for tests
  // that want a clean log timestamp.
  const nowMs = init.now || Date.now;

  let timer = null;
  let running = false;

  /**
   * One scan pass. Returns ScanResult. Safe to invoke from any context;
   * never throws (all errors captured into the result).
   */
  async function runOnce() {
    const startedMs = nowMs();
    const result = {
      scanned: 0,
      submissions_checked: 0,
      breaches_found: 0,
      raised: 0,
      deduped: 0,
      raised_ids: [],
      errors: [],
      computed_at: null,
    };

    let customers = [];
    try {
      customers = await portal.accounts.list();
    } catch (err) {
      result.errors.push({ scope: "accounts.list", error: err?.message || String(err) });
      result.computed_at = new Date(nowMs()).toISOString();
      return result;
    }

    // Build {customer_id → tier} map up front so findBreaches can be
    // called per-customer (keeps the data-set per call bounded).
    const tiersByCustomer = {};
    for (const c of customers) tiersByCustomer[c.id] = c.tier;

    for (const customer of customers) {
      result.scanned += 1;
      let activeSubs = [];
      try {
        // Only non-terminal submissions are breach-eligible; the store's
        // filter on `status` would require knowing all 3 non-terminal
        // states explicitly. Cheaper: list all + filter inline (findBreaches
        // does the same filter again, but cost is trivial for v0.0.1 scale).
        const all = await portal.submissions.list(customer.id);
        activeSubs = all.filter(s => s.status !== "delivered" && s.status !== "rejected" && s.status !== "cancelled");
        result.submissions_checked += activeSubs.length;
      } catch (err) {
        result.errors.push({ scope: `submissions.list(${customer.id})`, error: err?.message || String(err) });
        continue;
      }

      if (activeSubs.length === 0) continue;

      // findBreaches expects a map covering every submission's customer_id.
      // We seed with just this one customer to keep the scope tight.
      const breaches = portal.sla.findBreaches(activeSubs, { [customer.id]: customer.tier });
      result.breaches_found += breaches.length;

      for (const { submission } of breaches) {
        // Dedup: scan timeline for an existing sla_breached event.
        let alreadyRaised = false;
        try {
          const events = await portal.timeline.read(customer.id, submission.id);
          alreadyRaised = events.some(e => e.kind === "sla_breached");
        } catch (err) {
          result.errors.push({ scope: `timeline.read(${customer.id}/${submission.id})`, error: err?.message || String(err) });
          // Skip the emit on read failure — better to miss a notification
          // than risk a duplicate; the next tick retries cleanly.
          continue;
        }
        if (alreadyRaised) {
          result.deduped += 1;
          continue;
        }
        try {
          await portal.raiseSLABreach(customer.id, submission.id, {
            note: `elapsed past target_delivery_at (${submission.target_delivery_at})`,
          });
          result.raised += 1;
          result.raised_ids.push(submission.id);
          log(`sla_breached raised: ${customer.id}/${submission.id} (target was ${submission.target_delivery_at})`);
        } catch (err) {
          result.errors.push({ scope: `raiseSLABreach(${customer.id}/${submission.id})`, error: err?.message || String(err) });
        }
      }
    }

    result.computed_at = new Date(nowMs()).toISOString();
    return result;
  }

  /**
   * Start the recurring scan. The first tick fires after `intervalMs`,
   * not immediately — matches the architect cadence daemon's behaviour
   * (avoid scanning at the same instant as boot when state is still
   * settling). Callers wanting an immediate scan should call `runOnce()`.
   *
   * Safe to call multiple times — second call is a no-op while running.
   */
  function start() {
    if (running) return { running: true, intervalMs };
    running = true;
    timer = setInterval(async () => {
      try {
        const res = await runOnce();
        if (res.raised > 0 || res.errors.length > 0) {
          log(`scan: scanned=${res.scanned} subs=${res.submissions_checked} breaches=${res.breaches_found} raised=${res.raised} deduped=${res.deduped} errors=${res.errors.length}`);
        }
      } catch (err) {
        // runOnce never throws by contract, but defend anyway.
        log(`scan FAILED (uncaught): ${err?.message || err}`);
      }
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return { running: true, intervalMs };
  }

  /** Stop the recurring scan. Safe to call when not running. */
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    running = false;
    return { running: false };
  }

  return {
    runOnce,
    start,
    stop,
    get _running() { return running; },
  };
}
