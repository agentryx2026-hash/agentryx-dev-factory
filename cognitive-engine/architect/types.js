/**
 * Master Architect — types for the autonomous research + KB substrate.
 *
 * Phase 21-A: the architect is a long-lived orchestrator that runs a
 * weighted research pass at factory boot and on a daily cron, reads the
 * Standing Orders to bias attention, dispatches research subagents,
 * ingests findings into a Knowledge Base, and emits Proposals via Phase
 * 15-A's lifecycle (with 3 new architect-owned kinds).
 *
 * Standing Orders has two sections (D194; founder confirmation 2026-05-09):
 *   1. baseline           — what the architect does autonomously (Tab 1 in UI)
 *                           cron schedule, budget cap, dispatcher choice,
 *                           auto-watch toggle, auto-derived inventory
 *   2. custom_direction   — founder's structured directive (Tab 2 in UI)
 *                           6 priority areas + overall stance + custom watch
 *
 * The validator is deliberately loose during 21-A — only `version` and
 * `priority_areas` shape are strictly enforced. Everything else has
 * sensible defaults so partial / evolving Standing Orders still work.
 */

/**
 * @typedef {"models"|"agents"|"languages"|"tools"|"output_quality"|"operations"} PriorityArea
 *
 * The 6 founder-steerable content areas (D194):
 *   models         — LLM tier strategy, cost/quality posture, fine-tuning ambitions
 *   agents         — named pipeline agent roster (Picard, Sisko, Troi, …) + new candidates
 *   languages      — code/output stacks the factory produces (TS/Python/Go/etc.)
 *   tools          — MCP plane, external integrations, IDE tooling
 *   output_quality — Tuvok test rigor, Data review depth, Verify cycle latency
 *   operations     — cost / speed / throughput / deployment surface
 */

/**
 * @typedef {"risk-averse"|"balanced"|"experimental"} RiskAppetite
 * @typedef {"quality-first"|"balanced"|"speed-first"} QualityVsSpeed
 * @typedef {"high"|"medium"|"low"} CostSensitivity
 * @typedef {"stable-lock"|"gradual"|"aggressive"} ChangeTolerance
 */

/**
 * @typedef {"light"|"standard"|"deep"} ResearchDepth
 */

/**
 * @typedef {Object} BaselineConfig
 * Tab 1 / Section 1: what the architect does autonomously. Mostly
 * deployment-ops knobs. Founder edits rarely (quarterly).
 *
 * @property {{ hour_utc?: number, minute_utc?: number }} [cron_schedule]   default 00:00 UTC
 * @property {number} [daily_budget_usd]                                    default 1.5
 * @property {ResearchDepth} [research_depth]                               default "standard"
 * @property {string} [research_dispatcher]                                 default "stub"; 21-B adds "sonnet" / "opus"
 * @property {boolean} [auto_watch_enabled]                                 default true
 * @property {string[]} [auto_watch_disabled_ids]                          founder-explicit toggle-offs
 * @property {Record<string, any>} [meta]                                  free-form extension
 */

/**
 * @typedef {Object} OverallStance
 * @property {RiskAppetite} [risk_appetite]
 * @property {QualityVsSpeed} [quality_vs_speed]
 * @property {CostSensitivity} [cost_sensitivity]
 * @property {ChangeTolerance} [change_tolerance]
 */

/**
 * @typedef {Object} PriorityAreaEntry
 * @property {PriorityArea} id
 * @property {number} weight                       1-5; how much architect attention
 * @property {string} [current_state]              1-line where-we-are
 * @property {string} [target_3mo]                 1-3 sentences
 * @property {string} [target_6mo]                 1-3 sentences
 * @property {string[]} [hard_constraints]
 * @property {string[]} [anti_goals]
 * @property {string[]} [research_directions]
 * @property {string} [notes]
 * @property {Record<string, any>} [meta]          free-form extension
 */

/**
 * @typedef {Object} StrategicWatchEntry
 * @property {string} id                           e.g. "thinking-machines-lab"
 * @property {"org"|"product"} [kind]
 * @property {string} name
 * @property {"high"|"medium"|"low"} [importance]  default "medium"
 * @property {string} [url]
 * @property {string} [last_checked]               ISO 8601 — set by architect
 * @property {"daily"|"weekly"|"monthly"} [watch_frequency]   default "weekly"
 * @property {string} [notes]
 * @property {Record<string, any>} [meta]
 */

