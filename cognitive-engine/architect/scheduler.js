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

import { isValidPassKind } from "./types.js";

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
