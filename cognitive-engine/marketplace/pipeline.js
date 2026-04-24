/**
 * Marketplace pipeline — high-level API that wires catalogue → installer → store.
 *
 * Thin orchestration layer: `installAllBuiltins()` walks `BUILTIN_MANIFESTS`
 * and installs each one, collecting results. `installModule(manifest, ctx)`
 * installs a single external manifest. `uninstallModule(id)` removes one.
 * Query helpers (`listInstalled`, `queryCapabilities`, `resolveById`) read
 * directly from the store.
 */

import { BUILTIN_MANIFESTS } from "./catalogue.js";
import { installModule as installOne, uninstallModule as uninstallOne } from "./installer.js";
import { MODULE_CATEGORIES } from "./types.js";

/**
 * Install every built-in manifest in order. Continues on individual failures.
 *
 * @returns {Promise<{installed: string[], failed: {id, error}[]}>}
 */
export async function installAllBuiltins({ store, ctx } = {}) {
  if (!store) throw new Error("pipeline: store required");
  const installed = [];
  const failed = [];
  for (const manifest of BUILTIN_MANIFESTS) {
    const result = await installOne(manifest, ctx, store);
    if (result.ok) installed.push(result.id);
    else failed.push({ id: manifest.id, error: result.error, missing: result.missing });
  }
  return { installed, failed };
}

export async function installModule(manifest, ctx, store) {
  return installOne(manifest, ctx, store);
}

export async function uninstallModule(id, store, ctx) {
  return uninstallOne(id, store, ctx);
}

/**
 * List installed modules with optional filters.
 */
export function listInstalled(store, filter = {}) {
  return store.list(filter);
}

/**
 * Find all modules that declare a specific capability tag.
 */
export function queryCapabilities(store, capability) {
  return store.list({ capability });
}

/**
 * Resolve by id. Returns `{ manifest, instance }` or null.
 */
export function resolveById(store, id) {
  return store.get(id);
}

/**
 * Grouped overview: categories × counts × module ids, useful for admin UI.
 */
export function overview(store) {
  const stats = store.stats();
  const groups = {};
  for (const cat of MODULE_CATEGORIES) {
    groups[cat] = store.listIds(cat);
  }
  return { total: stats.total, by_category: stats.by_category, by_status: stats.by_status, ids_by_category: groups };
}

export { BUILTIN_MANIFESTS };