/**
 * @typedef {Object} EffectivePeriod
 * @property {string} [start_date]                 ISO 8601
 * @property {string} [end_date]                   ISO 8601
 * @property {string} [horizon_label]              e.g. "Q3 2026"
 */

/**
 * @typedef {Object} CustomDirection
 * Tab 2 / Section 2: founder's structured directive. Founder edits monthly.
 *
 * @property {EffectivePeriod} [effective_period]
 * @property {OverallStance} [overall_stance]
 * @property {PriorityAreaEntry[]} priority_areas      exactly 6 entries (one per PriorityArea); REQUIRED
 * @property {StrategicWatchEntry[]} [strategic_watch]
 * @property {string} [notes]
 * @property {Record<string, any>} [meta]
 */

/**
 * @typedef {Object} StandingOrders
 *  The factory's permanent directive (D194). Two sections: `baseline`
 *  (autonomous behavior — Tab 1) and `custom_direction` (founder-edited
 *  steering — Tab 2). Validator is intentionally loose during 21-A.
 *
 * @property {number} version                       bump on each meaningful update; REQUIRED
 * @property {number} [schema_version]              defaults to SCHEMA_VERSION on write
 * @property {BaselineConfig} [baseline]
 * @property {CustomDirection} custom_direction     REQUIRED (priority_areas must be present)
 * @property {string} [recorded_at]                 ISO 8601 — set by KB on write
 * @property {string} [notes]                       top-level free-form
 */

/**
 * @typedef {"identified"|"watching"|"evaluating"|"resolved"|"dropped"} TargetStatus
 */

/**
 * @typedef {Object} Target
 * @property {string} id                           e.g. "T-0001"
 * @property {string} name                         e.g. "Hermes Agent v0.13"
 * @property {string} category                     e.g. "agent_runtime", "memory_backend"
 * @property {TargetStatus} status
 * @property {PriorityArea} [priority_area]
 * @property {string} [url]
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} [notes]
 */

/**
 * @typedef {Object} Gap
 * @property {string} id                           e.g. "G-0001"
 * @property {string} description
 * @property {PriorityArea} [priority_area]
 * @property {"open"|"resolved"|"dropped"} status
 * @property {string} created_at
 * @property {string} [resolved_at]
 * @property {string} [resolved_by]
 * @property {string} [notes]
 */

/**
 * @typedef {Object} Finding
 * @property {string} id                           e.g. "F-0001"
 * @property {string} pass_id
 * @property {string} [target_id]
 * @property {string} content
 * @property {string[]} [sources]
 * @property {PriorityArea} [priority_area]
 * @property {"info"|"upgrade-available"|"new-tool"|"deprecation"|"security"} kind
 * @property {string} produced_at
 * @property {string} produced_by
 */

/**
 * @typedef {"boot"|"daily"|"manual"|"founder_priority_update"} PassKind
 */

/**
 * @typedef {Object} ResearchPass
 * @property {string} id                           e.g. "RP-0001"
 * @property {PassKind} pass_kind
 * @property {string} started_at
 * @property {string} [completed_at]
 * @property {"running"|"succeeded"|"failed"|"partial"} status
 * @property {number} findings_count
 * @property {number} proposals_emitted
 * @property {number} cost_usd
 * @property {Record<PriorityArea, number>} [budget_by_area]
 * @property {string} [error]
 */

/**
 * @typedef {Object} KBState
 * @property {number} target_count
 * @property {number} gap_count
 * @property {number} finding_count
 * @property {number} pass_count
 * @property {string} [last_pass_at]
 * @property {number} [last_priority_version_seen]
 * @property {Record<PriorityArea, number>} findings_by_area
 */

export const SCHEMA_VERSION = 1;

export const PRIORITY_AREAS = Object.freeze([
  "models", "agents", "languages", "tools", "output_quality", "operations",
]);

export const PASS_KINDS = Object.freeze([
  "boot", "daily", "weekly", "monthly", "manual", "founder_priority_update", "founder_brief",
]);

// Cadence kinds (Platform Evolution Roadmap, founder confirmation 2026-05-09).
// Three tiers — each runs at a different depth and at a different cadence;
// the daily watcher accumulates raw findings, weekly synthesises them into a
// report, monthly reviews trends across weeks + tunes the criteria set.
export const CADENCE_KINDS = Object.freeze(["daily", "weekly", "monthly"]);

