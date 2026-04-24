# Pipeline Module Marketplace (Phase 18-A)

Formalises the DI registry pattern that Phases 9/13/14/15/16/17 all rely on. Each factory module becomes a **versioned, manifest-described installable**. The marketplace wraps (does not replace) existing registries and provides a unified install / query / uninstall API. 18-A ships substrate + a built-in catalogue covering all 15 existing A-tier scaffolds (some Phase-17-A provider packs split into three manifests). 18-B adds remote fetch, publisher tooling, and admin UI.

## Status: Phase 18-A scaffolding

**117 smoke-test assertions pass.** Catalogue installs cleanly; per-category / per-capability queries work; dependency validation catches missing modules / env / registries; factory failures degrade gracefully with audit trail. Zero external API calls. $0 cost. No graph changes.

## Files

- `types.js` — ModuleManifest, ModuleCategory (9), ModuleStatus (3), ModuleDependencies, InstallContext, InstalledModule, InstallResult + validators
- `store.js` — marketplace registry: `recordInstall` / `recordFailedInstall` / `uninstall` / `setStatus` / `get` / `has` / `list` / `listIds` / `readAudit` / `stats`; atomic `manifests.jsonl` write; append-only `audit.jsonl`
- `installer.js` — `validateManifestShape`, `validateDependencies`, `installModule`, `uninstallModule`; factory wrapper with strict return-shape checks
- `catalogue.js` — 15 built-in manifests spanning Phases 5-A through 17-A
- `pipeline.js` — `installAllBuiltins`, `installModule`, `uninstallModule`, `listInstalled`, `queryCapabilities`, `resolveById`, `overview`
- `smoke-test.js` — 117 assertions across 14 test groups

## Layout

```
<workspace_root>/_marketplace/
  ├── manifests.jsonl    currently installed modules (one JSON line each; metadata only, no function refs)
  └── audit.jsonl        append-only install / uninstall / status_change / install_failed events
```

Factory closures live in memory only — they are NOT serialised. A store restored from disk holds only metadata; modules must be re-installed via their catalogue entry to bring factories back. That's the point: modules are *installable again* from their manifest source.

## Module categories (9)

| Category | Maps to | Examples (18-A built-ins) |
|---|---|---|
| `intake`         | Phase 3 Genovi                    | (external — not in 18-A catalogue) |
| `pmd_producer`   | Phase 4 PMD agents                | (external — not in 18-A catalogue) |
| `mcp_tool`       | Phase 5 MCP bridge                | `mcp.bridge-builtin` |
| `artifact_store` | Phase 6 artifact store            | `artifacts.filesystem-store` |
| `memory_backend` | Phase 7 memory backends           | `memory-layer.filesystem-backend` |
| `handler`        | Phase 8/9/10/11/12/13/14          | 7 built-ins (parallel, verify, courier, cost-tracker, admin, replay, concurrency) |
| `proposer`       | Phase 15 self-improvement         | `self-improvement.heuristic-proposer` |
| `generator`      | Phase 16 training gens            | `training-gen.template-generators` |
| `provider`       | Phase 17 TTS/capture/stitcher     | 3 stub packs (tts, capture, stitcher) |

## Manifest schema

```ts
interface ModuleManifest {
  id: string;                    // dotted lowercase: "<module>.<variant>"
  name: string;
  version: string;               // semver, e.g. "1.0.0-alpha"
  category: ModuleCategory;
  capabilities: string[];
  owning_phase: string;          // e.g. "Phase 17"
  description?: string;
  author?: string;               // default "agentryx-core"
  dependencies?: {
    modules?: string[];          // other module ids (installed before)
    env?: string[];              // env var names that must be non-empty
    registries?: string[];       // downstream DI registries needed (by name)
  };
  config_entries?: string[];     // Phase 12-A config ids
  feature_flag?: string;         // e.g. "USE_TRAINING_VIDEOS"
  factory: (ctx) => InstalledModule | Promise<InstalledModule>;
  uninstall?: (instance, ctx?) => void | Promise<void>;
}
```

The factory receives `InstallContext`:

```ts
interface InstallContext {
  registries?: Record<string, any>;     // downstream registries (provider registry, generator registry, etc.)
  env?: Record<string, string>;         // falls back to process.env
  resolveDependency?: (moduleId) => ModuleManifest | null;
  services?: Record<string, any>;
}
```

## API

```js
import { createMarketplaceStore } from "./marketplace/store.js";
import {
  installAllBuiltins,
  installModule, uninstallModule,
  listInstalled, queryCapabilities, resolveById, overview,
} from "./marketplace/pipeline.js";

// 1. Stand up a store
const store = createMarketplaceStore("/path/to/workspace");

// 2. Install the built-in catalogue
const { installed, failed } = await installAllBuiltins({ store });
//   installed = [15 module ids]
//   failed = []

// 3. Query
const providers = listInstalled(store, { category: "provider" });     // 3 provider packs
const voiceover = queryCapabilities(store, "voiceover_script");        // training-gen.template-generators
const stats = overview(store);                                         // { total, by_category, by_status, ids_by_category }

// 4. Install a custom module
const myProposer = {
  id: "self-improvement.proposer-llm-opus",
  name: "Self-improvement LLM proposer (Opus 4.7)",
  version: "0.1.0-preview",
  category: "proposer",
  capabilities: ["proposer", "llm-backed"],
  owning_phase: "Phase 15",
  dependencies: { env: ["OPENROUTER_API_KEY"], modules: ["self-improvement.heuristic-proposer"] },
  feature_flag: "USE_SELF_IMPROVEMENT",
  factory: async (ctx) => {
    // …wire up an LLM-backed proposer…
    return { id: "self-improvement.proposer-llm-opus", version: "0.1.0-preview", status: "installed" };
  },
};

const r = await installModule(myProposer, { env: { OPENROUTER_API_KEY: "sk-…" } }, store);
// r.ok === true | false (with error + missing[] on failure)
```

