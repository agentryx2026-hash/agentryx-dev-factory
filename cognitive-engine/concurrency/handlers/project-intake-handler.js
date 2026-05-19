/**
 * Phase 19-B Tier B — `project_intake` queue handler.
 *
 * Wraps the Phase 19-A customer portal so customer submissions can flow
 * through the Phase 14-A queue end-to-end. When a customer hits the
 * HTTP submit surface (`portal.submitProject(token, payload)`, lands
 * in 19-B-HTTP), an `project_intake` job gets enqueued. This handler
 * picks it up, walks the submission through `submitted → accepted →
 * in_progress`, and enqueues a downstream `pre_dev` job so the factory
 * pipeline picks the project up.
 *
 * Same DI pattern as Phase 14-B factory-handlers (D211), 21-B.2
 * architect-handler (D217), 16-B training-gen-handler (D219), 17-B
 * training-video-handler (D220).
 *
 * Why a separate handler module (not extending factory-handlers.js):
 *   - Customer-portal is a distinct domain. Mixing it with pipeline
 *     handlers leaks customer-state-machine concepts into the
 *     pipeline-graph file. Domain separation per D211.
 *   - Test ergonomics: stub the portal + queue and exercise the full
 *     contract without filesystem.
 *   - Phase 19-B's full close adds a back-feed handler (pre_dev done →
 *     transition submission to delivered) — that's its own module too.
 *
 * Payload shape:
 *   {
 *     customer_id:   string,    // required (CUST-NNNN)
 *     submission_id: string,    // required (SUB-NNNN)
 *   }
 *
 * Returns:
 *   {
 *     submission_id, customer_id,
 *     accepted_at: ISO,
 *     downstream_pre_dev_job_id: string,
 *     status: "in_progress",
 *   }
 *
 * State machine (from Phase 19-A): submitted → accepted → in_progress →
 * delivered. This handler advances submitted → accepted → in_progress.
 * The "delivered" transition happens when the downstream pre_dev job
 * completes (Phase 19-B full work: a wrapper around the pre_dev handler
 * that on success transitions the parent submission).
 *
 * Failure modes:
 *   - Submission not found (wrong customer_id / submission_id): job
 *     fails, no transitions attempted
 *   - Submission already in non-`submitted` state: job fails with a
 *     clear "illegal transition" error (the state machine in
 *     submissions.js refuses)
 *   - Downstream pre_dev enqueue fails: timeline records a
 *     `pre_dev_enqueue_failed` event; submission stays in `accepted`
 *     (NOT advanced to in_progress) so the founder can re-trigger
 *     after fixing the underlying issue
 */

const PROJECT_INTAKE_KIND = "project_intake";

/**
 * Register the project_intake handler on a Phase 14-A registry.
 *
 * @param {object} registry                          createHandlerRegistry() result
 * @param {object} deps
 * @param {object} deps.portal                       Phase 19-A `createCustomerPortal(...)` instance
 * @param {object} deps.queue                        Phase 14-A `createQueue(...)` instance — used to enqueue downstream pre_dev jobs
 * @param {object} [deps.notifier]                   Optional Phase 19-B portal notifier (D230). When present + has .onAccepted, fires a customer.submission_accepted Courier event immediately after the submitted→accepted transition (D232 wiring). Fail-isolated — notifier errors never propagate.
 * @param {(line: string, jobId: string) => void} [deps.onLog]
 *   Optional progress sink — pipes each lifecycle event to a Live Trace stream.
 */