export const REPORT_KINDS = Object.freeze(["cycle", "brief"]);

export const BRIEF_STATUSES = Object.freeze([
  "queued", "running", "completed", "failed", "cancelled",
]);

export const TARGET_STATUSES = Object.freeze([
  "identified", "watching", "evaluating", "resolved", "dropped",
]);

export const GAP_STATUSES = Object.freeze(["open", "resolved", "dropped"]);

export const FINDING_KINDS = Object.freeze([
  "info", "upgrade-available", "new-tool", "deprecation", "security",
  // Phase 21-A.1 — produced by Seven (Tool Evaluator) when an evaluation
  // benchmark / probe completes. Distinct from "new-tool" (just observed
  // a tool exists) — tool_evaluation means "we measured it against our
  // baseline, here's the data." Required to roll up into Evaluation Reports.
  "tool_evaluation",
]);

export const RISK_APPETITES = Object.freeze(["risk-averse", "balanced", "experimental"]);
export const QUALITY_VS_SPEED_VALUES = Object.freeze(["quality-first", "balanced", "speed-first"]);
export const COST_SENSITIVITIES = Object.freeze(["high", "medium", "low"]);
export const CHANGE_TOLERANCES = Object.freeze(["stable-lock", "gradual", "aggressive"]);
export const RESEARCH_DEPTHS = Object.freeze(["light", "standard", "deep"]);

// Per-cadence default config. Defaults reflect the founder's stated preference
// (2026-05-09): monthly enabled, weekly + daily off; reports on for the two
// synthesis tiers; budget caps per cadence (cheaper for daily, more for monthly
// strategic). All times are in `baseline.timezone` (default Asia/Kolkata) so
// "Friday 22:00" means founder-local Friday, not UTC Friday.
export const DEFAULT_CADENCES = Object.freeze({
  daily: {
    enabled: false,
    time_local: "22:00",          // HH:MM in baseline.timezone
    report_enabled: false,
    budget_usd: 0.5,
    depth: "light",
    dispatcher: "stub",
  },
  weekly: {
    enabled: false,
    day_of_week: 4,               // 0=Sun ... 4=Thu (Thu night → Fri morning report ready)
    time_local: "22:00",
    report_enabled: true,
    budget_usd: 2.0,
    depth: "standard",
    dispatcher: "stub",
  },
  monthly: {
    enabled: true,
    day_rule: "last-thursday",    // last-thursday | last-day | first-day
    time_local: "22:00",
    report_enabled: true,
    budget_usd: 8.0,
    depth: "deep",
    dispatcher: "stub",
  },
});

export const DEFAULT_BASELINE = Object.freeze({
  cron_schedule: { hour_utc: 0, minute_utc: 0 },
  daily_budget_usd: 1.5,
  research_depth: "standard",
  research_dispatcher: "stub",
  auto_watch_enabled: true,
  auto_watch_disabled_ids: [],
  // Phase 21-A.1 — Platform Evolution Roadmap additions
  timezone: "Asia/Kolkata",
  paused: false,
  cadences: DEFAULT_CADENCES,
});

export function isValidPriorityArea(a) { return PRIORITY_AREAS.includes(a); }
export function isValidPassKind(k) { return PASS_KINDS.includes(k); }
export function isValidTargetStatus(s) { return TARGET_STATUSES.includes(s); }
export function isValidGapStatus(s) { return GAP_STATUSES.includes(s); }
export function isValidFindingKind(k) { return FINDING_KINDS.includes(k); }
export function isValidResearchDepth(d) { return RESEARCH_DEPTHS.includes(d); }
export function isValidCadenceKind(k) { return CADENCE_KINDS.includes(k); }
export function isValidBriefStatus(s) { return BRIEF_STATUSES.includes(s); }

export function nowIso() { return new Date().toISOString(); }

/**
 * Apply baseline defaults — every missing field gets its DEFAULT_BASELINE
 * value. Returns a new object; does not mutate input.
 */