## Dependency validation

All three classes of dependency are checked **before** the factory runs:

| Kind | Check | On failure |
|---|---|---|
| `modules`   | each id must already be installed in this store | `missing: [{kind:"module", detail:<id>}, …]` |
| `env`       | each key must be defined non-empty in ctx.env (or process.env) | `missing: [{kind:"env", detail:<key>}, …]` |
| `registries`| each name must be present in ctx.registries | `missing: [{kind:"registry", detail:<name>}, …]` |

If any dependency is missing, install fails cleanly without invoking the factory; a `install_failed` audit event is written.

## Smoke test summary

```
$ node cognitive-engine/marketplace/smoke-test.js
[types]                                ✓ 13
[store basics]                         ✓ 14   (record / list / stats / listIds / uninstall / validation)
[store audit log]                      ✓ 5    (3 events; filter by action + id)
[manifest shape validation]            ✓ 9    (null, bad id/version/category, missing name/factory, bad uninstall)
[dependency validation]                ✓ 8    (module / env / registry each covered + mixed)
[installer happy path + idempotency]   ✓ 5
[installer shape failure]              ✓ 3    (audit written; store unchanged)
[installer dep failure]                ✓ 3    (missing[] emitted)
[installer factory failure]            ✓ 8    (throws / wrong-id / bad status / missing version / non-object)
[uninstall hook]                       ✓ 4    (hook called; missing module; hook throws → stays installed)
[catalogue schema compliance]          ✓ 24   (15 manifests shape-valid; category counts)
[installAllBuiltins]                   ✓ 8    (15 installed; overview; queryCapabilities; listInstalled)
[second-run idempotency]               ✓ 4    (all 15 → already installed; store intact)
[catalogue — category coverage]        ✓ 7    (7 of 9 categories touched; intake + pmd_producer out of scope)

[smoke] OK  — 117 assertions
```

## Feature flag

```
USE_MODULE_MARKETPLACE=true   Phase 18-B onwards: factory boot runs installAllBuiltins
                              Phase 18-A: no runtime effect; library only
```

## Design decisions

- **D159** — Marketplace wraps, never replaces, existing DI registries. Factories register with their category registry as a side effect of install; marketplace tracks the wrapper record.
- **D160** — Module id is a **dotted two-segment namespace** (`<module>.<variant>`). `training-videos.tts-stub-pack` groups naturally; `list` / `get` / `grep` all work without parsers.
- **D161** — Manifests carry **factory functions directly** (not remote URLs, not code strings). Remote fetch (18-B) is a separate concern that produces a manifest whose factory is loaded via its own mechanism; installer stays pure.
- **D162** — **Dependencies are checked at install time, not at runtime.** Missing deps → install fails with a typed `missing[]` array. Factories assume their deps are met.
- **D163** — **Catalogue entries describe real registered behavior**, not speculation. Each entry was authored alongside the scaffolded module, so its capabilities list reflects the shipped code.
- **D164** — **Audit log is append-only JSONL** — same shape as Phase 12-A admin audit and Phase 15-A proposal audit. `install` / `install_failed` / `uninstall` / `status_change` events. No state is ever lost.
- **D165** — **18-A emits zero LLM calls.** The 15 built-in manifests cover template / heuristic / stub variants only. LLM-backed modules (15-B proposer, 16-B generator, 17-B real TTS) each get their own manifest in their respective phase — at which point their `dependencies.env` will correctly require `OPENROUTER_API_KEY` / `ELEVENLABS_API_KEY` etc.

## Rollback

18-A has no runtime hooks — nothing invokes marketplace during the factory pipeline yet. Flag defaults off; even if set, no boot code calls `installAllBuiltins`. Removal = `rm -rf cognitive-engine/marketplace/` + unregister flag. Phase tag `phase-18a-closed` is the rollback anchor.

## What 18-B adds

- **Remote fetch** — load manifests from a hosted registry URL (GitHub raw, npm-style, or a bespoke Agentryx registry)
- **Signature verification** — manifests signed by publishers; installer refuses unsigned or invalid-sig manifests
- **Version resolution** — install `foo.bar@^1.0.0` picks the highest compatible version from the registry
- **Live swap** — uninstall old version + install new version atomically; rollback on failure
- **Publisher tooling** — `pack` a module directory into a distributable manifest-plus-factory bundle
- **Phase 12-B admin UI** — browse / install / uninstall / view logs via React admin panel
- **Boot-time install** — factory startup reads `configs/enabled_modules.json` and runs `installAllBuiltins` + enabled external modules

## What 18-C (or later) may add

- **Sandbox execution** — run factories in a subprocess or worker_thread; isolate crashes
- **Dependency graph visualisation** — generate a DOT graph of module deps
- **Marketplace-aware self-improvement** — Phase 15 proposals target module version upgrades (`module:training-videos.tts-elevenlabs`, action=`upgrade`, to=`1.1.0`)
- **Cost-aware module routing** — Phase 11 budget gate can swap expensive modules for cheaper equivalents automatically
- **Multi-tenant isolation** — per-project module rosters; one project can have the LLM proposer while another stays on heuristic
