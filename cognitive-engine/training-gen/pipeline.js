/**
 * Training-generation pipeline — compose ProjectContext → generator registry
 * → training store.
 *
 * The pipeline runs one generator per requested kind. Storyboard is
 * special-cased: it accepts the voiceover script artifact as an opts input,
 * so the pipeline runs voiceover first if both kinds are requested.
 *
 * The pipeline is idempotent at the TRAINING-artifact level: every run
 * produces a fresh `TART-NNNN` id (D151 — append-only). Callers who only
 * want one current version per kind should `store.readLatest(projectId, kind)`.
 */

import { isValidKind, TRAINING_KINDS } from "./types.js";

function orderKindsForPipeline(kinds) {
  // voiceover_script must run before video_storyboard so the storyboard
  // generator can parent onto the fresh voiceover artifact.
  const order = [
    "user_guide",
    "quick_start",
    "how_to",
    "reference_doc",
    "voiceover_script",
    "video_storyboard",
  ];
  const set = new Set(kinds);
  return order.filter(k => set.has(k));
}

/**
 * @param {Object} args
 * @param {import("./types.js").ProjectContext} args.ctx
 * @param {import("./store.js").createTrainingStore extends infer T ? any : any} args.store
 * @param {{ register, get, has, list }} args.registry                 generator registry
 * @param {import("./types.js").TrainingKind[]} [args.kinds]           subset to generate; defaults to all registered
 * @param {Record<string, any>} [args.perKindOpts]                     optional {kind: opts} map forwarded to generators
 * @returns {Promise<{ produced: Array<{kind, record}>, errors: Array<{kind, error}> }>}
 */
export async function runPipeline({ ctx, store, registry, kinds, perKindOpts = {} }) {
  if (!ctx?.project_id) throw new Error("pipeline: ctx.project_id required");
  if (!ctx?.project_title) throw new Error("pipeline: ctx.project_title required");
  if (!store?.write) throw new Error("pipeline: store.write required");
  if (!registry?.get) throw new Error("pipeline: registry required");

  const requested = (kinds || registry.list()).filter(k => isValidKind(k));
  const ordered = orderKindsForPipeline(requested);

  const produced = [];
  const errors = [];
  let voiceoverRecord = null;
  let voiceoverContent = null;

  for (const kind of ordered) {
    const def = registry.get(kind);
    if (!def) {
      errors.push({ kind, error: `no generator registered for ${kind}` });
      continue;
    }
    try {
      const opts = { ...(perKindOpts[kind] || {}) };
      if (kind === "video_storyboard" && voiceoverRecord && !opts.voiceover) {
        opts.voiceover = { record: voiceoverRecord, content: voiceoverContent };
      }
      const out = await def.fn(ctx, opts);
      if (!out || !out.title || out.content == null) {
        errors.push({ kind, error: `generator ${def.id} returned invalid output` });
        continue;
      }

      const record = await store.write({
        project_id: ctx.project_id,
        kind,
        title: out.title,
        content: out.content,
        produced_by: { generator_id: def.id },
        parent_ids: out.parent_ids || [],
        tags: out.tags || [],
        meta: out.meta || {},
        cost_usd: 0,
      });
      produced.push({ kind, record });

      if (kind === "voiceover_script") {
        voiceoverRecord = record;
        voiceoverContent = out.content;
      }
    } catch (err) {
      errors.push({ kind, error: err?.message || String(err) });
    }
  }

  return { produced, errors };
}

export { TRAINING_KINDS };
