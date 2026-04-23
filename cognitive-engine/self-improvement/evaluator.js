import { nowIso } from "./types.js";

/**
 * Evaluator — scores a Proposal by running replays with the proposed change
 * applied to a sample of past runs, then comparing outcomes.
 *
 * D144: In 15-A the evaluator is harness-only. The real "did this change help?"
 * question needs (a) a real LLM proposer to produce meaningful prompt/model
 * patches and (b) a real outcome-comparison function (cost, success-rate,
 * latency as judged by a grader). Both are 15-B. 15-A provides:
 *
 *   - the harness: sample → replay loop → aggregate → EvaluationResult
 *   - a stub `compareOutcomes` that returns a deterministic dummy delta
 *   - Phase 14-A concurrency integration hook (run replays as queue jobs
 *     when desired; not required for the smoke path)
 *
 * Everything external to the harness is dependency-injected:
 *
 *   evaluate(proposal, ctx)
 *     ctx.snapshots       — array of RunSnapshot for the sample
 *     ctx.runReplay(plan) — Promise<ReplayResult>; caller decides whether to
 *                           run inline or via queue/subprocess
 *     ctx.compareOutcomes — (origSnapshot, replayResult, proposal) → {
 *                              cost_delta_usd, latency_delta_ms,
 *                              success_rate_delta, comparison_note
 *                           }
 *     ctx.buildPlan       — (snapshot, proposal) → ReplayPlan
 *                           (defaults to a no-op plan with the LAST artifact as pivot)
 */

/**
 * Default plan builder: pivot on the last artifact of the snapshot. For a
 * prompt_change on agent:troi, the real planner would pivot on the first
 * Troi-produced artifact. 15-A uses last-artifact because the heuristic doesn't
 * know which artifact belongs to which agent — that's a 15-B enhancement.
 */
function defaultBuildPlan(snapshot /*, proposal */) {
  if (!snapshot?.artifacts?.length) {
    throw new Error("evaluator: snapshot has no artifacts to pivot on");
  }
  const pivot = snapshot.artifacts[snapshot.artifacts.length - 1];
  return {
    source_run_id: snapshot.run_id,
    new_run_id: `${snapshot.run_id}.eval.${Date.now()}`,
    project_id: snapshot.project_id,
    replay_from_artifact_id: pivot.id,
    frozen_artifact_ids: snapshot.artifacts.slice(0, -1).map(a => a.id).sort(),
    replay_artifact_ids: [pivot.id],
    substitutions: {},
  };
}

/**
 * Default outcome comparator — stub that returns zero deltas. Proves the
 * contract. Real comparison lives in 15-B (cost from artifact.cost_usd sums,
 * success-rate from LLM grader, latency from artifact.latency_ms sums).
 */
function defaultCompareOutcomes(/* snapshot, replayResult, proposal */) {
  return {
    cost_delta_usd: 0,
    latency_delta_ms: 0,
    success_rate_delta: 0,
    comparison_note: "stub comparator — real metrics arrive in 15-B",
  };
}

/**
 * Aggregate per-sample deltas into one EvaluationResult.
 * Takes arithmetic mean across samples; tracks sample_size for the reviewer.
 */
export function aggregateDeltas(deltas) {
  if (!deltas.length) {
    return {
      cost_delta_usd: 0,
      latency_delta_ms: 0,
      success_rate_delta: 0,
      comparison_note: "no samples evaluated",
      sample_size: 0,
    };
  }
  const n = deltas.length;
  const sum = deltas.reduce(
    (acc, d) => ({
      cost_delta_usd: acc.cost_delta_usd + (d.cost_delta_usd || 0),
      latency_delta_ms: acc.latency_delta_ms + (d.latency_delta_ms || 0),
      success_rate_delta: acc.success_rate_delta + (d.success_rate_delta || 0),
    }),
    { cost_delta_usd: 0, latency_delta_ms: 0, success_rate_delta: 0 }
  );
  return {
    cost_delta_usd: sum.cost_delta_usd / n,
    latency_delta_ms: sum.latency_delta_ms / n,
    success_rate_delta: sum.success_rate_delta / n,
    comparison_note: `mean across ${n} samples`,
    sample_size: n,
  };
}

/**
 * Evaluate a proposal.
 *
 * @param {import("./types.js").Proposal} proposal
 * @param {Object} ctx
 * @param {import("./replay/types.js").RunSnapshot[]} ctx.snapshots
 * @param {(plan: any) => Promise<any>} ctx.runReplay
 * @param {(s: any, r: any, p: any) => import("./types.js").EvaluationResult} [ctx.compareOutcomes]
 * @param {(s: any, p: any) => any} [ctx.buildPlan]
 * @returns {Promise<import("./types.js").EvaluationResult>}
 */
export async function evaluateProposal(proposal, ctx) {
  if (!proposal) throw new Error("evaluateProposal: proposal required");
  if (!Array.isArray(ctx?.snapshots)) throw new Error("evaluateProposal: ctx.snapshots required");
  if (typeof ctx.runReplay !== "function") throw new Error("evaluateProposal: ctx.runReplay required");

  const buildPlan = ctx.buildPlan || defaultBuildPlan;
  const compareOutcomes = ctx.compareOutcomes || defaultCompareOutcomes;

  const deltas = [];
  const perSample = [];

  for (const snapshot of ctx.snapshots) {
    const plan = buildPlan(snapshot, proposal);
    let replayResult;
    try {
      replayResult = await ctx.runReplay(plan);
    } catch (err) {
      perSample.push({ run_id: snapshot.run_id, ok: false, error: err.message });
      continue;
    }
    if (!replayResult?.ok) {
      perSample.push({ run_id: snapshot.run_id, ok: false, error: replayResult?.error || "replay failed" });
      continue;
    }
    const delta = compareOutcomes(snapshot, replayResult, proposal);
    deltas.push(delta);
    perSample.push({ run_id: snapshot.run_id, ok: true, delta });
  }

  const agg = aggregateDeltas(deltas);
  return {
    sample_size: agg.sample_size,
    cost_delta_usd: agg.cost_delta_usd,
    latency_delta_ms: agg.latency_delta_ms,
    success_rate_delta: agg.success_rate_delta,
    comparison_note: agg.comparison_note,
    evaluated_at: nowIso(),
    per_sample: perSample,
  };
}

/**
 * Convenience wrapper: transition proposal to "evaluating", run evaluation,
 * patch result onto proposal, transition to "ready".
 *
 * On replay-exhaustion (0 successful samples) we still mark "ready" so the
 * reviewer can see and reject; caller may prefer "rejected" if that's the
 * policy.
 */
export async function evaluateAndStore({ proposal, store, ctx, actor = "evaluator" }) {
  await store.transition(proposal.id, "evaluating", { actor });
  const evaluation = await evaluateProposal(proposal, ctx);
  const patch = { evaluation };
  return store.transition(proposal.id, "ready", { actor, patch });
}