export function applyBaselineDefaults(baseline = {}) {
  const incomingCadences = baseline.cadences || {};
  const cadences = {};
  for (const k of CADENCE_KINDS) {
    cadences[k] = { ...DEFAULT_CADENCES[k], ...(incomingCadences[k] || {}) };
  }
  return {
    cron_schedule: {
      hour_utc: baseline.cron_schedule?.hour_utc ?? DEFAULT_BASELINE.cron_schedule.hour_utc,
      minute_utc: baseline.cron_schedule?.minute_utc ?? DEFAULT_BASELINE.cron_schedule.minute_utc,
    },
    daily_budget_usd: baseline.daily_budget_usd ?? DEFAULT_BASELINE.daily_budget_usd,
    research_depth: baseline.research_depth ?? DEFAULT_BASELINE.research_depth,
    research_dispatcher: baseline.research_dispatcher ?? DEFAULT_BASELINE.research_dispatcher,
    auto_watch_enabled: baseline.auto_watch_enabled ?? DEFAULT_BASELINE.auto_watch_enabled,
    auto_watch_disabled_ids: Array.isArray(baseline.auto_watch_disabled_ids)
      ? baseline.auto_watch_disabled_ids.slice()
      : DEFAULT_BASELINE.auto_watch_disabled_ids.slice(),
    timezone: baseline.timezone || DEFAULT_BASELINE.timezone,
    paused: baseline.paused === true,
    cadences,
    ...(baseline.meta ? { meta: baseline.meta } : {}),
  };
}

/**
 * Loose validator. Strict requirements:
 *   - version (positive integer)
 *   - custom_direction.priority_areas (exactly 6, each with valid id and weight 1-5)
 *
 * Everything else: optional, with sensible defaults applied at read time.
 * Returns array of error strings (empty if valid). 21-A discipline:
 * accept partial input gracefully.
 */
export function validateStandingOrders(s) {
  const errors = [];
  if (!s || typeof s !== "object") return ["standing_orders must be an object"];

  if (typeof s.version !== "number" || s.version < 1) {
    errors.push("version must be a positive integer");
  }

  if (!s.custom_direction || typeof s.custom_direction !== "object") {
    errors.push("custom_direction is required");
    return errors;
  }

  const cd = s.custom_direction;
  if (!Array.isArray(cd.priority_areas)) {
    errors.push("custom_direction.priority_areas must be an array");
    return errors;
  }
  if (cd.priority_areas.length !== 6) {
    errors.push(`custom_direction.priority_areas must have exactly 6 entries (got ${cd.priority_areas.length})`);
  }

  const seenIds = new Set();
  for (const a of cd.priority_areas) {
    if (!isValidPriorityArea(a.id)) {
      errors.push(`priority_areas: invalid id "${a.id}"`);
      continue;
    }
    if (seenIds.has(a.id)) errors.push(`priority_areas: duplicate id "${a.id}"`);
    seenIds.add(a.id);
    if (typeof a.weight !== "number" || a.weight < 1 || a.weight > 5) {
      errors.push(`priority_areas[${a.id}].weight must be 1-5`);
    }
  }
  for (const required of PRIORITY_AREAS) {
    if (!seenIds.has(required)) errors.push(`priority_areas missing required id "${required}"`);
  }

  // Soft validation — log if present but invalid; don't fail
  if (cd.overall_stance) {
    const st = cd.overall_stance;
    if (st.risk_appetite && !RISK_APPETITES.includes(st.risk_appetite)) {
      errors.push(`overall_stance.risk_appetite invalid: ${st.risk_appetite}`);
    }
    if (st.quality_vs_speed && !QUALITY_VS_SPEED_VALUES.includes(st.quality_vs_speed)) {
      errors.push(`overall_stance.quality_vs_speed invalid: ${st.quality_vs_speed}`);
    }
    if (st.cost_sensitivity && !COST_SENSITIVITIES.includes(st.cost_sensitivity)) {
      errors.push(`overall_stance.cost_sensitivity invalid: ${st.cost_sensitivity}`);
    }
    if (st.change_tolerance && !CHANGE_TOLERANCES.includes(st.change_tolerance)) {
      errors.push(`overall_stance.change_tolerance invalid: ${st.change_tolerance}`);
    }
  }
  if (s.baseline?.research_depth && !isValidResearchDepth(s.baseline.research_depth)) {
    errors.push(`baseline.research_depth invalid: ${s.baseline.research_depth}`);
  }

  return errors;
}

/**
 * Compute attention budget allocation per priority area from the weights.
 * Reads `custom_direction.priority_areas`. Returns a map of area → fraction
 * (sums to 1.0). Returns null if priorities are absent or all weights zero.
 */