export function registerProjectIntakeHandler(registry, deps = {}) {
  if (!registry?.register) throw new Error("registerProjectIntakeHandler: registry required");
  if (!deps?.portal?.submissions || !deps?.portal?.transitionSubmission) {
    throw new Error("registerProjectIntakeHandler: deps.portal (customer-portal instance) required");
  }
  if (!deps?.queue?.enqueue) {
    throw new Error("registerProjectIntakeHandler: deps.queue (Phase 14-A queue instance) required");
  }
  const notifier = deps.notifier && typeof deps.notifier.onAccepted === "function" ? deps.notifier : null;

  registry.register(PROJECT_INTAKE_KIND, async (job /*, ctx */) => {
    const payload = job.payload || {};
    if (!payload.customer_id)   throw new Error(`${PROJECT_INTAKE_KIND} job ${job.id}: payload.customer_id required`);
    if (!payload.submission_id) throw new Error(`${PROJECT_INTAKE_KIND} job ${job.id}: payload.submission_id required`);

    const log = (msg) => { if (deps.onLog) { try { deps.onLog(msg, job.id); } catch {} } };

    // 1. Look up the submission. If absent, fail fast — there's nothing
    //    sensible to do with a bad reference.
    const submission = await deps.portal.submissions.get(payload.customer_id, payload.submission_id);
    if (!submission) {
      throw new Error(`${PROJECT_INTAKE_KIND} job ${job.id}: submission ${payload.submission_id} not found for ${payload.customer_id}`);
    }
    log(`intake start: ${payload.customer_id} / ${payload.submission_id} (status=${submission.status})`);

    // Idempotency guard (D226). If a previous attempt already advanced
    // this submission past `submitted`, short-circuit. Two scenarios:
    //   - status === "in_progress" with downstream_pre_dev_job_id set:
    //     prior attempt completed end-to-end; just return its result.
    //   - status === "accepted": prior attempt died after the first
    //     transition + downstream enqueue but before the in_progress
    //     transition. Resume from where we left off (skip the
    //     submitted→accepted step, do everything after).
    // Anything else (rejected/cancelled/delivered) is terminal or
    // illegal — let the state machine throw on the transition attempt.
    if (submission.status === "in_progress" && submission.downstream_pre_dev_job_id) {
      log(`already in_progress with downstream=${submission.downstream_pre_dev_job_id}; returning prior result (idempotent)`);
      return {
        submission_id: payload.submission_id,
        customer_id: payload.customer_id,
        accepted_at: submission.accepted_at || new Date().toISOString(),
        downstream_pre_dev_job_id: submission.downstream_pre_dev_job_id,
        downstream_project_id: `${payload.customer_id}_${payload.submission_id}`,
        status: "in_progress",
        idempotent_replay: true,
      };
    }

    // 2. submitted → accepted (only if not already accepted on a prior attempt).
    const acceptedAt = new Date().toISOString();
    if (submission.status === "submitted") {
      await deps.portal.transitionSubmission(payload.customer_id, payload.submission_id, "accepted", {
        note: `accepted by project_intake handler (job ${job.id})`,
      });
      await deps.portal.recordTimelineEvent(payload.customer_id, payload.submission_id, {
        kind: "accepted",
        note: `intake handler ${job.id}`,
      });
      log(`accepted at ${acceptedAt}`);

      // D232 — fire customer.submission_accepted Courier event. Only on
      // FRESH transitions (skipped on idempotent-resume to avoid double-
      // notifications). Fail-isolated: notifier errors never propagate
      // — the transition already succeeded.
      if (notifier) {
        try {
          // Re-fetch so the event meta carries the post-transition state.
          const acceptedSub = await deps.portal.submissions.get(payload.customer_id, payload.submission_id);
          if (acceptedSub) {
            const account = await deps.portal.accounts.getById(payload.customer_id);
            if (account) await notifier.onAccepted({ account, submission: acceptedSub, intake_job_id: job.id });
          }
        } catch (notifyErr) {
          log(`notifier.onAccepted failed for ${payload.submission_id}: ${notifyErr?.message || notifyErr}`);
        }
      }
    } else {
      log(`already in '${submission.status}'; skipping submitted→accepted (resuming from prior partial attempt)`);
    }

    // 3. Enqueue downstream pre_dev work. Use a project_id that's
    //    customer-prefixed so cost-tracker rollups + per-project quota
    //    gating can scope to the customer's submissions specifically.
    //    Priority defaults match Phase 14-A's pre_dev default (50).
    const downstreamProjectId = `${payload.customer_id}_${payload.submission_id}`;
    let downstreamJob;
    try {
      downstreamJob = await deps.queue.enqueue({
        kind: "pre_dev",
        project_id: downstreamProjectId,
        payload: {
          task: submission.intake_payload,
          customer_id: payload.customer_id,
          submission_id: payload.submission_id,
          project_title: submission.project_title,
        },
        priority: 50,
        max_attempts: 2,
      });
      log(`pre_dev enqueued as ${downstreamJob.id} (project_id=${downstreamProjectId})`);
    } catch (err) {
      // Downstream enqueue failed → record timeline + leave in accepted
      // (NOT in_progress) so the founder can re-fire after fixing.
      await deps.portal.recordTimelineEvent(payload.customer_id, payload.submission_id, {
        kind: "note",  // 'note' is the catch-all kind for non-state events; portal types.js doesn't have a dedicated 'error' kind
        note: `pre_dev enqueue failed: ${err?.message || String(err)}`,
      });
      throw err;
    }

    // 4. accepted → in_progress. The actual factory work proceeds via
    //    the downstream pre_dev → dev → post_dev chain. Phase 19-B full
    //    will wire a back-feed handler that transitions to "delivered"
    //    when the post_dev job completes.
    await deps.portal.transitionSubmission(payload.customer_id, payload.submission_id, "in_progress", {
      note: `pre_dev job ${downstreamJob.id} enqueued; awaiting pipeline completion`,
      patch: { downstream_pre_dev_job_id: downstreamJob.id },
    });
    await deps.portal.recordTimelineEvent(payload.customer_id, payload.submission_id, {
      kind: "phase_started",
      phase: "pre_dev",
      note: `downstream job ${downstreamJob.id} scheduled`,
    });
    log(`in_progress; downstream=${downstreamJob.id}`);

    return {
      submission_id: payload.submission_id,
      customer_id: payload.customer_id,
      accepted_at: acceptedAt,
      downstream_pre_dev_job_id: downstreamJob.id,
      downstream_project_id: downstreamProjectId,
      status: "in_progress",
    };
  });

  return registry;
}

export { PROJECT_INTAKE_KIND };
