import {
  isValidCategory, isValidSemver, isValidModuleId, isValidStatus,
  MODULE_CATEGORIES,
} from "./types.js";

/**
 * Installer — validates a ModuleManifest, resolves dependencies, invokes
 * the factory, and records the result in the marketplace store.
 *
 * D162: dependencies are checked pre-install. If any module / env / registry
 * dependency is missing, install fails with a list of what's missing.
 *
 * Returns `InstallResult`:
 *   ok:true  — module installed; instance metadata attached
 *   ok:false — manifest invalid or dependencies missing; module NOT stored
 *              (a failure audit event is recorded so the attempt is visible)
 */

/**
 * Minimal shape check. Detailed dependency validation happens separately.
 */
export function validateManifestShape(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return ["manifest must be an object"];
  }
  if (!isValidModuleId(manifest.id)) {
    errors.push(`manifest.id must be a dotted lowercase namespace (got "${manifest.id}")`);
  }
  if (typeof manifest.name !== "string" || !manifest.name) {
    errors.push("manifest.name required");
  }
  if (!isValidSemver(manifest.version)) {
    errors.push(`manifest.version must be semver (got "${manifest.version}")`);
  }
  if (!isValidCategory(manifest.category)) {
    errors.push(`manifest.category must be one of: ${MODULE_CATEGORIES.join(", ")}`);
  }
  if (!Array.isArray(manifest.capabilities)) {
    errors.push("manifest.capabilities must be an array of strings");
  }
  if (typeof manifest.owning_phase !== "string" || !manifest.owning_phase) {
    errors.push("manifest.owning_phase required");
  }
  if (typeof manifest.factory !== "function") {
    errors.push("manifest.factory must be a function");
  }
  if (manifest.uninstall && typeof manifest.uninstall !== "function") {
    errors.push("manifest.uninstall, if present, must be a function");
  }
  return errors;
}

/**
 * Check that the manifest's declared dependencies are satisfied.
 * Returns `[{kind, detail}]` — empty array when all good.
 */
export function validateDependencies(manifest, ctx = {}, store = null) {
  const missing = [];
  const deps = manifest.dependencies || {};

  if (Array.isArray(deps.modules)) {
    for (const moduleId of deps.modules) {
      const present = Boolean(
        (ctx.resolveDependency && ctx.resolveDependency(moduleId)) ||
        (store && store.has(moduleId))
      );
      if (!present) missing.push({ kind: "module", detail: moduleId });
    }
  }

  if (Array.isArray(deps.env)) {
    const env = ctx.env || process.env || {};
    for (const key of deps.env) {
      if (!env[key]) missing.push({ kind: "env", detail: key });
    }
  }

  if (Array.isArray(deps.registries)) {
    const registries = ctx.registries || {};
    for (const name of deps.registries) {
      if (registries[name] == null) missing.push({ kind: "registry", detail: name });
    }
  }

  return missing;
}

/**
 * Install one module into the marketplace store.
 *
 * @param {import("./types.js").ModuleManifest} manifest
 * @param {import("./types.js").InstallContext} [ctx]
 * @param {ReturnType<typeof import("./store.js").createMarketplaceStore>} store
 * @returns {Promise<import("./types.js").InstallResult>}
 */
export async function installModule(manifest, ctx, store) {
  if (!store) throw new Error("installer: store is required");

  const shapeErrors = validateManifestShape(manifest);
  if (shapeErrors.length) {
    await store.recordFailedInstall(manifest, new Error(shapeErrors.join("; ")));
    return { ok: false, id: manifest?.id || "<unknown>", error: shapeErrors.join("; ") };
  }

  if (store.has(manifest.id)) {
    const err = `module ${manifest.id} already installed`;
    await store.recordFailedInstall(manifest, new Error(err));
    return { ok: false, id: manifest.id, error: err };
  }

  const missing = validateDependencies(manifest, ctx, store);
  if (missing.length) {
    const err = `unresolved dependencies: ${missing.map(m => `${m.kind}:${m.detail}`).join(", ")}`;
    await store.recordFailedInstall(manifest, new Error(err));
    return { ok: false, id: manifest.id, error: err, missing };
  }

  let instance;
  try {
    instance = await manifest.factory(ctx || {});
  } catch (err) {
    await store.recordFailedInstall(manifest, err);
    return { ok: false, id: manifest.id, error: err?.message || String(err) };
  }

  if (!instance || typeof instance !== "object") {
    const err = `factory returned non-object (${typeof instance})`;
    await store.recordFailedInstall(manifest, new Error(err));
    return { ok: false, id: manifest.id, error: err };
  }
  if (instance.id !== manifest.id) {
    const err = `factory returned instance.id "${instance.id}" != manifest.id "${manifest.id}"`;
    await store.recordFailedInstall(manifest, new Error(err));
    return { ok: false, id: manifest.id, error: err };
  }
  if (!isValidStatus(instance.status)) {
    const err = `factory returned invalid status "${instance.status}"`;
    await store.recordFailedInstall(manifest, new Error(err));
    return { ok: false, id: manifest.id, error: err };
  }
  if (instance.version !== manifest.version) {
    // Normalise — if the factory forgot to echo the version, copy it back.
    instance.version = manifest.version;
  }

  await store.recordInstall(manifest, instance);
  return { ok: true, id: manifest.id, instance };
}

/**
 * Uninstall a module by id. Calls the manifest's `uninstall` hook if present.
 */
export async function uninstallModule(id, store, ctx) {
  const entry = store.get(id);
  if (!entry) return { ok: false, id, error: `module ${id} not installed` };
  if (typeof entry.manifest.uninstall === "function") {
    try {
      await entry.manifest.uninstall(entry.instance, ctx);
    } catch (err) {
      await store.recordFailedInstall(entry.manifest, err);
      return { ok: false, id, error: `uninstall hook threw: ${err?.message || String(err)}` };
    }
  }
  await store.uninstall(id);
  return { ok: true, id };
}
