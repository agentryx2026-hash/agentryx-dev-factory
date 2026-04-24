/**
 * Public Release types — substrate for v1.0 go-public operations.
 *
 * Five capabilities: metering, retention, compliance, readiness, backup.
 * Each capability is a thin aggregator over stores built by prior phases;
 * no new storage primitive is invented (D173). All keyed by Phase 19-A
 * customer_id for multi-tenant operations (D174).
 */

/**
 * @typedef {"artifacts"|"memory"|"timelines"|"jobs"|"videos"|"proposals"|"training"|"verify"} DataClass
 * Per-class retention + compliance categories.
 */

/**
 * @typedef {Object} UsageRecord
 * @property {string} tenant_id                    customer_id from Phase 19-A (or "system" for non-tenant use)
 * @property {string} period_start                 ISO 8601 UTC, start of period
 * @property {"day"|"week"|"month"} period_kind
 * @property {number} request_count
 * @property {number} cost_usd
 * @property {number} duration_ms
 * @property {number} tokens                       sum of tokens_in + tokens_out if known; else 0
 * @property {Record<string, any>} [meta]
 */

/**
 * @typedef {Object} UsageRollup
 * @property {string} tenant_id
 * @property {"day"|"week"|"month"} period_kind
 * @property {string} period_start
 * @property {string} period_end
 * @property {number} request_count
 * @property {number} cost_usd
 * @property {number} duration_ms
 * @property {number} tokens
 * @property {number} underlying_records            how many UsageRecord rows rolled up
 */

/**
 * @typedef {Object} RetentionPolicy
 * @property {DataClass} data_class
 * @property {number} max_age_days
 * @property {string[]} storage_dirs                relative paths under workspace root
 * @property {boolean} [dry_run_only]               when true, apply() refuses — still useful for reporting
 * @property {string} [note]
 */

/**
 * @typedef {Object} RetentionCandidate
 * @property {DataClass} data_class
 * @property {string} rel_path                      relative to workspace root
 * @property {number} age_days
 * @property {number} size_bytes
 * @property {string} [tenant_id]                   if path includes a customer_id segment
 */

/**
 * @typedef {Object} RetentionResult
 * @property {boolean} dry_run
 * @property {number} candidate_count
 * @property {number} purged_count                  0 if dry_run
 * @property {number} total_bytes_freed             0 if dry_run
 * @property {RetentionCandidate[]} candidates
 * @property {string[]} [errors]                    per-path error messages (apply only)
 * @property {string} computed_at
 */

/**
 * @typedef {"export"|"delete"|"audit"} ComplianceRequestKind
 */

/**
 * @typedef {Object} ComplianceRequest
 * @property {string} id                            e.g. "CREQ-0042"
 * @property {ComplianceRequestKind} kind
 * @property {string} tenant_id
 * @property {string} requested_by
 * @property {string} requested_at                  ISO 8601 UTC
 * @property {boolean} [confirmed]                  required for "delete"
 * @property {string} [reason]
 * @property {Record<string,any>} [meta]
 */

/**
 * @typedef {"received"|"succeeded"|"failed"|"refused"} ComplianceOutcome
 */

/**
 * @typedef {Object} ComplianceReport
 * @property {string} request_id
 * @property {ComplianceRequestKind} kind
 * @property {string} tenant_id
 * @property {ComplianceOutcome} outcome
 * @property {string} produced_at
 * @property {Record<string, any>} summary          kind-specific details (files exported, bytes deleted, audit period)
 * @property {string} [manifest_ref]                relative path to output manifest file (for export)
 * @property {string} [error]
 */

/**
 * @typedef {"healthy"|"degraded"|"unhealthy"} HealthStatus
 */

/**
 * @typedef {Object} ProbeResult
 * @property {string} name
 * @property {HealthStatus} status
 * @property {number} [duration_ms]
 * @property {string} [detail]
 * @property {string} [error]
 */

/**
 * @typedef {Object} HealthReport
 * @property {HealthStatus} overall
 * @property {string} computed_at
 * @property {number} duration_ms
 * @property {ProbeResult[]} probes
 * @property {Record<string, number>} counts        count of probes by status
 */

/**
 * @typedef {Object} BackupEntry
 * @property {string} rel_path                      relative to workspace root (e.g. "_customer-portal/index.jsonl")
 * @property {number} size_bytes
 * @property {string} sha256
 * @property {string} mtime                         ISO 8601 UTC
 */

/**
 * @typedef {Object} BackupManifest
 * @property {string} id                            e.g. "BKP-0042"
 * @property {string} created_at                    ISO 8601 UTC
 * @property {string} workspace_root
 * @property {string[]} included_dirs               list of `_*` dirs walked
 * @property {number} entry_count
 * @property {number} total_bytes
 * @property {BackupEntry[]} entries                newest-first
 * @property {string} manifest_sha256               hash of the manifest body (for verify-against-disk)
 */

export const SCHEMA_VERSION = 1;

export const DATA_CLASSES = Object.freeze([
  "artifacts", "memory", "timelines", "jobs", "videos", "proposals", "training", "verify",
]);

export const PERIOD_KINDS = Object.freeze(["day", "week", "month"]);

export const COMPLIANCE_KINDS = Object.freeze(["export", "delete", "audit"]);

export const COMPLIANCE_OUTCOMES = Object.freeze(["received", "succeeded", "failed", "refused"]);

export const HEALTH_STATUSES = Object.freeze(["healthy", "degraded", "unhealthy"]);

export const DEFAULT_RETENTION_POLICIES = Object.freeze([
  { data_class: "jobs",       max_age_days: 30,  storage_dirs: ["_jobs"] },
  { data_class: "videos",     max_age_days: 90,  storage_dirs: ["_videos"] },
  { data_class: "training",   max_age_days: 90,  storage_dirs: ["_training"] },
  { data_class: "artifacts",  max_age_days: 365, storage_dirs: ["_artifacts"] },
  { data_class: "memory",     max_age_days: 730, storage_dirs: ["_factory-memory"] },
  { data_class: "timelines",  max_age_days: 365, storage_dirs: ["_customer-portal/customers"] },
  { data_class: "proposals",  max_age_days: 180, storage_dirs: ["_proposals"] },
]);

export function isValidDataClass(c) { return DATA_CLASSES.includes(c); }
export function isValidPeriodKind(p) { return PERIOD_KINDS.includes(p); }
export function isValidComplianceKind(k) { return COMPLIANCE_KINDS.includes(k); }
export function isValidHealthStatus(s) { return HEALTH_STATUSES.includes(s); }

/**
 * Worst-case fold across probe results.
 * unhealthy > degraded > healthy.
 */
export function aggregateHealthStatus(statuses) {
  if (statuses.some(s => s === "unhealthy")) return "unhealthy";
  if (statuses.some(s => s === "degraded")) return "degraded";
  return "healthy";
}

export function nowIso() { return new Date().toISOString(); }

export function startOfUtcDay(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new Error(`invalid ISO: ${iso}`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

export function startOfUtcWeek(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new Error(`invalid ISO: ${iso}`);
  // Week starts Monday (ISO 8601)
  const day = d.getUTCDay() || 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)));
  return monday.toISOString();
}

export function startOfUtcMonth(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new Error(`invalid ISO: ${iso}`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
