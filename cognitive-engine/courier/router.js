import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { severityMeetsThreshold } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "..", "..", "configs", "courier-routing.json");

let _cachedConfig = null;
let _cachedPath = null;

export async function loadRoutingConfig(configPath) {
  const p = configPath || process.env.COURIER_ROUTING_CONFIG || DEFAULT_CONFIG_PATH;
  if (_cachedConfig && _cachedPath === p) return _cachedConfig;
  const raw = await fs.readFile(p, "utf-8");
  _cachedConfig = JSON.parse(raw);
  _cachedPath = p;
  return _cachedConfig;
}

export function clearRoutingCache() { _cachedConfig = null; _cachedPath = null; }

/**
 * Resolve channels + targets for an event.
 *
 * @param {import("./types.js").CourierEvent} event
 * @param {import("./types.js").RoutingConfig} config
 * @returns {{channels: Array<{channel: string, target: string|null}>, dropped: boolean, reason?: string}}
 */
export function resolveRoute(event, config) {
  const rule = config.rules.find(r => r.event_type === event.type);
  if (!rule) {
    return { channels: [], dropped: true, reason: `no routing rule for event type '${event.type}'` };
  }
  const sev = event.severity || "info";
  if (rule.min_severity && !severityMeetsThreshold(sev, rule.min_severity)) {
    return { channels: [], dropped: true, reason: `severity ${sev} below rule min ${rule.min_severity}` };
  }

  const defaults = config.default_targets || {};
  const channels = rule.channels.map(ch => {
    let target = rule.targets?.[ch] ?? defaults[ch] ?? null;
    if (typeof target === "string" && target.includes("$project_id")) {
      target = target.replace("$project_id", event.project_id || "");
    }
    return { channel: ch, target };
  });
  return { channels, dropped: false };
}
