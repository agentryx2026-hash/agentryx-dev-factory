import { createAccountStore } from "./accounts.js";
import { createSubmissionStore } from "./submissions.js";
import { createTimelineStore } from "./timeline.js";
import { createSLAEngine } from "./sla.js";

/**
 * Customer portal — high-level API composing accounts + submissions +
 * timeline + SLA engine.
 *
 * Every customer-facing method requires a bearer token. Tokens resolve to a
 * CustomerAccount; subsequent store operations filter by that account's id
 * (D167: enforces per-customer isolation at the API boundary).
 *
 * This module is the public surface Phase 19-B's HTTP layer wraps. 19-B
 * just maps HTTP verbs + headers to these method calls, adds auth
 * middleware, and serves responses.
 */

function authError(detail = "invalid or missing bearer token") {
  const err = new Error(`unauthorized: ${detail}`);
  err.code = "UNAUTHORIZED";
  return err;
}

function forbiddenError(detail = "forbidden") {
  const err = new Error(`forbidden: ${detail}`);
  err.code = "FORBIDDEN";
  return err;
}

function quotaError(reason) {
  const err = new Error(`quota_exceeded: ${reason}`);
  err.code = "QUOTA_EXCEEDED";
  return err;
}

function validationError(detail) {
  const err = new Error(`validation: ${detail}`);
  err.code = "VALIDATION";
  return err;
}

/**
 * @param {Object} init
 * @param {string} init.rootDir
 * @param {Object} [init.sla]              SLA engine opts (for test clock injection + policy overrides)
 */
export function createCustomerPortal(init) {
  if (!init?.rootDir) throw new Error("createCustomerPortal: rootDir required");

  const accounts = createAccountStore(init.rootDir);
  const submissions = createSubmissionStore(init.rootDir);
  const timeline = createTimelineStore(init.rootDir);
  const sla = createSLAEngine(init.sla || {});

  /** Resolve bearer → account, or throw UNAUTHORIZED. */
  async function resolveAuth(token) {
    if (!token) throw authError("no token provided");
    const account = await accounts.authenticate(token);
    if (!account) throw authError();
    return account;
  }

  return {
    accounts,
    submissions,
    timeline,
    sla,

    // --------------------------------------------------------------------
    // Account admin surface (platform operators call these; not exposed to customers in 19-B directly)
    // --------------------------------------------------------------------
    async registerCustomer(input) {
      return accounts.createAccount(input);
    },

    async setCustomerTier(customerId, tier) {
      return accounts.setTier(customerId, tier);
    },

    async listCustomers() {
      return accounts.list();
    },

    // --------------------------------------------------------------------
    // Customer-facing surface (all require token)
    // --------------------------------------------------------------------

    /**
     * Submit a new project. Returns a SubmissionReceipt.
     *
     * @param {string} token
     * @param {Object} payload
     * @param {string} payload.project_title
     * @param {string} payload.intake_payload
     * @param {string[]} [payload.tags]
     * @param {Record<string,any>} [payload.meta]
     * @returns {Promise<import("./types.js").SubmissionReceipt>}
     */
    async submitProject(token, payload) {
      const account = await resolveAuth(token);
      if (!payload || typeof payload !== "object") throw validationError("payload required");
      if (!payload.project_title) throw validationError("project_title required");
      if (!payload.intake_payload) throw validationError("intake_payload required");

      const active = await submissions.countActive(account.id);
      const quota = sla.checkQuota(account.tier, active);
      if (!quota.allowed) throw quotaError(quota.reason);

      const policy = sla.getPolicy(account.tier);
      const submittedAt = new Date().toISOString();
      const targetDelivery = sla.computeTargetDelivery(submittedAt, account.tier);

      const submission = await submissions.create({
        customer_id: account.id,
        project_title: payload.project_title,
        intake_payload: payload.intake_payload,
        budget_cap_usd: policy.budget_cap_usd,
        target_delivery_at: targetDelivery,
        tags: payload.tags,
        meta: payload.meta,
      });

      await timeline.append({
        customer_id: account.id,
        submission_id: submission.id,
        kind: "submitted",
        computed_eta_at: targetDelivery,
        note: "submission received",
      });

      return {
        submission_id: submission.id,
        status: submission.status,
        target_delivery_at: submission.target_delivery_at,
        budget_cap_usd: submission.budget_cap_usd,
        tier: account.tier,
        priority: policy.priority,
        submitted_at: submission.submitted_at,
      };
    },

    /**
     * Get the full status of a submission (with timeline + SLA).
     */
    async getStatus(token, submissionId) {
      const account = await resolveAuth(token);
      const submission = await submissions.get(account.id, submissionId);
      if (!submission) throw forbiddenError(`submission ${submissionId} not found for this account`);
      const events = await timeline.read(account.id, submissionId);
      const slaStatus = sla.computeStatus(submission, account.tier);
      return { submission, timeline: events, sla_status: slaStatus };
    },

    /**
     * List this customer's submissions, newest first.
     */
    async listMyProjects(token, filter = {}) {
      const account = await resolveAuth(token);
      return submissions.list(account.id, filter);
    },

    /**
     * Cancel a non-terminal submission. Legal from `submitted` / `accepted`
     * per the state-machine; calling on `in_progress` or terminal states
     * returns VALIDATION.
     */
    async cancelSubmission(token, submissionId, { note } = {}) {
      const account = await resolveAuth(token);
      const submission = await submissions.get(account.id, submissionId);
      if (!submission) throw forbiddenError(`submission ${submissionId} not found for this account`);

      try {
        const updated = await submissions.transition(account.id, submissionId, "cancelled", { note });
        await timeline.append({
          customer_id: account.id,
          submission_id: submissionId,
          kind: "cancelled",
          note: note || "customer cancelled",
        });
        return updated;
      } catch (err) {
        throw validationError(err.message);
      }
    },

    // --------------------------------------------------------------------
    // Platform-internal surface (called by queue handlers / admin automation)
    // These don't take tokens — platform code invokes them via trusted path.
    // --------------------------------------------------------------------

    async recordTimelineEvent(customerId, submissionId, event) {
      return timeline.append({ customer_id: customerId, submission_id: submissionId, ...event });
    },

    async transitionSubmission(customerId, submissionId, to, opts = {}) {
      return submissions.transition(customerId, submissionId, to, opts);
    },

    async addCost(customerId, submissionId, costUsd) {
      return submissions.addCost(customerId, submissionId, costUsd);
    },

    /**
     * Raise an SLA breach event. Called by a background job in 19-B that
     * scans non-terminal submissions periodically. 19-A exposes the API so
     * tests can invoke it directly.
     */
    async raiseSLABreach(customerId, submissionId, { note } = {}) {
      const submission = await submissions.get(customerId, submissionId);
      if (!submission) throw validationError(`submission ${submissionId} not found`);
      await timeline.append({
        customer_id: customerId,
        submission_id: submissionId,
        kind: "sla_breached",
        note: note || "elapsed past target delivery",
      });
    },

    /**
     * Admin-invoked rejection with reason.
     */
    async rejectSubmission(customerId, submissionId, { reason } = {}) {
      const updated = await submissions.transition(customerId, submissionId, "rejected", {
        note: reason,
      });
      await timeline.append({
        customer_id: customerId,
        submission_id: submissionId,
        kind: "rejected",
        note: reason,
      });
      return updated;
    },
  };
}
