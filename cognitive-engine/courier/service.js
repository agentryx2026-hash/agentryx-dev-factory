import { validateEvent } from "./types.js";
import { loadRoutingConfig, resolveRoute } from "./router.js";
import { createFakeBackend } from "./backends/fake.js";
import { createHttpBackend } from "./backends/http.js";
import { createNullBackend } from "./backends/null.js";

/**
 * Build a Courier instance. Reads COURIER_BACKEND env (default "fake").
 * Each instance owns a routing config + a backend + an event history.
 */
export async function getCourier(opts = {}) {
  const backendKind = opts.backend || process.env.COURIER_BACKEND || "fake";
  let backend;
  if (backendKind === "fake") backend = createFakeBackend();
  else if (backendKind === "null") backend = createNullBackend();
  else if (backendKind === "http") backend = createHttpBackend(opts);
  else throw new Error(`unknown COURIER_BACKEND: ${backendKind}`);

  const config = opts.routingConfig || await loadRoutingConfig(opts.configPath);
  const history = [];
  let seq = 0;

  return {
    backend,
    config,
    async dispatch(event) {
      const validationError = validateEvent(event);
      if (validationError) {
        return { ok: false, event_id: null, channels_used: [], deliveries: [], error: validationError };
      }
      seq += 1;
      const event_id = `EVT-${String(seq).padStart(4, "0")}`;
      const finalEvent = {
        ...event,
        id: event.id || event_id,
        emitted_at: event.emitted_at || new Date().toISOString(),
        severity: event.severity || "info",
      };

      const { channels, dropped, reason } = resolveRoute(finalEvent, config);
      if (dropped) {
        const entry = { ok: true, event_id: finalEvent.id, channels_used: [], deliveries: [], dropped: true, reason };
        history.push({ event: finalEvent, result: entry });
        return entry;
      }

      const deliveries = [];
      for (const { channel, target } of channels) {
        const res = await backend.send(channel, finalEvent, target);
        deliveries.push({ channel, target, ok: res.ok, error: res.error });
      }
      const entry = {
        ok: deliveries.every(d => d.ok),
        event_id: finalEvent.id,
        channels_used: channels.map(c => c.channel),
        deliveries,
      };
      history.push({ event: finalEvent, result: entry });
      return entry;
    },
    getHistory() { return history.slice(); },
    clearHistory() { history.length = 0; },
  };
}

export function isEnabled() {
  return process.env.USE_COURIER === "true";
}
