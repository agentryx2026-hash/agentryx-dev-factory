import { aggregateHealthStatus, isValidHealthStatus, nowIso } from "./types.js";

/**
 * Readiness aggregator — collects health probes from installed modules and
 * produces a unified HealthReport.
 *
 * D177: uses the DI registry pattern. Each module contributes a named probe
 * function; `assemble()` runs them all in parallel, times each one, and
 * returns a report with overall status (worst-case fold).
 *
 * A probe should return quickly (< 500ms nominal). If a probe throws or
 * times out (20-B adds timeout wrapping), it's recorded as `unhealthy`
 * with the error message.
 *
 * Typical callers: 20-B's HTTP `/healthz` + `/readyz` endpoints; admin UI;
 * systemd health probes.
 */

/**
 * Probe signature: `async () => { status: HealthStatus, detail?: string }`
 */

export function createReadinessAggregator() {
  const probes = new Map();

  return {
    /**
     * Register a named probe. Re-registering the same name replaces the
     * prior probe (allows dynamic reconfig without restart).
     *
     * @param {string} name
     * @param {() => Promise<{status: string, detail?: string}>} probe
     */
    register(name, probe) {
      if (!name || typeof name !== "string") throw new Error("readiness.register: name required");
      if (typeof probe !== "function") throw new Error("readiness.register: probe must be a function");
      probes.set(name, probe);
    },

    unregister(name) { return probes.delete(name); },

    list() { return [...probes.keys()].sort(); },

    has(name) { return probes.has(name); },

    /**
     * Run all registered probes in parallel; aggregate into a HealthReport.
     *
     * @returns {Promise<import("./types.js").HealthReport>}
     */
    async assemble() {
      const start = Date.now();
      const entries = [...probes.entries()];

      const results = await Promise.all(entries.map(async ([name, fn]) => {
        const t0 = Date.now();
        try {
          const r = await fn();
          if (!r || typeof r !== "object") {
            return { name, status: "unhealthy", error: `probe returned ${typeof r}`, duration_ms: Date.now() - t0 };
          }
          if (!isValidHealthStatus(r.status)) {
            return { name, status: "unhealthy", error: `invalid status: ${r.status}`, duration_ms: Date.now() - t0 };
          }
          return {
            name,
            status: r.status,
            detail: r.detail,
            duration_ms: Date.now() - t0,
          };
        } catch (err) {
          return {
            name,
            status: "unhealthy",
            error: err?.message || String(err),
            duration_ms: Date.now() - t0,
          };
        }
      }));

      const statuses = results.map(r => r.status);
      const overall = results.length === 0 ? "healthy" : aggregateHealthStatus(statuses);
      const counts = {
        healthy: results.filter(r => r.status === "healthy").length,
        degraded: results.filter(r => r.status === "degraded").length,
        unhealthy: results.filter(r => r.status === "unhealthy").length,
      };

      return {
        overall,
        computed_at: nowIso(),
        duration_ms: Date.now() - start,
        probes: results,
        counts,
      };
    },

    /**
     * Run a single probe by name (useful for focused debugging).
     */
    async probe(name) {
      const fn = probes.get(name);
      if (!fn) return null;
      const t0 = Date.now();
      try {
        const r = await fn();
        return {
          name,
          status: isValidHealthStatus(r?.status) ? r.status : "unhealthy",
          detail: r?.detail,
          duration_ms: Date.now() - t0,
        };
      } catch (err) {
        return {
          name,
          status: "unhealthy",
          error: err?.message || String(err),
          duration_ms: Date.now() - t0,
        };
      }
    },
  };
}

/**
 * Convenience: a probe that always returns the given status. Useful for
 * tests and as a temporary placeholder before a real probe is wired.
 */
export function staticProbe(status, detail) {
  return async () => ({ status, detail });
}
