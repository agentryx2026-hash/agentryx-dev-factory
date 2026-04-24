# Phase 18 — Status: 18-A COMPLETE ✅  (18-B DEFERRED)

**Phase started**: 2026-04-24
**Phase 18-A closed**: 2026-04-24
**Duration**: single session (same arc as 15-A / 16-A / 17-A; fourth A-tier module in two days)

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 18-A.1 | `marketplace/types.js` — ModuleManifest, ModuleCategory (9), ModuleStatus (3), ModuleDependencies, InstallResult + validators | ✅ done |
| 18-A.2 | `marketplace/store.js` — registry with per-category index + atomic manifests.jsonl + append-only audit.jsonl | ✅ done |
| 18-A.3 | `marketplace/installer.js` — manifest shape validation, dependency resolution (module / env / registry), strict factory return checks | ✅ done |
| 18-A.4 | `marketplace/catalogue.js` — 15 built-in manifests covering Phases 5-A through 17-A | ✅ done |
| 18-A.5 | `marketplace/pipeline.js` — installAllBuiltins + installModule + uninstallModule + listInstalled + queryCapabilities + overview | ✅ done |
| 18-A.6 | Smoke test — 117 assertions across 14 test groups | ✅ done — all pass |
| 18-A.7 | `marketplace/README.md` + `USE_MODULE_MARKETPLACE` flag registered in admin-substrate | ✅ done |
| 18-B | Remote fetch + signature verification + version resolution + live swap + admin UI + boot-time install | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/marketplace/types.js` (new, ~95 lines)
- `ModuleManifest`, `InstalledModule`, `ModuleCategory` (9), `ModuleStatus` (3), `ModuleDependencies`, `InstallContext`, `InstallResult`
- Validators: `isValidCategory`, `isValidStatus`, `isValidSemver`, `isValidModuleId`
- ID regex: `^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$` — enforces two-segment dotted namespace

### `cognitive-engine/marketplace/store.js` (new, ~190 lines)
- `createMarketplaceStore(rootDir)` — returns `{recordInstall, recordFailedInstall, uninstall, setStatus, get, has, list, listIds, readAudit, stats, _reset, schema_version}`
- Per-category in-memory index (`byCategory: Map<category, Set<id>>`) for fast filtered listing
- Atomic `manifests.jsonl` write (temp + rename); append-only `audit.jsonl`
- List filters: `category`, `status`, `capability`
- Stats: `total`, `by_category`, `by_status`
- Duplicate-install + invalid-category + invalid-status all rejected

### `cognitive-engine/marketplace/installer.js` (new, ~125 lines)
- `validateManifestShape(manifest)` → `string[]` — 8 shape checks (null / id / version / category / name / factory / uninstall type / capabilities array)
- `validateDependencies(manifest, ctx, store)` → `{kind, detail}[]` — modules / env / registries all covered
- `installModule(manifest, ctx, store)` → `InstallResult`:
  - shape errors → `install_failed` audit + `{ok: false, error}`
  - missing deps → `install_failed` audit + `{ok: false, error, missing: [...]}`
  - factory throws → `install_failed` audit + `{ok: false, error}`
  - factory returns non-object / wrong id / invalid status → `install_failed` audit + `{ok: false, error}`
  - factory missing version → auto-filled from manifest
  - success → `recordInstall` + `{ok: true, instance}`
- `uninstallModule(id, store, ctx)` — invokes manifest `uninstall` hook if present; throwing hook returns `{ok: false}` and leaves module installed

### `cognitive-engine/marketplace/catalogue.js` (new, ~200 lines)
- 15 built-in manifests:
  - **Phase 5** (mcp_tool): `mcp.bridge-builtin`
  - **Phase 6** (artifact_store): `artifacts.filesystem-store`
  - **Phase 7** (memory_backend): `memory-layer.filesystem-backend`
  - **Phase 8** (handler): `parallel.fanout-reducers`
  - **Phase 9** (handler): `verify-integration.mock-client`
  - **Phase 10** (handler): `courier.fake-backend`
  - **Phase 11** (handler): `cost-tracker.rollup-lib`
  - **Phase 12** (handler): `admin-substrate.config-roles-audit`
  - **Phase 13** (handler): `replay.executor-substrate`
  - **Phase 14** (handler): `concurrency.fs-queue`
  - **Phase 15** (proposer): `self-improvement.heuristic-proposer`
  - **Phase 16** (generator): `training-gen.template-generators`
  - **Phase 17** (provider ×3): `training-videos.tts-stub-pack`, `training-videos.capture-stub-pack`, `training-videos.stitcher-stub-pack`
- All built-ins use `version: "1.0.0-alpha"` and `author: "agentryx-core"`
- `getBuiltinManifest(id)` lookup helper
- Phase 3 (intake/genovi) and Phase 4 (pmd_producer) intentionally excluded from 18-A catalogue — their factory wiring needs bigger surface; 18-B will add them

### `cognitive-engine/marketplace/pipeline.js` (new, ~65 lines)
- `installAllBuiltins({store, ctx})` — walks `BUILTIN_MANIFESTS`, installs each, collects `{installed: [], failed: []}`; continues on per-module failure
- `installModule(manifest, ctx, store)` — single-module install (re-exports installer)
- `uninstallModule(id, store, ctx)`
- `listInstalled(store, filter)`, `queryCapabilities(store, capability)`, `resolveById(store, id)`
- `overview(store)` — grouped admin view: `{total, by_category, by_status, ids_by_category}`

### `cognitive-engine/marketplace/smoke-test.js` (new, ~480 lines)
- **117 assertions across 14 test groups**:
  - types (13) — category / status / semver / id validators
  - store basics (14) — record / list / stats / listIds / uninstall / validation
  - store audit log (5) — 3 events; filter by action + id
  - manifest shape validation (9) — null / bad id/version/category / missing name/factory / bad uninstall
  - dependency validation (8) — module / env / registry each covered + mixed
  - installer happy path + idempotency (5)
  - installer shape failure (3) — audit written; store unchanged
  - installer dep failure (3) — `missing[]` typed payload
  - installer factory failure (8) — throws / wrong-id / bad status / missing-version auto-fill / non-object return
  - uninstall hook (4) — hook called; missing module; hook throws → stays installed
  - catalogue schema compliance (24) — 15 manifests shape-valid; unique ids; category coverage counts
  - installAllBuiltins (8) — 15 installed; overview; queryCapabilities; listInstalled
  - second-run idempotency (4) — all 15 rejected with 'already installed'; store intact
  - category coverage (7) — 7 of 9 categories touched; intake + pmd_producer out of 18-A scope

### `cognitive-engine/marketplace/README.md` (new)
- Status, layout, category table, manifest schema, API, dependency table, smoke summary, decisions, 18-B/18-C preview

### `cognitive-engine/admin-substrate/registry.js` (modified)
- Added `USE_MODULE_MARKETPLACE` feature flag (12 total now)
- Admin smoke test updated (11 → 12) — 41 assertions still pass

### Unchanged
- Graph files, `tools.js`, `telemetry.mjs`
- All prior A-tier modules: training-videos (17-A), training-gen (16-A), self-improvement (15-A), concurrency (14-A), replay (13-A), admin-substrate core (12-A), cost-tracker (11-A), courier (10-A), verify-integration (9-A), parallel (8-A), memory-layer (7-A), artifacts (6-A), mcp (5-A)
- Zero regression risk

## Smoke test highlight

```
[installAllBuiltins — full catalogue install]
  ✓ no failed installs (got 0: [])
  ✓ 15 modules installed
  ✓ overview.total=15
  ✓ overview shows 3 providers
  ✓ voiceover_script capability resolves to training-gen generators
  ✓ tts capability resolves to tts-stub-pack
  ✓ self-improvement proposer resolvable
  ✓ 3 providers listed