export function computeAttentionBudget(standingOrders) {
  const areas = standingOrders?.custom_direction?.priority_areas;
  if (!Array.isArray(areas) || !areas.length) return null;
  const totalWeight = areas.reduce((a, x) => a + (x.weight || 0), 0);
  if (totalWeight <= 0) return null;
  const out = {};
  for (const a of areas) {
    out[a.id] = Math.round((a.weight / totalWeight) * 1000) / 1000;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────
// Phase 21-A.1 — Platform Evolution Roadmap: Briefs, Reports, Cron math
// ───────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Brief
 * Founder-driven research brief — submitted via the R&D Brief tab. Each
 * brief composes into a prompt and spawns one founder_brief pass.
 *
 * @property {string} id                            e.g. "BRIEF-0001"
 * @property {string} title
 * @property {string} role                          resolved from preset or custom
 * @property {string} [background]
 * @property {string} research_question             REQUIRED
 * @property {string} [trigger]                     "why now"
 * @property {string} [constraints]
 * @property {string} output_format                 resolved from preset or custom
 * @property {string[]} [references]                URLs / repos
 * @property {number} [budget_usd]                  default 3
 * @property {string} [priority_area]               optional tag
 * @property {string} submitted_at                  ISO 8601
 * @property {string} submitted_by                  usually "founder"
 * @property {"queued"|"running"|"completed"|"failed"|"cancelled"} status
 * @property {string} [pass_id]                     linked pass once spawned
 * @property {string} [report_id]                   linked report once produced
 * @property {string} [error]
 */

/**
 * @typedef {Object} Report
 * Cycle or brief report. Each Pass with `report_enabled: true` produces
 * one Report. The cycle hierarchy means a weekly report rolls up the
 * preceding 7 days of findings; monthly rolls up the last 4 weeks.
 *
 * @property {string} id                            e.g. "REP-0001"
 * @property {"cycle"|"brief"} kind
 * @property {"daily"|"weekly"|"monthly"|null} cadence
 * @property {string} pass_id
 * @property {string} [brief_id]                    only for kind="brief"
 * @property {string} generated_at                  ISO 8601
 * @property {string} [cycle_start]                 ISO 8601 (cycle reports)
 * @property {string} [cycle_end]                   ISO 8601
 * @property {string} title
 * @property {string} summary                       headline narrative
 * @property {ReportSection[]} sections
 * @property {string[]} linked_findings             F-... ids
 * @property {string[]} linked_proposals            PROP-... ids
 * @property {boolean} read_by_founder
 * @property {string} [read_at]
 * @property {number} cost_usd
 */

/**
 * @typedef {Object} ReportSection
 * @property {string} heading
 * @property {string} body                          markdown
 * @property {"narrative"|"comparison"|"list"|"recommendation"|"criteria-health"} kind
 */

export function validateBrief(b) {
  const errors = [];
  if (!b || typeof b !== "object") return ["brief must be an object"];
  if (!b.title || typeof b.title !== "string") errors.push("title required");
  if (!b.research_question || typeof b.research_question !== "string") {
    errors.push("research_question required");
  }
  if (!b.role || typeof b.role !== "string") errors.push("role required");
  if (!b.output_format || typeof b.output_format !== "string") {
    errors.push("output_format required");
  }
  if (b.budget_usd != null && (typeof b.budget_usd !== "number" || b.budget_usd <= 0)) {
    errors.push("budget_usd must be a positive number");
  }
  if (b.priority_area && !isValidPriorityArea(b.priority_area)) {
    errors.push(`priority_area invalid: ${b.priority_area}`);
  }
  return errors;
}

export function validateCadence(kind, c) {
  const errors = [];
  if (!isValidCadenceKind(kind)) errors.push(`invalid cadence kind: ${kind}`);
  if (!c || typeof c !== "object") { errors.push(`${kind}: cadence config required`); return errors; }
  if (typeof c.enabled !== "boolean") errors.push(`${kind}.enabled must be boolean`);
  if (c.time_local && !/^\d{1,2}:\d{2}$/.test(c.time_local)) {
    errors.push(`${kind}.time_local must be HH:MM`);
  }
  if (c.budget_usd != null && (typeof c.budget_usd !== "number" || c.budget_usd < 0)) {
    errors.push(`${kind}.budget_usd must be non-negative`);
  }
  if (kind === "weekly" && c.day_of_week != null) {
    if (typeof c.day_of_week !== "number" || c.day_of_week < 0 || c.day_of_week > 6) {
      errors.push(`weekly.day_of_week must be 0-6`);
    }
  }
  if (kind === "monthly" && c.day_rule) {
    const valid = ["last-thursday", "last-day", "first-day"];
    if (!valid.includes(c.day_rule)) {
      errors.push(`monthly.day_rule must be one of ${valid.join(",")}`);
    }
  }
  return errors;
}

// ─── Cron math (timezone-aware) ─────────────────────────────────────────
// We implement this by hand instead of pulling node-cron because (a) the
// project's pattern is zero-dep where reasonable and (b) we only need
// three cadence shapes, well-bounded.

/**
 * Returns wall-clock parts of `instant` interpreted in `tz` (an IANA tz name).
 * Uses Intl.DateTimeFormat (built into Node 18+) — no external deps.
 */
export function partsInTz(instant, tz) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  // Intl returns "24" instead of "00" for midnight in some Node versions; normalise.
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const dayOfWeek = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.weekday);
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour, minute: Number(parts.minute), second: Number(parts.second),
    day_of_week: dayOfWeek,
  };
}

