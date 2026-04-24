# Phase 18 — Lessons Learned

Phase 18-A closed: 2026-04-24. Duration: single session (the fourth A-tier close in two days — with 15-A, 16-A, 17-A).

## What surprised us

1. **Catalogue-as-living-documentation worked first try.** Authoring 15 manifests in one file felt like more duplication than necessary at first, but the result is a single-file index of the entire factory's pluggable surface. Every capability tag, every feature flag, every phase provenance — one grep away. Smoke test (`testCatalogueSchemaCompliance`) ensures the catalogue can't drift from the schema. The cost of authoring was ~10 minutes; the ongoing documentation value is permanent.

2. **`minimalManifest` helper in the smoke test had a subtle bug.** First version hard-coded `factory: okFactory("test.minimal", "1.0.0")` in the defaults; when callers overrode `id` or `version`, the factory still returned the old values, installer rejected the mismatch, every install test broke. Fix was two lines: build the factory *after* applying overrides, using the merged id/version. Lesson: **default-value helpers that reference other default values must compose after merging**, not before. The smoke test caught this immediately (`install ok=true` assertion failed) — thanks to sharp assertions.

3. **9 categories turned out to be enough.** Worried we'd need category hierarchies or tags. Nope — flat list with explicit category-per-module is sufficient. Phase 3 (intake/Genovi) and Phase 4 (PMD producers) fit `intake` and `pmd_producer` cleanly; 18-B will author those manifests without category changes.

4. **`missing[]` typed payload is much better than a string error.** First draft had `error: "missing dependencies: module:foo, env:BAR"` — a human-readable concatenation. Refactored to `missing: [{kind, detail}, ...]` so a UI can render per-dependency (e.g., "❌ env var ELEVENLABS_API_KEY missing — set it in Key Console"). Tiny change, large UX win for 18-B admin UI work.

## What to do differently

1. **Version handling is minimal today.** `isValidSemver` just rejects non-semver strings. No range matching, no compatibility checks. 18-B needs `satisfies(version, range)` (can reuse npm's `semver` lib or implement a minimal subset). Today if two modules both declare `registries: ["training-videos.tts"]`, we don't check their versions are compatible. Not an issue yet — built-in versions are all `1.0.0-alpha`.

2. **Dependency graph is implicit in `BUILTIN_MANIFESTS` order.** 18-A installs them in the array order, which happens to be topologically sorted (Phase 5 before Phase 6, etc.). If a future built-in declares a module dep on a later entry, install would fail. 18-B should do topological sort from the declared `modules` deps before installing.

3. **`setStatus` is present but unused in 18-A.** Future work: `disable` a module without uninstalling (e.g., a suspicious 3rd-party module gets temporarily quarantined). Today only `installed` → `uninstall` is exercised. `setStatus` will matter when the admin UI lands (18-B).

4. **`manifests.jsonl` serialisation strips function refs** — necessary, but worth calling out. A factory closure in memory might close over configuration that isn't in the manifest. Boot-time install (18-B) must reconstruct from catalogue source, which means every module has to be available at boot (either as a built-in or as an installed npm/git dep). Remote loading adds complexity.

## What feeds next phases

### Phase 18-B (deferred) — distribution + ops
- **Remote fetch** — load manifests from hosted URL; dynamic import of the factory function; caching
- **Signature verification** — sodium/sigstore/GPG; installer refuses unsigned manifests (configurable severity)
- **Version resolution** — implement or import `satisfies(version, range)`; conflict detection across shared registries
- **Live swap** — `swap(oldId, newManifest)` atomic: install new → verify → redirect registry → uninstall old; rollback on failure
- **Publisher tooling** — `agentryx pack <module-dir>` CLI → distributable bundle (manifest.json + factory.js + signature)
- **Phase 12-B admin UI** — React module-list page; install dialog; uninstall confirm; audit log viewer
- **Boot-time install** — factory startup reads `configs/enabled_modules.json`; calls `installAllBuiltins` + enabled external modules
- **Phase 3 + Phase 4 catalogue entries** — Genovi (intake category) + PMD agents (pmd_producer category)

### Phase 15 (self-improvement) — module-aware proposals
- New proposal kind `module_swap` — propose `training-videos.tts-stub-pack` → `training-videos.tts-elevenlabs-real` based on observed cost/quality deltas from Phase 11-A rollup
- Applier extension: resolve target module id → call `swap(oldId, newManifest)` from marketplace

### Phase 12 (admin substrate) — gains a 3rd axis
- Today catalogs: configs + feature flags (2 axes). Add: installed modules (3rd axis) — unified query surface for operators. Admin UI (12-B) renders all three.

### Phase 11 (cost tracker) — per-module attribution
- Manifests carry `capabilities`; cost-tracker rollups can attribute spend per module (not just per kind). Opens the door to "which module is costing me what?" dashboards.

### Phase 14 (concurrency) — dynamic handler registration
- 14-B handler registration becomes "install a handler module via marketplace". Each handler becomes a first-class installable; removing it = uninstall.

## Stats

- **1 session** (shared arc with 15-A / 16-A / 17-A; four A-tier phases closed in two days)
- **$0.00 spent** (template / stub modules only; D165)
- **0 new dependencies** (node built-ins only)
- **7 files created** in `cognitive-engine/marketplace/`: `types.js`, `store.js`, `installer.js`, `catalogue.js`, `pipeline.js`, `smoke-test.js`, `README.md`
- **2 files modified**: `admin-substrate/registry.js` (+1 flag = 12 total), `admin-substrate/smoke-test.js` (11 → 12 counts)
- **0 files modified** in: graph files, `tools.js`, `telemetry.mjs`, training-videos (17-A), training-gen (16-A), self-improvement (15-A), concurrency, replay, artifacts, memory-layer, cost-tracker, courier, verify-integration, parallel, mcp
- **4 phase docs**: Plan (expanded), Status, Decisions, Lessons
- **7 Decisions**: D159-D165

## Phase 18-A exit criteria — met

- ✅ `marketplace/` scaffolded (types, store, installer, catalogue, pipeline, smoke-test, README)
- ✅ Manifest schema covers all 15 existing A-tier scaffolds; each manifest shape-valid per the installer's validator
- ✅ Built-in catalogue installs cleanly; every id queryable by category + capability; overview() returns grouped stats
- ✅ Dependency resolution catches missing modules / env / registries with typed `missing[]` payload
- ✅ Factory exceptions + bad returns (wrong id / bad status / non-object) caught; each case audited; store unchanged on failure
- ✅ Uninstall hook path: called on success; missing id returns ok=false; throwing hook keeps module installed
- ✅ Audit log JSONL records install / install_failed / uninstall / status_change
- ✅ **117 smoke-test assertions all pass**
- ✅ Admin-substrate smoke green at 41 assertions after flag add
- ✅ `USE_MODULE_MARKETPLACE` flag registered with correct owning phase (Phase 18)
- ✅ $0 cost (D165) — no LLM calls in 18-A
- ✅ Zero changes outside `marketplace/` + admin-substrate flag registration
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 18-B remote fetch + UI + boot-install + live swap deferred

Phase 18-A is **wired, tested, and ready**. Substrate is firm — 18-B brings distribution + ops flow.
