import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
  SCHEMA_VERSION, MODULE_CATEGORIES, MODULE_STATUSES,
  isValidCategory, isValidStatus, isValidSemver, isValidModuleId,
} from "./types.js";
import { createMarketplaceStore } from "./store.js";
import {
  validateManifestShape, validateDependencies,
  installModule, uninstallModule,
} from "./installer.js";
import { BUILTIN_MANIFESTS, getBuiltinManifest } from "./catalogue.js";
import {
  installAllBuiltins, listInstalled, queryCapabilities, resolveById, overview,
} from "./pipeline.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

async function setupTmpRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "marketplace-"));
}

function okFactory(id, version, metadata = {}) {
  return () => ({ id, version, status: "installed", metadata });
}

function minimalManifest(overrides = {}) {
  const merged = {
    id: "test.minimal",
    name: "Test minimal",
    version: "1.0.0",
    category: "generator",
    capabilities: ["test"],
    owning_phase: "Phase Test",
    ...overrides,
  };
  if (!merged.factory) merged.factory = okFactory(merged.id, merged.version);
  return merged;
}

// ---------------------------------------------------------------------------
async function testTypes() {
  console.log("[types]");
  assert(SCHEMA_VERSION === 1, "schema_version is 1");
  assert(MODULE_CATEGORIES.length === 9, "9 module categories");
  assert(MODULE_STATUSES.length === 3, "3 module statuses");
  assert(isValidCategory("provider"), "provider is valid category");
  assert(!isValidCategory("plugin"), "plugin is not a valid category");
  assert(isValidStatus("installed") && isValidStatus("failed"), "installed/failed are valid statuses");
  assert(!isValidStatus("broken"), "broken is not a valid status");
  assert(isValidSemver("1.0.0-alpha"), "1.0.0-alpha is valid semver");
  assert(!isValidSemver("not-a-version"), "invalid semver rejected");
  assert(isValidModuleId("training-videos.tts-stub"), "dotted id accepted");
  assert(!isValidModuleId("bare"), "single-segment id rejected");
  assert(!isValidModuleId("UPPER.case"), "uppercase rejected");
}

