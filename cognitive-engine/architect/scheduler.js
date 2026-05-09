/**
 * Architect scheduler — boot pass + daily cron.
 *
 * D193: lightweight scheduler. On boot, enqueue a `boot` pass immediately.
 * On a recurring timer, enqueue a `daily` pass at the next configured wall
 * time (default midnight UTC). When the founder bumps the Standing Orders
 * version, enqueue a `founder_priority_update` pass right away.
 *
 * Phase 21-A ships the scheduler logic and the `enqueue` contract
 * (dependency-injected); Phase 21-B wires the actual queue (Phase 14-A) +
 * runs the cron in production.
 *
 * Reads baseline.cron_schedule from the Standing Orders KB if available;
 * falls back to constructor config for fully-decoupled tests.
 */

import { isValidPassKind, CADENCE_KINDS, shouldFireCadence } from "./types.js";

function dailyTriggerMs(now, hourUtc, minuteUtc) {
  const target = new Date(now);
  target.setUTCHours(hourUtc, minuteUtc, 0, 0);
  if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - now.getTime();
}

/**
 * @param {Object} init
 * @param {(passKind: string, payload: object) => Promise<any>} init.enqueue
 *   Function that puts a research-pass job onto the queue (Phase 14-A).
 * @param {() => Promise<{ version: number, hour_utc?: number, minute_utc?: number }>} [init.readBaselineAndVersion]
 *   Returns current Standing Orders version + baseline cron schedule. The
 *   scheduler compares version against watermark (last seen) to detect
 *   founder updates, and refreshes the cron schedule on each fire.
 * @param {Object} [init.config]
 * @param {number} [init.config.daily_hour_utc=0]                 fallback if readBaselineAndVersion not provided
 * @param {number} [init.config.daily_minute_utc=0]               fallback
 * @param {boolean} [init.config.run_on_boot=true]
 * @param {() => number} [init.now]                                test-clock
 */
