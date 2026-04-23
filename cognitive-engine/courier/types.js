/**
 * Courier — external communications types.
 *
 * Events flow factory → Courier → channels (slack / github / email / discord).
 * Phase 10-A ships the contract + fake backend; Phase 10-B wires HTTP backend
 * against Hermes gateway for real delivery.
 */

/**
 * Known event types. Adding a new type without a matching routing rule in
 * `configs/courier-routing.json` will fail at dispatch time (loud).
 *
 * @typedef {
 *   "project.pr_opened" |
 *   "project.deployment_ready" |
 *   "project.delivery_ready" |
 *   "verify.feedback_received" |
 *   "cost.budget_exceeded" |
 *   "cost.threshold_warn" |
 *   "agent.error_rate_spike" |
 *   "factory.smoke_test"
 * } CourierEventType
 */

/**
 * Channels understood by Hermes gateway. Courier doesn't talk to Slack/GitHub
 * directly — it hands the message to Hermes which has the integrations.
 *
 * @typedef {"slack"|"github"|"email"|"discord"|"telegram"|"stdout"} CourierChannel
 */

/**
 * @typedef {Object} CourierRecipient
 * @property {CourierChannel} channel
 * @property {string} [target]       channel-specific: slack channel name, email, GitHub repo/issue ref
 */

/**
 * @typedef {Object} CourierEvent
 * @property {CourierEventType} type
 * @property {string} id                      e.g. "EVT-0001" (assigned on dispatch)
 * @property {string} emitted_at              ISO 8601 UTC
 * @property {string} [project_id]
 * @property {string} [run_id]
 * @property {string} title                   short human-readable summary
 * @property {string} [body]                  markdown allowed
 * @property {Record<string,any>} [meta]      structured payload (cost amounts, URLs, etc.)
 * @property {string[]} [refs_artifact_ids]
 * @property {string} [severity]              "info" | "warn" | "error"
 */

/**
 * @typedef {Object} RoutingRule
 * @property {CourierEventType} event_type
 * @property {CourierChannel[]} channels      one event can fan out to multiple channels
 * @property {string} [default_target]        optional per-channel default (e.g. "#factory-ops" for slack)
 * @property {Record<CourierChannel,string>} [targets]   override default_target per-channel
 * @property {"info"|"warn"|"error"} [min_severity]      drop events below this level
 */

/**
 * @typedef {Object} RoutingConfig
 * @property {number} schema_version
 * @property {Record<CourierChannel,string>} [default_targets]
 * @property {RoutingRule[]} rules
 */

/**
 * @typedef {Object} DispatchResult
 * @property {boolean} ok
 * @property {string} event_id
 * @property {CourierChannel[]} channels_used
 * @property {Array<{channel: CourierChannel, ok: boolean, error?: string}>} deliveries
 * @property {string} [error]
 */

export const SCHEMA_VERSION = 1;

export const EVENT_TYPES = Object.freeze([
  "project.pr_opened",
  "project.deployment_ready",
  "project.delivery_ready",
  "verify.feedback_received",
  "cost.budget_exceeded",
  "cost.threshold_warn",
  "agent.error_rate_spike",
  "factory.smoke_test",
]);

export const CHANNELS = Object.freeze([
  "slack", "github", "email", "discord", "telegram", "stdout",
]);

export const SEVERITIES = Object.freeze(["info", "warn", "error"]);
const SEVERITY_RANK = { info: 0, warn: 1, error: 2 };

export function isValidEventType(t) { return EVENT_TYPES.includes(t); }
export function isValidChannel(c) { return CHANNELS.includes(c); }
export function isValidSeverity(s) { return SEVERITIES.includes(s); }

export function severityMeetsThreshold(actual, minimum) {
  if (!minimum) return true;
  return (SEVERITY_RANK[actual] ?? 0) >= (SEVERITY_RANK[minimum] ?? 0);
}

export function validateEvent(e) {
  if (!e || typeof e !== "object") return "event must be an object";
  if (!isValidEventType(e.type)) return `invalid event type: ${e.type} (expected one of ${EVENT_TYPES.join(",")})`;
  if (!e.title || typeof e.title !== "string") return "title required";
  if (e.severity && !isValidSeverity(e.severity)) return `invalid severity: ${e.severity}`;
  return null;
}
