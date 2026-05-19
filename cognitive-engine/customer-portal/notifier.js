/**
 * Phase 19-B Tier B — Customer-portal → Courier notifier (D230).
 *
 * Translates customer-portal lifecycle events (timeline kinds + the
 * `account` + `submission` records they relate to) into Courier
 * `dispatch` calls with the corresponding `customer.*` event type.
 *
 * Why a separate module (not inlined into each event source):
 *   - Three different subsystems emit portal events: HTTP routes
 *     (submit/cancel), queue handlers (project_intake, back-feed wrapper),
 *     and the SLA scanner. Each lives in its own file. Putting Courier
 *     formatting in each would duplicate the template logic; centralising
 *     keeps the customer-facing copy in one place.
 *   - Courier's event taxonomy + routing config is its own domain.
 *     The notifier owns the mapping from "portal thing happened" to
 *     "what should the customer/ops see in slack/email/stdout".
 *   - Tests can stub one dep (`courier.dispatch`) and exercise every
 *     notification path without spinning up the real factory.
 *
 * Why fail-isolated (notification failures never propagate):
 *   - Same rationale as D227 back-feed and D228 scanner: a notification
 *     failure must not roll back the underlying state change. The customer's
 *     submission *did* breach SLA; if Courier is down, the event still
 *     happened — we just can't notify right now. Better: log + move on,
 *     and the next breach detection cycle won't re-fire (the timeline
 *     dedup in the scanner handles that).
 *   - All notify methods catch + log; none throw.
 *
 * Why v0.0.1 ships with only `onSlaBreached` wired:
 *   - The notifier itself owns the dispatch + formatting for every
 *     `customer.*` event type. Adding more methods is cheap.
 *   - But each WIRING (callsite) lives in a different module (intake
 *     handler, back-feed wrapper, HTTP route, scanner). Wiring all
 *     four in one ship would make this PR larger and harder to review.
 *   - Scanner-first because it's the smallest delta: scanner already
 *     has a tight `runOnce` contract with deps injection; adding a
 *     `notifier?` dep is one line.
 *   - Subsequent ships (D231+) wire the other three sources, each
 *     reusing this notifier with no further changes here.
 *
 * @typedef NotifyResult
 * @property {boolean} ok            true if courier accepted + delivered
 * @property {string} [event_id]     Courier-assigned id (EVT-NNNN)
 * @property {string[]} [channels]   channels the event was delivered to
 * @property {boolean} [dropped]     true if the routing rule was missing
 *                                    or severity threshold blocked it
 * @property {string} [error]        present on hard failure (dispatch threw,
 *                                    validation failed, etc.)
 */

/**
 * @param {object} init
 * @param {object} init.courier      Phase 10-A `getCourier(...)` instance (must have `.dispatch(event) → Promise<DispatchResult>`)
 * @param {(line: string) => void} [init.onLog]  optional progress sink
 */
