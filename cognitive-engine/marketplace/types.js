/**
 * Marketplace — types for the pipeline-module install/query/uninstall API.
 *
 * The marketplace is the meta-registry that wraps the per-category DI
 * registries across Phases 9/13/14/15/16/17. A ModuleManifest describes an
 * installable module; `installer.install(manifest, ctx)` validates it,
 * resolves dependencies, and invokes the manifest's factory. The factory
 * registers whatever it needs with the downstream DI registry and returns
 * metadata the store records.
 *
 * D159: marketplace wraps, never replaces, existing registries.
 * D160: module ids are dotted two-segment namespaces.
 * D161: manifests carry factory functions directly (no code strings).
 */

/**
 * @typedef {"intake"|"pmd_producer"|"mcp_tool"|"artifact_store"|"memory_backend"|"handler"|"proposer"|"generator"|"provider"} ModuleCategory
 */

/**
 * @typedef {"installed"|"disabled"|"failed"} ModuleStatus
 *
 * - installed: factory ran successfully; module is live
 * - disabled:  administrator explicitly disabled; not routed to
 * - failed:    factory threw; kept in the store as a record of the attempt
 */

/**
 * @typedef {Object} ModuleDependencies
 * @property {string[]} [modules]       ids of other modules required (installed before this one)
 * @property {string[]} [env]           env var names that must be defined and non-empty
 * @property {string[]} [registries]    downstream registry ids this module needs to register with
 */

/**
 * @typedef {Object} InstallContext
 * @property {Record<string, any>} [registries]    downstream registries keyed by `registries` dependency name
 * @property {Record<string, string>} [env]        env var snapshot; falls back to process.env
 * @property {(moduleId: string) => ModuleManifest | null} [resolveDependency]  installed-module lookup
 * @property {Record<string, any>} [services]      optional extra DI services
 */

/**
 * @typedef {Object} InstalledModule
 * @property {string} id
 * @property {string} version
 * @property {ModuleStatus} status
 * @property {Record<string, any>} [metadata]      what the factory registered (provider ids, handler kinds, …)
 */

/**
 * @typedef {Object} ModuleManifest
 * @property {string} id                         e.g. "training-videos.tts-elevenlabs"
 * @property {string} name                       human label
 * @property {string} version                    semver (e.g. "1.0.0-alpha")
 * @property {ModuleCategory} category
 * @property {string[]} capabilities             free-form tags
 * @property {string} owning_phase               e.g. "Phase 17"
 * @property {string} [description]
 * @property {string} [author]                   default "agentryx-core"
 * @property {ModuleDependencies} [dependencies]
 * @property {string[]} [config_entries]         Phase 12-A config ids
 * @property {string} [feature_flag]             e.g. "USE_TRAINING_VIDEOS"
 * @property {(ctx: InstallContext) => Promise<InstalledModule> | InstalledModule} factory
 * @property {(instance: InstalledModule, ctx?: InstallContext) => Promise<void> | void} [uninstall]
 */

/**
 * @typedef {Object} InstallResult
 * @property {boolean} ok
 * @property {string} id
 * @property {InstalledModule} [instance]
 * @property {string} [error]
 * @property {{kind: string, detail: string}[]} [missing]  dependency validation detail
 */

export const SCHEMA_VERSION = 1;

export const MODULE_CATEGORIES = Object.freeze([
  "intake", "pmd_producer", "mcp_tool", "artifact_store",
  "memory_backend", "handler", "proposer", "generator", "provider",
]);

export const MODULE_STATUSES = Object.freeze(["installed", "disabled", "failed"]);

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const ID_RE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;

export function isValidCategory(c) { return MODULE_CATEGORIES.includes(c); }
export function isValidStatus(s) { return MODULE_STATUSES.includes(s); }
export function isValidSemver(v) { return typeof v === "string" && SEMVER_RE.test(v); }
export function isValidModuleId(id) { return typeof id === "string" && ID_RE.test(id); }

export function nowIso() { return new Date().toISOString(); }