[smoke] OK  — 117 assertions
```

## Why 18-B deferred

18-B = **remote distribution + admin UI**. Requires:

- **Remote fetch** — hosted registry contract (could be GitHub raw, npm-style, or bespoke); manifest loader; caching
- **Signature verification** — publishers sign manifests; installer refuses unsigned
- **Version resolution** — semver range matching (`foo.bar@^1.0.0`); conflict detection when multiple modules declare same downstream registry
- **Live swap** — atomic uninstall-old + install-new with rollback on failure
- **Publisher tooling** — CLI to `pack` a module directory into distributable manifest+factory bundle
- **Phase 12-B admin UI** — React browse / install / uninstall / view audit log
- **Boot-time install** — `configs/enabled_modules.json` read on factory startup; `installAllBuiltins` + enabled external modules
- **Phase 3 + Phase 4 catalogue entries** — Genovi (intake) + PMD agents (pmd_producer); require bigger wiring surface

Ship 18-A as firm substrate; 18-B layers distribution on a tested contract.

## Feature-flag posture

| Flag | Default | Effect |
|---|---|---|
| (existing 11 flags ...) | off | Phases 4-17 |
| `USE_MODULE_MARKETPLACE` | off | Phase 18-B onwards: factory boot calls installAllBuiltins; 18-A library only |

## Phase 18-A exit criteria — met

- ✅ `marketplace/` scaffolded (types, store, installer, catalogue, pipeline, smoke-test, README)
- ✅ Manifest schema covers all 15 existing A-tier scaffolds (catalogue is shape-valid per the same validator tests use)
- ✅ Built-in catalogue installs cleanly via `installAllBuiltins()`; every id is queryable by category + capability
- ✅ Dependency resolution catches missing modules / env vars / registries with typed `missing[]` payload
- ✅ Audit log records every install / uninstall / status_change / install_failed event
- ✅ Installer gracefully handles factory throws + wrong-id + bad-status + non-object returns; each case audited
- ✅ **117 smoke-test assertions all pass**
- ✅ Admin-substrate smoke still green at 41 assertions after flag add
- ✅ `USE_MODULE_MARKETPLACE` flag registered with correct owning phase
- ✅ $0 cost (D165) — no LLM calls, deterministic
- ✅ Zero changes outside `marketplace/` + admin-substrate flag registration
- ✅ Phase docs: Plan (expanded), Status, Decisions (D159-D165), Lessons
- ⏳ 18-B remote fetch + UI + boot-install + live swap deferred

Phase 18-A is **wired, tested, and ready**. Substrate is firm — 18-B brings distribution + ops flow.
