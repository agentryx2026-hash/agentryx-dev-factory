/**
 * Phase 19-B — customer submission back-feed wrapper.
 *
 * Wraps an existing Phase 14-A queue handler so that after the inner
 * handler completes successfully, if the job's payload identifies a
 * parent customer submission (via `customer_id` + `submission_id`,
 * threaded through by the project_intake handler — D224), the
 * customer-portal submission state advances accordingly:
 *
 *   - Job kind matches `finalKind` (default: "pre_dev" for v0.0.1
 *     scope) → transition submission `in_progress → delivered` +
 *     record a `delivered` timeline event.
 *   - Job kind in `phaseKinds` (default: "dev" / "post_dev") →
 *     record a `phase_completed` timeline event but DO NOT transition
 *     yet (intermediate pipeline phases; the final transition lands
 *     when `finalKind` fires).
 *   - Anything else (no customer_id, or kind isn't in the maps) → no
 *     back-feed action; just return the inner handler's result.
 *
 * Why a wrapper (and not a modification of factory-handlers.js):
 *   - factory-handlers.js belongs to the pipeline-graph domain (D211).
 *     Customer-portal is a different domain. The wrapper composes
 *     them externally so neither leaks into the other.
 *   - Same DI seam as everything else (D211 / D217 / D219 / D220 /
 *     D224 / D225 / D226).
 *
 * Why "transition after `pre_dev` only" for v0.0.1:
 *   - The project_intake handler (D224) currently enqueues only
 *     pre_dev as the downstream job. A customer submission's "delivery"
 *     == "pre_dev completed successfully" at this stage.
 *   - When the full customer flow gets wired (project_intake →
 *     pre_dev → dev → post_dev → delivered), change `finalKind` to
 *     "post_dev" at registration time. No code change in the wrapper.
 *
 * Idempotency (D226 lesson applied):
 *   - Check current submission status BEFORE transitioning. If already
 *     terminal (delivered / rejected / cancelled), skip — the back-feed
 *     has already fired (or was rendered moot by a parallel admin
 *     action).
 *   - Recording a duplicate timeline event is harmless (append-only
 *     JSONL with a fresh `at` timestamp), so we don't dedupe events.
 *     Submission-state transitions are the only ones with strict
 *     idempotency constraints.
 *
 * Failure isolation:
 *   - If the back-feed transition throws, the inner handler's result
 *     is STILL returned to the queue (so the worker marks the job
 *     `done` correctly). The transition error is logged + emitted via
 *     `onLog` so ops can recover the submission manually.
 *   - Rationale: the customer's downstream work succeeded (pre_dev
 *     produced artifacts). Failing the job because of a back-feed
 *     bookkeeping issue would put the job in `failed/` and retry the
 *     expensive pre_dev work unnecessarily.
 */

/** Default mapping of intermediate pipeline kinds → no terminal transition, just phase_completed event. */
const DEFAULT_PHASE_KINDS = ["dev", "post_dev"];

/** Default kind that triggers the in_progress → delivered transition. */
const DEFAULT_FINAL_KIND = "pre_dev";

/**
 * Wrap a Phase 14-A handler so customer-portal back-feed fires after
 * successful inner-handler completion.
 *
 * @param {Function} originalHandler              the handler from registry.get(kind) (or any async (job, ctx) => result)
 * @param {object} deps
 * @param {object} deps.portal                    Phase 19-A `createCustomerPortal(...)` instance
 * @param {string} [deps.finalKind]               kind that triggers the delivered transition (default "pre_dev")
 * @param {string[]} [deps.phaseKinds]            kinds that record a phase_completed event only (default ["dev","post_dev"])
 * @param {(line: string, jobId: string) => void} [deps.onLog]
 * @returns {Function} wrapped handler with the same (job, ctx) → result signature
 */
