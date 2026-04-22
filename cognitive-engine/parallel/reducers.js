/**
 * State reducer helpers for LangGraph parallel branches.
 *
 * When multiple nodes run concurrently and write to the same state field,
 * the field's reducer determines how their writes are merged. The naive
 * `(a, b) => b ?? a` (last-write-wins) is wrong for parallel branches —
 * one branch's write would clobber another's.
 *
 * Use these helpers when defining `Annotation({ reducer: ... })` for any
 * field that may be written concurrently by parallel nodes.
 */

/**
 * Concatenate arrays from parallel writes. Both writes preserved.
 * Use for: lists of artifacts, log lines, error collections.
 */
export const concatArray = (a, b) => {
  const left = Array.isArray(a) ? a : (a == null ? [] : [a]);
  const right = Array.isArray(b) ? b : (b == null ? [] : [b]);
  return [...left, ...right];
};

/**
 * Shallow-merge objects from parallel writes. Right wins on key collision.
 * Use for: keyed artifact maps (e.g. `pmdDocs`), where each branch sets a different key.
 */
export const mergeObject = (a, b) => {
  return { ...(a || {}), ...(b || {}) };
};

/**
 * Deep-merge objects (one level deep). Use sparingly — usually mergeObject is enough.
 */
export const deepMergeOneLevel = (a, b) => {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && a && typeof a[k] === "object") {
      out[k] = { ...a[k], ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
};

/**
 * Last-write-wins (the LangGraph default). Explicit re-export so call sites
 * make the choice visible.
 */
export const lastWriteWins = (a, b) => (b ?? a);

/**
 * First-write-wins. Useful when one parallel branch should claim the field
 * (e.g. an error code from whichever branch failed first).
 */
export const firstWriteWins = (a, b) => (a ?? b);

/**
 * Sum numeric values from parallel writes.
 * Use for: cost_usd accumulation, latency_ms aggregation.
 */
export const sumNumbers = (a, b) => {
  const left = typeof a === "number" ? a : 0;
  const right = typeof b === "number" ? b : 0;
  return left + right;
};

/**
 * Track which parallel branches have completed.
 * Pass an Array of branch names; reducer concatenates and dedupes.
 */
export const dedupeBranchSet = (a, b) => {
  const all = new Set([...(a || []), ...(b || [])]);
  return [...all];
};