export function createPortalNotifier(init = {}) {
  if (!init?.courier || typeof init.courier.dispatch !== "function") {
    throw new Error("createPortalNotifier: deps.courier (Phase 10-A Courier instance with .dispatch) required");
  }
  const courier = init.courier;
  const log = (line) => { if (init.onLog) { try { init.onLog(line); } catch {} } };

  /**
   * Internal: dispatch + log + never throw. Returns NotifyResult.
   */
  async function dispatchSafely(event, label) {
    let result;
    try {
      result = await courier.dispatch(event);
    } catch (err) {
      log(`${label} dispatch threw: ${err?.message || err}`);
      return { ok: false, error: err?.message || String(err) };
    }
    if (!result?.ok) {
      log(`${label} dispatch failed: ${result?.error || "(no error message)"}`);
      return {
        ok: false,
        event_id: result?.event_id,
        channels: result?.channels_used,
        dropped: !!result?.dropped,
        error: result?.error,
      };
    }
    if (result.dropped) {
      log(`${label} dispatch dropped: ${result.reason || "(no reason)"}`);
      return { ok: true, event_id: result.event_id, channels: [], dropped: true };
    }
    log(`${label} dispatched as ${result.event_id} → [${(result.channels_used || []).join(",")}]`);
    return {
      ok: true,
      event_id: result.event_id,
      channels: result.channels_used,
      dropped: false,
    };
  }

  return {
    /**
     * Fire `customer.sla_breached` Courier event. Called by the SLA
     * breach scanner immediately after a successful `raiseSLABreach`.
     *
     * @param {object} input
     * @param {object} input.account                 CustomerAccount record (must include id, email, tier)
     * @param {object} input.submission              ProjectSubmission record (must include id, project_title, target_delivery_at, status)
     * @param {string} [input.note]                  optional note (defaults to scanner's standard message)
     * @returns {Promise<NotifyResult>}
     */
    async onSlaBreached({ account, submission, note } = {}) {
      if (!account?.id || !account?.email)        return { ok: false, error: "account.id + account.email required" };
      if (!submission?.id || !submission?.target_delivery_at) return { ok: false, error: "submission.id + submission.target_delivery_at required" };

      const event = {
        type: "customer.sla_breached",
        severity: "warn",
        project_id: `${account.id}_${submission.id}`,
        title: `SLA breached: ${submission.id} for ${account.email} (target was ${submission.target_delivery_at})`,
        body: [
          `Submission \`${submission.id}\` — "${submission.project_title || "(no title)"}" — has exceeded its SLA target without reaching a terminal state.`,
          ``,
          `- **Customer**: ${account.email} (\`${account.id}\`, tier=${account.tier})`,
          `- **Target delivery**: ${submission.target_delivery_at}`,
          `- **Current status**: ${submission.status}`,
          `- **Note**: ${note || "elapsed past target_delivery_at"}`,
          ``,
          `_v0.0.1: routed to stdout for founder visibility; per-customer channel prefs land in 19-C._`,
        ].join("\n"),
        meta: {
          customer_id: account.id,
          submission_id: submission.id,
          tier: account.tier,
          target_delivery_at: submission.target_delivery_at,
          submission_status: submission.status,
        },
      };
      return dispatchSafely(event, `customer.sla_breached(${submission.id})`);
    },

    /**
     * Fire `customer.submission_received` Courier event. Called by the
     * HTTP /submit route AFTER `portal.submitProject` succeeds + AFTER
     * auto-enqueue of project_intake (D225 + D231 wiring).
     *
     * @param {object} input
     * @param {object} input.account                 CustomerAccount record (id, email, tier required)
     * @param {object} input.submission              ProjectSubmission record (id, project_title, status, target_delivery_at required)
     * @returns {Promise<NotifyResult>}
     */
    async onSubmitted({ account, submission } = {}) {
      if (!account?.id || !account?.email)        return { ok: false, error: "account.id + account.email required" };
      if (!submission?.id || !submission?.target_delivery_at) return { ok: false, error: "submission.id + submission.target_delivery_at required" };

      const event = {
        type: "customer.submission_received",
        severity: "info",
        project_id: `${account.id}_${submission.id}`,
        title: `Submission received: ${submission.id} from ${account.email} — "${submission.project_title || "(no title)"}"`,
        body: [
          `New submission \`${submission.id}\` from \`${account.email}\` (tier=${account.tier}).`,
          ``,
          `- **Project**: ${submission.project_title || "(no title)"}`,
          `- **Status**: ${submission.status}`,
          `- **Target delivery**: ${submission.target_delivery_at}`,
          ``,
          `_The factory will pick this up via the project_intake queue handler within seconds._`,
        ].join("\n"),
        meta: {
          customer_id: account.id,
          submission_id: submission.id,
          tier: account.tier,
          target_delivery_at: submission.target_delivery_at,
          submission_status: submission.status,
        },
      };
      return dispatchSafely(event, `customer.submission_received(${submission.id})`);
    },

    /**
     * Fire `customer.submission_cancelled` Courier event. Called by the
     * HTTP /submissions/:id/cancel route AFTER `portal.cancelSubmission`
     * succeeds. Carries the cancel note so ops can see WHY (customer
     * regret / typo / scope change / etc.).
     *
     * @param {object} input
     * @param {object} input.account             CustomerAccount record (id, email, tier required)
     * @param {object} input.submission          ProjectSubmission record (id, project_title required; status will be 'cancelled' post-transition)
     * @param {string} [input.note]              customer-provided cancel note (forwarded into the event body)
     * @returns {Promise<NotifyResult>}
     */
    async onCancelled({ account, submission, note } = {}) {
      if (!account?.id || !account?.email) return { ok: false, error: "account.id + account.email required" };
      if (!submission?.id)                  return { ok: false, error: "submission.id required" };

      const event = {
        type: "customer.submission_cancelled",
        severity: "info",
        project_id: `${account.id}_${submission.id}`,
        title: `Submission cancelled: ${submission.id} by ${account.email}`,
        body: [
          `Submission \`${submission.id}\` — "${submission.project_title || "(no title)"}" — was cancelled by the customer.`,
          ``,
          `- **Customer**: ${account.email} (\`${account.id}\`, tier=${account.tier})`,
          `- **Status**: ${submission.status}`,
          `- **Customer note**: ${note || "(none provided)"}`,
        ].join("\n"),
        meta: {
          customer_id: account.id,
          submission_id: submission.id,
          tier: account.tier,
          submission_status: submission.status,
          cancel_note: note || null,
        },
      };
      return dispatchSafely(event, `customer.submission_cancelled(${submission.id})`);
    },

    /**
     * Reserved for D232+: onAccepted (project_intake handler) +
     * onDelivered (back-feed wrapper) + onRejected (admin reject).
     * Each lands in its own ship as the corresponding source module
     * gets wired.
     */
  };
}