// ---------------------------------------------------------------------------
async function testStoreBasics() {
  console.log("[store basics — record / list / stats / uninstall]");
  const root = await setupTmpRoot();
  try {
    const store = createMarketplaceStore(root);
    const manifestA = minimalManifest({ id: "alpha.one", category: "provider" });
    const manifestB = minimalManifest({ id: "beta.two", category: "generator" });

    await store.recordInstall(manifestA, { id: manifestA.id, version: "1.0.0", status: "installed", metadata: { foo: 1 } });
    await store.recordInstall(manifestB, { id: manifestB.id, version: "1.0.0", status: "installed" });

    assert(store.has("alpha.one"), "store.has returns true for installed module");
    assert(!store.has("gamma.three"), "store.has returns false for unknown module");

    const all = store.list();
    assert(all.length === 2, "list returns 2");
    assert(all[0].manifest.id === "alpha.one" && all[1].manifest.id === "beta.two", "list sorted by id");

    const providers = store.list({ category: "provider" });
    assert(providers.length === 1 && providers[0].manifest.id === "alpha.one", "category filter works");

    const ids = store.listIds("generator");
    assert(ids.length === 1 && ids[0] === "beta.two", "listIds per category");

    const stats = store.stats();
    assert(stats.total === 2, "stats.total=2");
    assert(stats.by_category.provider === 1 && stats.by_category.generator === 1, "stats by_category");
    assert(stats.by_status.installed === 2, "stats by_status.installed=2");

    await store.uninstall("alpha.one");
    assert(!store.has("alpha.one"), "uninstall removes from store");
    assert(store.list().length === 1, "list reflects uninstall");

    // Double-install should throw
    try {
      await store.recordInstall(manifestB, { id: "beta.two", version: "1.0.0", status: "installed" });
      throw new Error("should have thrown");
    } catch (e) { assert(/already installed/.test(e.message), "duplicate install rejected"); }

    // Bad status / bad category
    try {
      await store.recordInstall(minimalManifest({ id: "bad.cat", category: "nonsense" }), { id: "bad.cat", version: "1.0.0", status: "installed" });
      throw new Error("should have thrown");
    } catch (e) { assert(/invalid category/.test(e.message), "invalid category rejected at store"); }

    try {
      await store.recordInstall(minimalManifest({ id: "bad.status" }), { id: "bad.status", version: "1.0.0", status: "bogus" });
      throw new Error("should have thrown");
    } catch (e) { assert(/ModuleStatus/.test(e.message), "invalid status rejected at store"); }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testStoreAudit() {
  console.log("[store audit log]");
  const root = await setupTmpRoot();
  try {
    const store = createMarketplaceStore(root);
    const manifest = minimalManifest({ id: "audit.one" });
    await store.recordInstall(manifest, { id: "audit.one", version: "1.0.0", status: "installed" });
    await store.setStatus("audit.one", "disabled");
    await store.uninstall("audit.one");

    const audit = await store.readAudit({});
    assert(audit.length === 3, `3 audit events (got ${audit.length})`);
    assert(audit[0].action === "uninstall", "newest is uninstall");
    assert(audit[2].action === "install", "oldest is install");

    const installs = await store.readAudit({ action: "install" });
    assert(installs.length === 1, "filter by action works");

    const forId = await store.readAudit({ id: "audit.one" });
    assert(forId.length === 3, "filter by id works");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function testManifestShapeValidation() {
  console.log("[manifest shape validation]");
  assert(validateManifestShape(null).length > 0, "null manifest rejected");
  assert(validateManifestShape("string").length > 0, "string manifest rejected");

  const good = minimalManifest();
  assert(validateManifestShape(good).length === 0, "minimal manifest valid");

  const badId = validateManifestShape(minimalManifest({ id: "BARE" }));
  assert(badId.some(e => /id/.test(e)), "bad id flagged");

  const badVersion = validateManifestShape(minimalManifest({ version: "not-semver" }));
  assert(badVersion.some(e => /version/.test(e)), "bad version flagged");

  const badCategory = validateManifestShape(minimalManifest({ category: "nonsense" }));
  assert(badCategory.some(e => /category/.test(e)), "bad category flagged");

  const missingName = minimalManifest();
  delete missingName.name;
  const nameErr = validateManifestShape(missingName);
  assert(nameErr.some(e => /name/.test(e)), "missing name flagged");

  const missingFactory = minimalManifest();
  delete missingFactory.factory;
  const fErr = validateManifestShape(missingFactory);
  assert(fErr.some(e => /factory/.test(e)), "missing factory flagged");

  const badUninstall = minimalManifest({ uninstall: "not a function" });
  const uErr = validateManifestShape(badUninstall);
  assert(uErr.some(e => /uninstall/.test(e)), "bad uninstall type flagged");
}

async function testDependencyValidation() {
  console.log("[dependency validation]");
  const root = await setupTmpRoot();
  try {
    const store = createMarketplaceStore(root);
    await store.recordInstall(minimalManifest({ id: "dep.base" }), { id: "dep.base", version: "1.0.0", status: "installed" });

    // Module dep present
    const okManifest = minimalManifest({
      id: "consumer.a",
      dependencies: { modules: ["dep.base"] },
      factory: okFactory("consumer.a", "1.0.0"),
    });
    const missing1 = validateDependencies(okManifest, {}, store);
    assert(missing1.length === 0, "module dep satisfied");

    // Module dep missing
    const missingManifest = minimalManifest({
      id: "consumer.b",
      dependencies: { modules: ["nonexistent.module"] },
    });
    const missing2 = validateDependencies(missingManifest, {}, store);
    assert(missing2.length === 1 && missing2[0].kind === "module", "module dep missing detected");

    // Env dep — pass via ctx.env
    const envManifest = minimalManifest({
      id: "consumer.c",
      dependencies: { env: ["MY_KEY"] },
    });
    const missing3 = validateDependencies(envManifest, { env: {} }, store);
    assert(missing3.length === 1 && missing3[0].kind === "env" && missing3[0].detail === "MY_KEY", "missing env flagged");
    const missing4 = validateDependencies(envManifest, { env: { MY_KEY: "x" } }, store);
    assert(missing4.length === 0, "env present accepted");

    // Registry dep
    const regManifest = minimalManifest({
      id: "consumer.d",
      dependencies: { registries: ["training-videos.tts"] },
    });
    const missing5 = validateDependencies(regManifest, { registries: {} }, store);
    assert(missing5.length === 1 && missing5[0].kind === "registry", "missing registry flagged");
    const missing6 = validateDependencies(regManifest, { registries: { "training-videos.tts": {} } }, store);
    assert(missing6.length === 0, "present registry accepted");

    // Multiple deps, some missing
    const mixedManifest = minimalManifest({
      id: "consumer.e",
      dependencies: { modules: ["dep.base", "nope.x"], env: ["KEY1", "KEY2"], registries: ["r1"] },
    });
    const missing7 = validateDependencies(mixedManifest, { env: { KEY1: "x" }, registries: {} }, store);
    assert(missing7.length === 3, `3 missing across kinds (got ${missing7.length})`);
    const kinds = missing7.map(m => m.kind).sort();
    assert(kinds.includes("module") && kinds.includes("env") && kinds.includes("registry"), "all missing kinds represented");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function testInstallerHappyPath() {
  console.log("[installer happy path + idempotency]");
  const root = await setupTmpRoot();
  try {
    const store = createMarketplaceStore(root);
    const manifest = minimalManifest({ id: "install.happy", version: "1.2.3" });

    const res = await installModule(manifest, {}, store);
    assert(res.ok, "install ok=true");
    assert(res.instance.id === "install.happy", "instance.id correct");
    assert(res.instance.version === "1.2.3", "version echoed");
    assert(store.has("install.happy"), "store has module after install");

    // Re-install → fails
    const res2 = await installModule(manifest, {}, store);
    assert(!res2.ok, "re-install rejected");
    assert(/already installed/.test(res2.error), "error names duplicate");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testInstallerShapeFailure() {
  console.log("[installer shape failure records audit but not in store]");
  const root = await setupTmpRoot();
  try {
    const store = createMarketplaceStore(root);
    const badManifest = { ...minimalManifest(), version: "garbage" };
    const res = await installModule(badManifest, {}, store);
    assert(!res.ok, "shape-bad install ok=false");
    assert(!store.has(badManifest.id), "store unchanged");
    const audit = await store.readAudit({ action: "install_failed" });
    assert(audit.length === 1, "install_failed audit entry written");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testInstallerDependencyFailure() {
  console.log("[installer dep failure emits missing[]]");
  const root = await setupTmpRoot();
  try {
    const store = createMarketplaceStore(root);
    const manifest = minimalManifest({
      id: "dep.fail",
      dependencies: { modules: ["nope.x"], env: ["MUST_HAVE"] },
    });
    const res = await installModule(manifest, { env: {} }, store);
    assert(!res.ok, "deps missing → ok=false");
    assert(Array.isArray(res.missing) && res.missing.length === 2, "missing[] length=2");
    assert(!store.has("dep.fail"), "not installed");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testInstallerFactoryFailure() {
  console.log("[installer factory exceptions + bad returns]");
  const root = await setupTmpRoot();
  try {
    const store = createMarketplaceStore(root);

    const throwing = minimalManifest({ id: "fac.throw", factory: () => { throw new Error("boom"); } });
    const r1 = await installModule(throwing, {}, store);
    assert(!r1.ok, "throwing factory → ok=false");
    assert(/boom/.test(r1.error), "error propagated");

    const wrongId = minimalManifest({ id: "fac.wrong-id", factory: () => ({ id: "other", version: "1.0.0", status: "installed" }) });
    const r2 = await installModule(wrongId, {}, store);
    assert(!r2.ok, "wrong-id factory → ok=false");
    assert(/instance\.id/.test(r2.error), "error names mismatch");

    const wrongStatus = minimalManifest({ id: "fac.wrong-status", factory: () => ({ id: "fac.wrong-status", version: "1.0.0", status: "bogus" }) });
    const r3 = await installModule(wrongStatus, {}, store);
    assert(!r3.ok, "invalid status factory → ok=false");

    const missingVersion = minimalManifest({
      id: "fac.missing-version",
      version: "1.0.0",
      factory: () => ({ id: "fac.missing-version", status: "installed" }),   // no version field
    });
    const r4 = await installModule(missingVersion, {}, store);
    assert(r4.ok, "missing version auto-filled from manifest");
    assert(store.get("fac.missing-version").instance.version === "1.0.0", "version backfilled from manifest");

    const nonObject = minimalManifest({ id: "fac.nonobject", factory: () => "not an object" });
    const r5 = await installModule(nonObject, {}, store);
    assert(!r5.ok && /non-object/.test(r5.error), "non-object factory return rejected");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testUninstallHook() {
  console.log("[uninstall hook + missing module]");
  const root = await setupTmpRoot();
  try {
    const store = createMarketplaceStore(root);
    let cleanup = 0;
    const manifest = minimalManifest({
      id: "hook.one",
      factory: okFactory("hook.one", "1.0.0"),
      uninstall: () => { cleanup += 1; },
    });
    await installModule(manifest, {}, store);
    const r = await uninstallModule("hook.one", store, {});
    assert(r.ok, "uninstall ok");
    assert(cleanup === 1, "uninstall hook invoked");

    const missing = await uninstallModule("nope.none", store);
    assert(!missing.ok, "missing module uninstall ok=false");

    // Hook throws → audit records + keeps in store
    const throwing = minimalManifest({
      id: "hook.throws",
      factory: okFactory("hook.throws", "1.0.0"),
      uninstall: () => { throw new Error("cleanup-failed"); },
    });
    await installModule(throwing, {}, store);
    const tr = await uninstallModule("hook.throws", store);
    assert(!tr.ok && /cleanup-failed/.test(tr.error), "throwing hook returns ok=false + error");
    assert(store.has("hook.throws"), "module remains installed after hook failure");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function testCatalogueSchemaCompliance() {
  console.log("[catalogue schema compliance — all 15 manifests valid]");
  assert(Array.isArray(BUILTIN_MANIFESTS) && BUILTIN_MANIFESTS.length === 15,
    `15 built-in manifests (got ${BUILTIN_MANIFESTS.length})`);

  for (const m of BUILTIN_MANIFESTS) {
    const errs = validateManifestShape(m);
    assert(errs.length === 0, `${m.id} manifest is shape-valid`);
  }

  // Unique ids
  const ids = BUILTIN_MANIFESTS.map(m => m.id);
  assert(new Set(ids).size === ids.length, "all manifest ids unique");

  // Catalogue lookup
  const found = getBuiltinManifest("training-videos.tts-stub-pack");
  assert(found && found.category === "provider", "getBuiltinManifest resolves tts-stub-pack");
  assert(getBuiltinManifest("nope.none") === null, "missing id returns null");

  // Category coverage
  const categoryCounts = {};
  for (const m of BUILTIN_MANIFESTS) categoryCounts[m.category] = (categoryCounts[m.category] || 0) + 1;
  assert(categoryCounts.provider === 3, "3 provider modules (Phase 17)");
  assert(categoryCounts.generator === 1, "1 generator module (Phase 16)");
  assert(categoryCounts.proposer === 1, "1 proposer module (Phase 15)");
  assert(categoryCounts.memory_backend === 1, "1 memory_backend (Phase 7)");
  assert(categoryCounts.artifact_store === 1, "1 artifact_store (Phase 6)");
  assert(categoryCounts.mcp_tool === 1, "1 mcp_tool (Phase 5)");
}

// ---------------------------------------------------------------------------
async function testInstallAllBuiltins() {
  console.log("[installAllBuiltins — full catalogue install]");
  const root = await setupTmpRoot();
  try {
    const store = createMarketplaceStore(root);
    const result = await installAllBuiltins({ store });
    assert(result.failed.length === 0, `no failed installs (got ${result.failed.length}: ${JSON.stringify(result.failed)})`);
    assert(result.installed.length === 15, "15 modules installed");

    // Overview
    const ov = overview(store);
    assert(ov.total === 15, "overview.total=15");
    assert(ov.by_category.provider === 3, "overview shows 3 providers");

    // Query by capability
    const voiceover = queryCapabilities(store, "voiceover_script");
    assert(voiceover.length === 1 && voiceover[0].manifest.id === "training-gen.template-generators",
      "voiceover_script capability resolves to training-gen generators");

    const ttsModules = queryCapabilities(store, "tts");
    assert(ttsModules.length === 1 && ttsModules[0].manifest.id === "training-videos.tts-stub-pack",
      "tts capability resolves to tts-stub-pack");

    // Resolve by id
    const heuristic = resolveById(store, "self-improvement.heuristic-proposer");
    assert(heuristic && heuristic.manifest.category === "proposer", "self-improvement proposer resolvable");

    // listInstalled with filters
    const providers = listInstalled(store, { category: "provider" });
    assert(providers.length === 3, "3 providers listed");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testInstallAllIdempotentOnRerun() {
  console.log("[installAllBuiltins — second run fails cleanly without breaking store]");
  const root = await setupTmpRoot();
  try {
    const store = createMarketplaceStore(root);
    await installAllBuiltins({ store });
    const result2 = await installAllBuiltins({ store });
    assert(result2.installed.length === 0, "second run: 0 newly installed");
    assert(result2.failed.length === 15, "second run: all 15 fail with 'already installed'");
    assert(result2.failed.every(f => /already installed/.test(f.error)), "all failures say 'already installed'");
    assert(store.stats().total === 15, "store still has 15 modules intact");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
async function testAllCategoriesCovered() {
  console.log("[catalogue — categories touched by at least one built-in]");
  const touched = new Set(BUILTIN_MANIFESTS.map(m => m.category));
  // 18-A catalogue intentionally excludes intake and pmd_producer (they're covered by
  // existing Phase 3/4 code outside marketplace; 18-B will add them). All other 7 must be present.
  for (const cat of ["mcp_tool","artifact_store","memory_backend","handler","proposer","generator","provider"]) {
    assert(touched.has(cat), `category "${cat}" has at least one built-in module`);
  }
}

// ---------------------------------------------------------------------------
async function main() {
  try {
    await testTypes();                           console.log("");
    await testStoreBasics();                     console.log("");
    await testStoreAudit();                      console.log("");
    await testManifestShapeValidation();         console.log("");
    await testDependencyValidation();            console.log("");
    await testInstallerHappyPath();              console.log("");
    await testInstallerShapeFailure();           console.log("");
    await testInstallerDependencyFailure();      console.log("");
    await testInstallerFactoryFailure();         console.log("");
    await testUninstallHook();                   console.log("");
    await testCatalogueSchemaCompliance();       console.log("");
    await testInstallAllBuiltins();              console.log("");
    await testInstallAllIdempotentOnRerun();     console.log("");
    await testAllCategoriesCovered();
    console.log("\n[smoke] OK");
  } catch (e) {
    console.error(`\n[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