export function createScheduler(init) {
  if (!init?.enqueue) throw new Error("scheduler: init.enqueue required");
  const config = {
    daily_hour_utc: 0,
    daily_minute_utc: 0,
    run_on_boot: true,
    ...(init.config || {}),
  };
  const now = init.now || (() => Date.now());
  let _timer = null;
  let _watermark = 0;
  let _watermarkInterval = null;

  async function getCronSlot() {
    if (init.readBaselineAndVersion) {
      try {
        const v = await init.readBaselineAndVersion();
        return {
          hour: typeof v?.hour_utc === "number" ? v.hour_utc : config.daily_hour_utc,
          minute: typeof v?.minute_utc === "number" ? v.minute_utc : config.daily_minute_utc,
          version: v?.version || 0,
        };
      } catch {
        return { hour: config.daily_hour_utc, minute: config.daily_minute_utc, version: 0 };
      }
    }
    return { hour: config.daily_hour_utc, minute: config.daily_minute_utc, version: 0 };
  }

  async function enqueuePass(passKind, payload = {}) {
    if (!isValidPassKind(passKind)) throw new Error(`scheduler: invalid passKind ${passKind}`);
    return init.enqueue(passKind, { ...payload, scheduled_at: new Date(now()).toISOString() });
  }

  async function scheduleNextDaily() {
    const slot = await getCronSlot();
    const ms = dailyTriggerMs(new Date(now()), slot.hour, slot.minute);
    _timer = setTimeout(async () => {
      try { await enqueuePass("daily"); } catch {}
      scheduleNextDaily();
    }, ms);
    if (typeof _timer?.unref === "function") _timer.unref();
    return ms;
  }

  return {
    config,

    /**
     * Start the scheduler. Returns immediately after enqueuing the boot pass
     * (if configured) and arming the daily timer.
     */
    async start() {
      if (config.run_on_boot) {
        await enqueuePass("boot", { reason: "factory startup" });
      }
      const msUntilNext = await scheduleNextDaily();

      if (init.readBaselineAndVersion) {
        try {
          const initial = await init.readBaselineAndVersion();
          _watermark = initial?.version || 0;
        } catch { _watermark = 0; }
        _watermarkInterval = setInterval(async () => {
          try {
            const v = await init.readBaselineAndVersion();
            if (v?.version && v.version > _watermark) {
              _watermark = v.version;
              await enqueuePass("founder_priority_update", { new_version: v.version });
            }
          } catch {}
        }, 60_000);
        if (typeof _watermarkInterval?.unref === "function") _watermarkInterval.unref();
      }

      return {
        boot_enqueued: config.run_on_boot,
        ms_until_next_daily: msUntilNext,
        watermark: _watermark,
      };
    },

    stop() {
      if (_timer) clearTimeout(_timer);
      if (_watermarkInterval) clearInterval(_watermarkInterval);
      _timer = null;
      _watermarkInterval = null;
    },

    /**
     * Manually trigger a pass (test + admin tooling).
     */
    async triggerManual(payload = {}) {
      return enqueuePass("manual", payload);
    },

    /**
     * Compute when the next daily pass would fire (for status APIs).
     */
    async msUntilNextDaily() {
      const slot = await getCronSlot();
      return dailyTriggerMs(new Date(now()), slot.hour, slot.minute);
    },

    get _now() { return now(); },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 21-A.1 — Cadence Daemon (Platform Evolution Roadmap)
// ─────────────────────────────────────────────────────────────────────────
//
// A long-lived loop that ticks every 60 seconds, reads Standing Orders,
// and for each enabled cadence checks whether the configured local
// time + day rule matches the current minute. If yes, fires a pass via
// the injected runPass (architect.runPass) and records the fire so
// shouldFireCadence can dedupe within the cadence period.
//
// Lives inside the telemetry server process — no separate systemd unit.
// Survives `paused: true` by sleeping and re-checking on the next tick.
//
// Dependency-injected for testability:
//   readStandingOrders : async () => StandingOrders | null
//   recordCadenceFire  : async (cadenceKind, passId) => void
//   lastCadenceFire    : async (cadenceKind) => { at } | null
//   runCadencePass     : async (cadenceKind, cadenceConfig) => result
//   onReportProduced   : optional, (report) => void  (for live notification hooks)
//   tickMs             : default 60_000
//   now                : default Date.now (test clock)
//   logger             : optional, { info, warn } — defaults to console

/**
 * @param {Object} init
 * @param {() => Promise<any>} init.readStandingOrders
 * @param {(cadenceKind: string, passId: string) => Promise<void>} init.recordCadenceFire
 * @param {(cadenceKind: string) => Promise<{ at: string } | null>} init.lastCadenceFire
 * @param {(cadenceKind: string, cadenceConfig: object) => Promise<{ pass: any, report?: any }>} init.runCadencePass
 * @param {Object} [init.logger]
 * @param {number} [init.tickMs=60000]
 * @param {() => number} [init.now]
 */
export function createCadenceDaemon(init) {
  if (!init?.readStandingOrders) throw new Error("daemon: readStandingOrders required");
  if (!init?.runCadencePass) throw new Error("daemon: runCadencePass required");
  if (!init?.recordCadenceFire) throw new Error("daemon: recordCadenceFire required");
  if (!init?.lastCadenceFire) throw new Error("daemon: lastCadenceFire required");

  const tickMs = init.tickMs ?? 60_000;
  const now = init.now || (() => Date.now());
  const logger = init.logger || console;
  let _timer = null;
  let _running = false;
  let _ticks = 0;
  let _fired = 0;

  async function tickOnce() {
    if (_running) return; // never overlap a long-running pass with the next tick
    _running = true;
    try {
      _ticks += 1;
      const so = await init.readStandingOrders();
      if (!so) return;
      const baseline = so.baseline || {};
      if (baseline.paused === true) return;
      const tz = baseline.timezone || "Asia/Kolkata";
      const cadences = baseline.cadences || {};

      for (const kind of CADENCE_KINDS) {
        const cfg = cadences[kind];
        if (!cfg) continue;
        const lastFire = await init.lastCadenceFire(kind);
        const decision = shouldFireCadence(kind, cfg, tz, new Date(now()), lastFire?.at);
        if (!decision.fire) continue;
        try {
          logger.info?.(`[architect.daemon] firing ${kind} cadence (tz=${tz}, time=${cfg.time_local})`);
          const result = await init.runCadencePass(kind, cfg);
          const passId = result?.pass?.id || `unknown-${kind}-${Date.now()}`;
          await init.recordCadenceFire(kind, passId);
          if (init.onReportProduced && result?.report) {
            try { init.onReportProduced(result.report); } catch {}
          }
          _fired += 1;
        } catch (err) {
          logger.warn?.(`[architect.daemon] ${kind} pass failed: ${err?.message || err}`);
        }
      }
    } finally {
      _running = false;
    }
  }

  return {
    /**
     * Start the daemon — schedules the first tick on the next minute boundary,
     * then every tickMs. Returns immediately.
     */
    async start() {
      if (_timer) return; // already started
      const loop = async () => {
        try { await tickOnce(); } catch (err) {
          logger.warn?.(`[architect.daemon] tick error: ${err?.message || err}`);
        }
        _timer = setTimeout(loop, tickMs);
        if (typeof _timer?.unref === "function") _timer.unref();
      };
      // First tick aligned to next minute boundary for predictable cron-style
      // firing (otherwise a startup at 22:00:30 would never fire 22:00 cadences).
      const ms = 60_000 - (now() % 60_000) + 100;
      _timer = setTimeout(loop, ms);
      if (typeof _timer?.unref === "function") _timer.unref();
      return { tickMs, alignedFirstTickInMs: ms };
    },

    stop() {
      if (_timer) clearTimeout(_timer);
      _timer = null;
    },

    // Test/debug accessors
    get stats() { return { ticks: _ticks, fired: _fired, running: _running }; },
    /** Tick once manually (for tests). */
    async _tick() { return tickOnce(); },
  };
}