export function wrapForCustomerBackfeed(originalHandler, deps = {}) {
  if (typeof originalHandler !== "function") {
    throw new Error("wrapForCustomerBackfeed: originalHandler required");
  }
  if (!deps?.portal?.transitionSubmission || !deps?.portal?.submissions?.get) {
    throw new Error("wrapForCustomerBackfeed: deps.portal (customer-portal instance) required");
  }

  const finalKind  = deps.finalKind  || DEFAULT_FINAL_KIND;
  const phaseKinds = new Set(deps.phaseKinds || DEFAULT_PHASE_KINDS);
  const log = (msg, jobId) => { if (deps.onLog) { try { deps.onLog(msg, jobId); } catch {} } };
  // D232 — optional portal notifier. When present + has .onDelivered,
  // fires customer.submission_delivered Courier event after the
  // in_progress→delivered transition succeeds. Fail-isolated.
  const notifier = deps.notifier && typeof deps.notifier.onDelivered === "function" ? deps.notifier : null;

  return async function wrappedHandler(job, ctx) {
    // 1. Run the inner handler unchanged.
    const result = await originalHandler(job, ctx);

    // 2. Back-feed gate: only fire if this job has customer-submission refs.
    const customer_id   = job.payload?.customer_id;
    const submission_id = job.payload?.submission_id;
    if (!customer_id || !submission_id) {
      return result;  // not a customer-submitted job; pass through
    }

    // 3. Look up current submission state — idempotency check.
    let submission;
    try {
      submission = await deps.portal.submissions.get(customer_id, submission_id);
    } catch (lookupErr) {
      log(`back-feed lookup failed for ${customer_id}/${submission_id}: ${lookupErr?.message || lookupErr}`, job.id);
      return result;  // fail-isolated; don't propagate to queue
    }
    if (!submission) {
      log(`back-feed: submission ${submission_id} not found for ${customer_id} (was it deleted?)`, job.id);
      return result;
    }

    // 4. Already-terminal short-circuit (idempotent retry, or admin
    //    cancelled/rejected in parallel).
    const TERMINAL = new Set(["delivered", "rejected", "cancelled"]);
    if (TERMINAL.has(submission.status)) {
      log(`back-feed: submission ${submission_id} already terminal (${submission.status}); skipping`, job.id);
      return result;
    }

    // 5. Branch by kind.
    try {
      if (job.kind === finalKind) {
        // Final phase — transition to delivered.
        await deps.portal.transitionSubmission(customer_id, submission_id, "delivered", {
          note: `${job.kind} job ${job.id} completed; delivering`,
          patch: { delivered_by_job_id: job.id },
        });
        await deps.portal.recordTimelineEvent(customer_id, submission_id, {
          kind: "delivered",
          note: `${job.kind} job ${job.id} completed`,
        });
        log(`back-feed: ${submission_id} → delivered (via ${job.kind} ${job.id})`, job.id);

        // D232 — fire customer.submission_delivered Courier event.
        // Fail-isolated: notifier errors never propagate (the transition
        // already succeeded; not delivering a notification is acceptable).
        if (notifier && deps.portal.accounts?.getById) {
          try {
            const deliveredSub = await deps.portal.submissions.get(customer_id, submission_id);
            const account = await deps.portal.accounts.getById(customer_id);
            if (account && deliveredSub) {
              await notifier.onDelivered({ account, submission: deliveredSub, delivered_by_job_id: job.id });
            }
          } catch (notifyErr) {
            log(`notifier.onDelivered failed for ${submission_id}: ${notifyErr?.message || notifyErr}`, job.id);
          }
        }
      } else if (phaseKinds.has(job.kind)) {
        // Intermediate phase — record completion only.
        await deps.portal.recordTimelineEvent(customer_id, submission_id, {
          kind: "phase_completed",
          phase: job.kind,
          note: `${job.kind} job ${job.id} completed`,
        });
        log(`back-feed: ${submission_id} phase_completed: ${job.kind} (${job.id})`, job.id);
      } else {
        // Unrecognized kind — no back-feed action (e.g. architect_research
        // would have customer_id only if accidentally threaded; skip
        // silently).
        log(`back-feed: ${job.kind} not in {finalKind=${finalKind}, phaseKinds=[${[...phaseKinds].join(",")}]}; no submission action`, job.id);
      }
    } catch (transitionErr) {
      // Fail-isolated: log + swallow. Inner handler succeeded; the
      // queue must still see the job as done.
      log(`back-feed transition FAILED for ${submission_id}: ${transitionErr?.message || transitionErr}`, job.id);
      console.warn(`[customer-backfeed] ${job.kind} ${job.id} → ${submission_id} transition failed:`, transitionErr?.message || transitionErr);
    }

    return result;
  };
}

export { DEFAULT_FINAL_KIND, DEFAULT_PHASE_KINDS };
