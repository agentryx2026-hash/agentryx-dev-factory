/**
 * Customer portal types — non-admin-facing factory access substrate.
 *
 * A CustomerAccount owns ProjectSubmissions. Each submission has a Timeline
 * (append-only events). SLA policies are per-tier; they drive ETA calculation
 * and breach detection. 19-A ships the substrate; 19-B adds HTTP + UI +
 * Phase 14 queue handler + Phase 10 Courier notifications.
 */

/**
 * @typedef {"free"|"starter"|"pro"} CustomerTier (D170)
 */

/**
 * @typedef {Object} CustomerAccount
 * @property {string} id                           e.g. "CUST-0042"
 * @property {string} email
 * @property {string} display_name
 * @property {CustomerTier} tier
 * @property {string} created_at                   ISO 8601 UTC
 * @property {string[]} [token_hashes]             SHA-256 hex of bearer tokens (plaintext never stored; D168)
 * @property {Record<string, any>} [meta]
 */

/**
 * @typedef {"submitted"|"accepted"|"in_progress"|"delivered"|"rejected"|"cancelled"} SubmissionStatus
 *
 * - submitted:    received, not yet queued (19-B enqueues to Phase 14 queue)
 * - accepted:     queued and waiting for a worker
 * - in_progress:  at least one phase has started
 * - delivered:    all phases complete; bundle ready
 * - rejected:     auto-rejected (quota/budget/validation) or admin-rejected
 * - cancelled:    customer cancelled (only legal from submitted/accepted)
 */

/**
 * @typedef {Object} ProjectSubmission
 * @property {string} id                           e.g. "SUB-0042"
 * @property {string} customer_id                  CUST-NNNN
 * @property {string} project_title
 * @property {string} intake_payload               raw customer description (SRS/FRS/PRD prose or short brief)
 * @property {SubmissionStatus} status
 * @property {string} submitted_at                 ISO 8601 UTC
 * @property {string} [accepted_at]
 * @property {string} [completed_at]               delivered/rejected/cancelled timestamp
 * @property {number} budget_cap_usd               tier.budget_cap_usd snapshot at submission time
 * @property {string} target_delivery_at           ISO 8601 UTC — submission_at + tier.sla_hours
 * @property {number} [consumed_cost_usd]          accumulated as phases run
 * @property {string[]} [tags]
 * @property {Record<string, any>} [meta]          arbitrary customer-provided hints (stack preferences, etc.)
 */

/**
 * @typedef {"submitted"|"accepted"|"phase_started"|"phase_completed"|"sla_breached"|"delivered"|"cancelled"|"rejected"|"note"} TimelineEventKind (D171; 9 kinds — "note" is the free-form escape hatch)
 */

/**
 * @typedef {Object} TimelineEvent
 * @property {string} submission_id
 * @property {TimelineEventKind} kind
 * @property {string} at                           ISO 8601 UTC
 * @property {string} [phase]                      for phase_started / phase_completed (e.g. "pre_dev", "dev", "post_dev")
 * @property {string} [note]                       free-form human-readable detail
 * @property {number} [cost_delta_usd]             for phase_completed events
 * @property {string} [computed_eta_at]            running ETA at the time this event fired
 * @property {Record<string, any>} [meta]
 */

/**
 * @typedef {Object} SLAPolicy
 * @property {CustomerTier} tier
 * @property {number} max_active_submissions       quota
 * @property {number} sla_hours                    submission → delivery soft deadline
 * @property {number} budget_cap_usd               per-submission budget
 * @property {number} priority                     lower = higher priority (matches Phase 14 queue semantics)
 * @property {string[]} [allowed_categories]       optional allow-list of project types
 */

/**
 * @typedef {"on_track"|"at_risk"|"breached"|"completed"} SLAStatusKind
 *
 * - on_track:    plenty of time remaining (> 20% buffer)
 * - at_risk:     ≤ 20% buffer OR elapsed past 80% of SLA window
 * - breached:    elapsed past target_delivery_at, still in_progress
 * - completed:   delivered before or after target (distinguish via missed_sla flag)
 */

/**
 * @typedef {Object} SLAStatus
 * @property {SLAStatusKind} status
 * @property {number} elapsed_hours
 * @property {number} remaining_hours              can be negative if breached
 * @property {number} percent_elapsed              0 → 1+; >1 means breached
 * @property {string} target_delivery_at
 * @property {boolean} missed_sla                  true if status=completed but finished after target
 * @property {string} [computed_at]
 */

/**
 * @typedef {Object} SubmissionReceipt
 * @property {string} submission_id
 * @property {SubmissionStatus} status
 * @property {string} target_delivery_at
 * @property {number} budget_cap_usd
 * @property {CustomerTier} tier
 * @property {number} priority
 * @property {string} submitted_at
 */

export const SCHEMA_VERSION = 1;

export const CUSTOMER_TIERS = Object.freeze(["free", "starter", "pro"]);

export const SUBMISSION_STATUSES = Object.freeze([
  "submitted", "accepted", "in_progress", "delivered", "rejected", "cancelled",
]);

export const TIMELINE_EVENT_KINDS = Object.freeze([
  "submitted", "accepted", "phase_started", "phase_completed",
  "sla_breached", "delivered", "cancelled", "rejected", "note",
]);

export const SLA_STATUSES = Object.freeze(["on_track", "at_risk", "breached", "completed"]);

export const TERMINAL_STATUSES = Object.freeze(["delivered", "rejected", "cancelled"]);

const VALID_TRANSITIONS = Object.freeze({
  submitted:   ["accepted", "rejected", "cancelled"],
  accepted:    ["in_progress", "rejected", "cancelled"],
  in_progress: ["delivered", "rejected"],
  delivered:   [],
  rejected:    [],
  cancelled:   [],
});

export function isValidTier(t) { return CUSTOMER_TIERS.includes(t); }
export function isValidStatus(s) { return SUBMISSION_STATUSES.includes(s); }
export function isValidEventKind(k) { return TIMELINE_EVENT_KINDS.includes(k); }
export function isValidSLAStatus(s) { return SLA_STATUSES.includes(s); }
export function isTerminal(s) { return TERMINAL_STATUSES.includes(s); }
export function canTransition(from, to) {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

/**
 * Default SLA policies per tier (D170). Values live in a registered config
 * `customer_tiers` (D169) so 12-B admin UI can tune them without redeploy.
 * 19-A ships these defaults; loader reads them from config if present.
 *
 * @type {Record<CustomerTier, SLAPolicy>}
 */
export const DEFAULT_TIER_POLICIES = Object.freeze({
  free: Object.freeze({
    tier: "free",
    max_active_submissions: 1,
    sla_hours: 72,
    budget_cap_usd: 10,
    priority: 100,
  }),
  starter: Object.freeze({
    tier: "starter",
    max_active_submissions: 5,
    sla_hours: 48,
    budget_cap_usd: 100,
    priority: 50,
  }),
  pro: Object.freeze({
    tier: "pro",
    max_active_submissions: 50,
    sla_hours: 24,
    budget_cap_usd: 1000,
    priority: 10,
  }),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CUSTOMER_ID_RE = /^CUST-\d{4,}$/;
const SUBMISSION_ID_RE = /^SUB-\d{4,}$/;

export function isValidEmail(e) { return typeof e === "string" && EMAIL_RE.test(e); }
export function isValidCustomerId(id) { return typeof id === "string" && CUSTOMER_ID_RE.test(id); }
export function isValidSubmissionId(id) { return typeof id === "string" && SUBMISSION_ID_RE.test(id); }

export function nowIso() { return new Date().toISOString(); }
