import path from "node:path";
import { writeArtifact, getArtifact } from "../artifacts/store.js";

/**
 * Execute a ReplayPlan. For each replay-set artifact (in temporal order):
 *   1. Resolve its parents — frozen, substituted, or freshly-produced in this replay.
 *   2. Invoke the registered NodeStub for the producing agent.
 *   3. Write the stub output as a new artifact in the project's _artifacts/ store,
 *      tagged with the new_run_id and parent_ids stitched to either originals (frozen)
 *      or new artifacts (replay-produced).
 *
 * @param {import("./types.js").ReplayPlan} plan
 * @param {object} ctx
 * @param {string} ctx.projectDir                              path to project under workspace (write target)
 * @param {Record<string, import("./types.js").NodeStub>} ctx.nodeStubs    agent_name → stub fn
 * @param {import("./types.js").RunSnapshot} ctx.snapshot      original snapshot (provides original artifact metadata)
 * @returns {Promise<import("./types.js").ReplayResult>}
 */
export async function executeReplay(plan, ctx) {
  if (!plan) throw new Error("executeReplay: plan required");
  if (!ctx?.projectDir) throw new Error("executeReplay: ctx.projectDir required");
  if (!ctx?.nodeStubs) throw new Error("executeReplay: ctx.nodeStubs required");
  if (!ctx?.snapshot) throw new Error("executeReplay: ctx.snapshot required");

  const t0 = Date.now();
  const original = (id) => ctx.snapshot.artifacts.find(a => a.id === id);

  // Map original artifact id → newly-produced artifact id (within this replay)
  const replayMap = new Map();
  // Frozen and substituted artifacts use their original IDs unchanged
  const resolveParent = (origParentId) => {
    if (replayMap.has(origParentId)) return replayMap.get(origParentId);
    if (plan.substitutions[origParentId]) return plan.substitutions[origParentId];
    return origParentId;
  };

  const produced = [];
  const newArtifactIds = [];

  try {
    for (const origId of plan.replay_artifact_ids) {
      const origArtifact = original(origId);
      if (!origArtifact) throw new Error(`replay set references unknown artifact ${origId}`);

      const stub = ctx.nodeStubs[origArtifact.agent];
      if (!stub) throw new Error(`no stub registered for agent '${origArtifact.agent}' (artifact ${origId})`);

      const resolvedParents = await Promise.all(origArtifact.parent_ids.map(async (p) => {
        const resolvedId = resolveParent(p);
        const fromOriginal = original(resolvedId);
        if (fromOriginal) return fromOriginal;
        // Resolved id is outside the original snapshot — likely a substitution
        // pointing at an artifact from a different run. Look it up from the project store.
        try {
          const fetched = await getArtifact(ctx.projectDir, resolvedId);
          if (fetched) {
            const r = fetched.record;
            return {
              id: r.id,
              kind: r.kind,
              run_id: r.produced_by?.run_id,
              agent: r.produced_by?.agent || "",
              model: r.produced_by?.model,
              node: r.produced_by?.node,
              parent_ids: r.parent_ids || [],
              produced_at: r.produced_at,
              cost_usd: r.cost_usd,
              latency_ms: r.latency_ms,
            };
          }
        } catch { /* fall through to placeholder */ }
        return { id: resolvedId, kind: "unknown", agent: "?", parent_ids: [], produced_at: "" };
      }));

      const stubOutput = await stub({
        original: origArtifact,
        parents: resolvedParents,
        new_run_id: plan.new_run_id,
        project_id: plan.project_id,
      });

      if (!stubOutput || stubOutput.content == null || !stubOutput.kind) {
        throw new Error(`stub for agent '${origArtifact.agent}' returned invalid output`);
      }

      const written = await writeArtifact(ctx.projectDir, {
        kind: stubOutput.kind,
        content: stubOutput.content,
        produced_by: {
          agent: stubOutput.agent || origArtifact.agent,
          model: stubOutput.model || origArtifact.model,
          node: stubOutput.node || origArtifact.node,
          run_id: plan.new_run_id,
          iteration: 1,
        },
        cost_usd: typeof stubOutput.cost_usd === "number" ? stubOutput.cost_usd : 0,
        latency_ms: stubOutput.latency_ms,
        parent_ids: origArtifact.parent_ids.map(resolveParent),
        tags: ["replay", `source:${plan.source_run_id}`],
        meta: { replays_artifact_id: origArtifact.id },
      });

      replayMap.set(origId, written.id);
      newArtifactIds.push(written.id);
      produced.push({ original_id: origId, new_id: written.id, agent: origArtifact.agent });
    }

    return {
      ok: true,
      new_run_id: plan.new_run_id,
      new_artifact_ids: newArtifactIds,
      produced,
      duration_ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      new_run_id: plan.new_run_id,
      new_artifact_ids: newArtifactIds,
      produced,
      error: err.message,
      duration_ms: Date.now() - t0,
    };
  }
}
