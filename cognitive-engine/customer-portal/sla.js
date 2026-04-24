import {
  DEFAULT_TIER_POLICIES, CUSTOMER_TIERS,
  isValidTier, isTerminal, nowIso,
} from "./types.js";

/**
 * SLA engine — tier-based policies + ETA calculator + breach detection.
 *
 * D169: policies live in a registered config (`customer_tiers`) that admin
 * UI (12-B) can tune. 19-A ships defaults from DEFAULT_TIER_POLICIES; a
 * custom policy map can be passed into `createSLAEngine({ policies })`.
 *
 * ETA math:
 *   target_delivery_at = submitted_at + tier.sla_hours
 *   elapsed_hours      = (now - submitted_at) / 1h
 *   remaining_hours    = (target - now) / 1h   (negative if breached)
 *   percent_elapsed    = elapsed_hours / tier.sla_hours
 *
 * Status bands:
 *   < 0.80          on_track
 *   0.80 ≤ x < 1.00 at_risk
 *   ≥ 1.00          breached (if non-terminal) / completed (if terminal)
 *   terminal + completed_at < target → completed with missed_sla=false
 *   terminal + completed_at > target → completed with missed_sla=true
 */

const AT_RISK_THRESHOLD = 0.80;

function toDateMs(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new Error(`invalid ISO timestamp: ${iso}`);
  return d.getTime();
}

function hoursBetween(aMs, bMs) {
  return (bMs - aMs) / (60 * 60 * 1000);
}

function addHoursIso(iso, hours) {
  return new Date(toDateMs(iso) + hours * 60 * 60 * 1000).toISOString();
}

/**
 * @param {Object} [init]
 * @param {Partial<Record<import("./types.js").CustomerTier, import("./types.js").SLAPolicy>>} [init.policies]   policy overrides (defaults merged in)
 * @param {() => number} [init.now]                                                                             for testing; returns ms since epoch
 */
export function createSLAEngine(init = {}) {
  const policies = {};
  for (const t of CUSTOMER_TIERS) {
    policies[t] = { ...DEFAULT_TIER_POLICIES[t], ...(init.policies?.[t] || {}) };
  }
  const nowMs = init.now || Date.now;

  function getPolicy(tier) {
    if (!isValidTier(tier)) throw new Error(`invalid tier: ${tier}`);
    return policies[tier];
  }

  /**
   * Compute the target delivery timestamp given a submitted_at and tier.
   */
  function computeTargetDelivery(submittedAt, tier) {
    const policy = getPolicy(tier);
    return addHoursIso(submittedAt, policy.sla_hours);
  }

  /**
   * Compute SLAStatus for a submission.
   *
   * @param {Object} submission                    ProjectSubmission record
   * @param {import("./types.js").CustomerTier} tier   authoritative tier at computation time (lookup from account)
   * @returns {import("./types.js").SLAStatus}
   */
  function computeStatus(submission, tier) {
    if (!submission) throw new Error("computeStatus: submission required");
    const policy = getPolicy(tier);
    const submittedMs = toDateMs(submission.submitted_at);
    const targetMs = toDateMs(submission.target_delivery_at || computeTargetDelivery(submission.submitted_at, tier));
    const now = nowMs();

    const terminal = isTerminal(submission.status);

    if (terminal) {
      const completedMs = submission.completed_at ? toDateMs(submission.completed_at) : now;
      const missed_sla = completedMs > targetMs;
      return {
        status: "completed",
        elapsed_hours: Math.round(hoursBetween(submittedMs, completedMs) * 100) / 100,
        remaining_hours: Math.round(hoursBetween(completedMs, targetMs) * 100) / 100,
        percent_elapsed: Math.round((hoursBetween(submittedMs, completedMs) / policy.sla_hours) * 1000) / 1000,
        target_delivery_at: submission.target_delivery_at,
        missed_sla,
        computed_at: new Date(now).toISOString(),
      };
    }

    const elapsed = hoursBetween(submittedMs, now);
    const remaining = hoursBetween(now, targetMs);
    const pct = elapsed / policy.sla_hours;

    let status;
    if (pct >= 1) status = "breached";
    else if (pct >= AT_RISK_THRESHOLD) status = "at_risk";
    else status = "on_track";

    return {
      status,
      elapsed_hours: Math.round(elapsed * 100) / 100,
      remaining_hours: Math.round(remaining * 100) / 100,
      percent_elapsed: Math.round(pct * 1000) / 1000,
      target_delivery_at: submission.target_delivery_at,
      missed_sla: false,
      computed_at: new Date(now).toISOString(),
    };
  }

  /**
   * Returns the list of non-terminal submissions whose elapsed time exceeds
   * the SLA window but whose status is not yet `rejected`/`delivered`.
   */
  function findBreaches(submissions, tiersByCustomer) {
    const out = [];
    for (const sub of submissions) {
      if (isTerminal(sub.status)) continue;
      const tier = tiersByCustomer[sub.customer_id];
      if (!tier) continue;
      const status = computeStatus(sub, tier);
      if (status.status === "breached") out.push({ submission: sub, sla_status: status });
    }
    return out;
  }

  /**
   * Check whether a customer can submit another project given their active
   * submissions count against the tier's max_active_submissions quota.
   */
  function checkQuota(tier, currentActiveCount) {
    const policy = getPolicy(tier);
    const max = policy.max_active_submissions;
    if (currentActiveCount >= max) {
      return {
        allowed: false,
        reason: `tier "${tier}" allows at most ${max} active submission(s); currently ${currentActiveCount}`,
        max,
        active: currentActiveCount,
      };
    }
    return { allowed: true, max, active: currentActiveCount, remaining: max - currentActiveCount };
  }

  function listPolicies() {
    return JSON.parse(JSON.stringify(policies));
  }

  return {
    getPolicy,
    computeTargetDelivery,
    computeStatus,
    findBreaches,
    checkQuota,
    listPolicies,
    get _now() { return nowMs(); },
  };
}
