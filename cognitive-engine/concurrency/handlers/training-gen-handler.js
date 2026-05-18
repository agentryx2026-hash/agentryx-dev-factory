/**
 * Phase 16-B Tier B — `training_gen` queue handler.
 *
 * Wraps Phase 16-A's `runPipeline({ctx, store, registry, kinds, perKindOpts})`
 * so training-artifact generation jobs can flow through the Phase 14-A
 * queue rather than being invoked inline from any single caller. This is
 * the substrate registration: kinds are dispatched via the handler
 * registry, so the post-dev graph (today) and the Verify auto-fix cycle
 * (full 9-B) can both enqueue training generation without knowing each
 * other exist.
 *
 * Today the registry uses Phase 16-A's TEMPLATE generators (markdown +
 * structured beats; no LLM calls). When OpenRouter is wired, swap any
 * kind to an LLM-backed generator via `registry.register(kind, llmFn)`
 * — same DI seam as Phase 9-A fixRouter, Phase 13-A nodeStubs, Phase
 * 14-A handlerRegistry, Phase 15-A proposer. The handler doesn't change.
 *
 * Payload shape:
 *   {
 *     project_id:   string,         // required (also used for project_id quota gate)
 *     ctx:          ProjectContext, // required (Phase 16-A types.js)
 *     kinds?:       TrainingKind[], // optional subset; defaults to all 6 registered
 *     perKindOpts?: Record<TrainingKind, any>, // optional generator opts
 *     store_root?:  string,         // optional; defaults to <workspaceRoot>/_training-store
 *   }
 *
 * Returns:
 *   { produced_count, errors_count, produced_ids[], errors[] }
 *
 * Phase 17-B's `training_video_render` handler will land in its own
 * file under this directory — same registry, same pattern.
 */

import path from "node:path";

const TRAINING_GEN_KIND = "training_gen";

/**
 * Register the training_gen handler on a Phase 14-A registry.
 * Idempotent; re-registering replaces the prior handler.
 *
 * Dependency injection — the caller passes the substrate construction
 * functions so tests can stub them.
 *
 * @param {object} registry                          createHandlerRegistry() result
 * @param {object} deps
 * @param {Function} deps.createTrainingStore        Phase 16-A `createTrainingStore(rootDir)`
 * @param {Function} deps.createGeneratorRegistry    Phase 16-A `createGeneratorRegistry({defaults?})`
 * @param {Function} deps.runPipeline                Phase 16-A `runPipeline({ctx, store, registry, kinds, perKindOpts})`
 * @param {string} [deps.defaultStoreRoot]           default training-store root if payload doesn't override
 * @param {(line: string, jobId: string) => void} [deps.onLog]
 *   Pipes per-kind progress lines into telemetry's Live Trace stream.
 */
export function registerTrainingGenHandler(registry, deps = {}) {
  if (!registry?.register) throw new Error("registerTrainingGenHandler: registry required");
  if (typeof deps.createTrainingStore !== "function") throw new Error("registerTrainingGenHandler: deps.createTrainingStore required");
  if (typeof deps.createGeneratorRegistry !== "function") throw new Error("registerTrainingGenHandler: deps.createGeneratorRegistry required");
  if (typeof deps.runPipeline !== "function") throw new Error("registerTrainingGenHandler: deps.runPipeline required");

  registry.register(TRAINING_GEN_KIND, async (job, ctx /* { workingDir, worker_id } */) => {
    const payload = job.payload || {};
    const projectCtx = payload.ctx;
    if (!projectCtx?.project_id) throw new Error(`${TRAINING_GEN_KIND} job ${job.id}: payload.ctx.project_id required`);
    if (!projectCtx?.project_title) throw new Error(`${TRAINING_GEN_KIND} job ${job.id}: payload.ctx.project_title required`);

    const storeRoot = payload.store_root
      || deps.defaultStoreRoot
      || (ctx?.workingDir ? path.join(ctx.workingDir, "_training-store") : null);
    if (!storeRoot) throw new Error(`${TRAINING_GEN_KIND} job ${job.id}: store_root not resolvable (payload.store_root or deps.defaultStoreRoot or ctx.workingDir required)`);

    const store = deps.createTrainingStore(storeRoot);
    const genRegistry = deps.createGeneratorRegistry({ defaults: true });

    if (deps.onLog) {
      try { deps.onLog(`training_gen start: ${projectCtx.project_id} (${(payload.kinds || ["all"]).join(",")})`, job.id); } catch {}
    }

    const result = await deps.runPipeline({
      ctx: projectCtx,
      store,
      registry: genRegistry,
      kinds: payload.kinds,
      perKindOpts: payload.perKindOpts || {},
    });

    if (deps.onLog) {
      try {
        deps.onLog(
          `training_gen done: produced=${result.produced.length} errors=${result.errors.length}`,
          job.id
        );
        for (const e of result.errors) {
          deps.onLog(`  ⚠️ ${e.kind}: ${e.error}`, job.id);
        }
      } catch {}
    }

    return {
      produced_count: result.produced.length,
      errors_count: result.errors.length,
      produced_ids: result.produced.map(p => ({ kind: p.kind, id: p.record.id, title: p.record.title })),
      errors: result.errors,
    };
  });

  return registry;
}

export { TRAINING_GEN_KIND };