/**
 * For the monthly "last-thursday" rule: given a year + month (1-12) in `tz`,
 * return the day-of-month (1-31) that is the LAST Thursday. Other rules:
 *   - "last-day"   = the last calendar day of the month
 *   - "first-day"  = the 1st
 */
export function resolveMonthlyDay(year, month1to12, rule) {
  if (rule === "first-day") return 1;
  // Compute last day of month (in any tz — month boundaries are calendar-only)
  const lastDay = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  if (rule === "last-day") return lastDay;
  if (rule === "last-thursday") {
    // Walk backwards from the last day until we find a Thursday in any tz.
    // Month-boundaries are tz-stable; weekday of (y,m,d) is the same in every tz.
    for (let d = lastDay; d >= lastDay - 6; d--) {
      // Sun=0..Sat=6 — Thursday=4
      const dow = new Date(Date.UTC(year, month1to12 - 1, d)).getUTCDay();
      if (dow === 4) return d;
    }
  }
  return lastDay;
}

/**
 * Decide whether a cadence should fire RIGHT NOW given the current instant
 * and the most-recent prior fire. Uses the cadence's local time + tz.
 *
 * Logic: convert "now" to local parts, check the cadence's trigger condition
 * matches the current minute, AND the last fire was at least (cadence period
 * minus 5 minutes) ago — guards against double-fires from a 60s poll loop.
 *
 * Returns { fire: boolean, reason: string }.
 */
export function shouldFireCadence(kind, cadence, tz, now, lastFiredAt) {
  if (!cadence?.enabled) return { fire: false, reason: "disabled" };
  const [h, m] = String(cadence.time_local || "00:00").split(":").map(Number);
  const local = partsInTz(now, tz || "Asia/Kolkata");

  // Wall clock must match the configured hour:minute (ignore seconds — we tick once a minute)
  if (local.hour !== h || local.minute !== m) return { fire: false, reason: "off-clock" };

  // Day filter
  if (kind === "weekly") {
    const targetDow = typeof cadence.day_of_week === "number" ? cadence.day_of_week : 4;
    if (local.day_of_week !== targetDow) return { fire: false, reason: "wrong-weekday" };
  } else if (kind === "monthly") {
    const targetDay = resolveMonthlyDay(local.year, local.month, cadence.day_rule || "last-thursday");
    if (local.day !== targetDay) return { fire: false, reason: "wrong-monthday" };
  }
  // Daily: any day matches as long as the time-of-day matches.

  // Dedupe — never fire twice within (period - 5 min)
  if (lastFiredAt) {
    const sinceMs = (now instanceof Date ? now.getTime() : new Date(now).getTime()) - new Date(lastFiredAt).getTime();
    const minMs = kind === "daily" ? 23 * 3600_000 : kind === "weekly" ? 6 * 86400_000 + 23 * 3600_000 : 25 * 86400_000;
    if (sinceMs < minMs) return { fire: false, reason: "deduped" };
  }
  return { fire: true, reason: "ok" };
}
