# Phase 18 — Decisions Log

## D159 — Marketplace wraps existing DI registries; never replaces them

**What**: When a module installs, its factory registers whatever it needs (provider with the training-videos three-category registry; handler with the concurrency handler registry; proposer by being DI-injected at construction time; etc.). The marketplace tracks the install event and metadata. If marketplace is uninstalled wholesale, every existing registry keeps working.

**Why**:
- **No behavior change for the factory pipeline.** Phases 5-A through 17-A run identically with or without marketplace present. This is the safest-possible introduction of a cross-cutting concern at v0.0.1.
- **The DI pattern already works.** Phase 9-A / 13-A / 14-A / 15-A / 16-A / 17-A all ship registries. Building a replacement would be a rewrite; wrapping them is additive.
- **Remote fetch (18-B) slots in without touching existing registries.** Install a remote proposer → its factory calls the existing self-improvement DI, same as a built-in would.
- **Emergency exit** — if marketplace has a bug, disable `USE_MODULE_MARKETPLACE` and nothing downstream notices.

**Tradeoff**: metadata about "what got registered" lives in two places — the marketplace (via `InstalledModule.metadata`) and the downstream registry. Minor duplication; both are read-only for queries.

## D160 — Module IDs are dotted two-segment namespaces

**What**: ID regex is `^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$`. Examples: `training-videos.tts-stub-pack`, `self-improvement.heuristic-proposer`. The first segment is the **module family** (usually = phase slug); the second+ segments are the **variant**.

**Why**:
- **Grouping for free**: `listIds("provider")` returns all provider modules; filter client-side by `id.startsWith("training-videos.")` to get just one family.
- **Namespacing future external modules**: `@acme/training-videos.tts-acme-voice` is obvious at a glance as external; built-ins stay in the core namespace.
- **Grep-friendly**: `rg 'training-videos\.'` finds every reference to training-videos modules across code and configs.
- **No parser needed**: every JS tooling already handles string dot-split.

**Tradeoff**: slightly more rigid than free-form ids. 18-B external packages might prefer `@org/name` npm-style syntax; we'd add a parallel npm prefix regex and accept both forms.

## D161 — Manifests carry factory functions directly, not URLs or code strings

**What**: `ModuleManifest.factory` is a live JavaScript function. Installing is calling it. Remote fetch (18-B) will fetch code via its own loader (dynamic import, signed bundle, whatever) and *construct* a manifest whose `factory` is the loaded function.

**Why**:
- **Installer is pure.** Given a manifest object, it validates and invokes. No network, no parsing, no evaluation contexts. Easy to test (117 assertions prove this).
- **Hot loading is someone else's problem.** 18-B's fetch layer decides how to safely load remote code; marketplace is agnostic.
- **Built-in catalogue literally imports the factory from the module's source.** No indirection. Refactor-friendly — if a module's internal API changes, the catalogue entry's `factory` closes over the new function automatically.

**Tradeoff**: manifests can't be safely serialised end-to-end (the factory would be lost). That's why `manifests.jsonl` stores only the metadata; factories live in memory only. 18-B loader rebuilds factories on boot.

## D162 — Dependencies checked at install time; runtime usage assumes they're met

**What**: `validateDependencies` walks `manifest.dependencies.{modules,env,registries}` and returns `[{kind, detail}, ...]` of what's missing. If non-empty, install fails without invoking the factory.

**Why**:
- **Fail fast, fail loud.** A missing `ELEVENLABS_API_KEY` should be a clear install-time error, not a cryptic TTS failure during a render job.
- **Provides contract documentation.** The `dependencies` field IS the API contract. When 17-B adds real ElevenLabs, its manifest declares `env: ["ELEVENLABS_API_KEY"]`. When 15-B LLM proposer lands, it declares `env: ["OPENROUTER_API_KEY"]`. The catalogue becomes discoverable API.
- **Graceful partial install.** If a factory depends on `memory-layer.filesystem-backend`, the installer refuses until the memory module is installed. `installAllBuiltins` iterates; late entries that depend on earlier ones succeed because the manifest order is stable. (Future: declare order via dep graph; today the flat order in `BUILTIN_MANIFESTS` is enough.)
- **Typed `missing[]` payload** so UIs can render "missing env var ELEVENLABS_API_KEY" as a specific error.

**Tradeoff**: only three classes of dependency (modules, env, registries). Missing classes: "version range of another module", "config entry presence", "network reachability". All additive — can be added in 18-B without breaking existing manifests.

## D163 — Catalogue entries describe real registered behavior

**What**: Every entry in `catalogue.js` lists the actual capability tags, config entries, and feature flags the shipped module uses. `training-videos.tts-stub-pack` declares `capabilities: ["tts", "tts:null", "tts:stub:elevenlabs", "tts:stub:openai"]` — matching exactly what Phase 17-A's `tts.js` registers.

**Why**:
- **Living documentation.** The catalogue is the canonical "what does this factory do" index. If a module's capabilities change, the catalogue entry must change too — structural, not stylistic.
- **Smoke tests enforce it.** `testCatalogueSchemaCompliance` runs `validateManifestShape` on every entry; any drift from the schema is caught automatically.
- **Self-improvement can reason about it.** Phase 15-B's LLM proposer can query `queryCapabilities(store, "voiceover_script")` to find which generator to tune, without grepping source code.
- **Discovery for new modules.** A new developer reading `catalogue.js` learns the full module inventory in one file; versus reading 13 module README files.

**Tradeoff**: catalogue grows with every new module. Fine — still authored by humans per phase, so review catches incorrect capability claims at scaffold time.

## D164 — Audit log is append-only JSONL, matching Phase 12-A and Phase 15-A convention

**What**: `<root>/_marketplace/audit.jsonl` gets one line per event. Events: `install` / `install_failed` / `uninstall` / `status_change`. Timestamps ISO-8601 UTC. No edits, no deletes.

**Why**:
- **Same shape as Phase 12-A admin audit and Phase 15-A proposal audit** — ops have one mental model for audit logs across the factory.
- **Install failures captured** — even when no module lands, the attempt is recorded. Critical for diagnosing "why didn't my module install" without code-diving.
- **Lossless forensics.** A misbehaving module can be traced back through the full event log to its install event (including full manifest metadata: version, author, declared deps).
- **Filter API mirrors other audit readers** (`action` / `id` / `limit` filters).

**Tradeoff**: JSONL grows unbounded. Ops policy in 18-B can archive after N days; today we let it grow (smoke tests use tmpdirs, real usage is rare).

## D165 — 18-A emits zero LLM calls; LLM-backed modules land with their own manifests in B-tiers

**What**: All 15 built-in manifests describe template / heuristic / stub variants. No built-in declares `env: ["OPENROUTER_API_KEY"]` or similar. The LLM-backed proposer (15-B), LLM generator (16-B), real TTS providers (17-B) each get their own manifests in their respective phases.

**Why**:
- **Matches the 13-scaffold discipline.** Every A-tier ship runs offline, deterministic, $0. Marketplace A-tier is no exception.
- **Proves dependency validation works correctly.** When 15-B adds `self-improvement.proposer-llm-opus`, its manifest will declare `env: ["OPENROUTER_API_KEY"]`. If the env var is unset at install time, the installer refuses — that's the **correct** behavior, proving the `missing[]` pipeline works end-to-end.
- **No hidden spend.** A naive 18-A that auto-included an LLM proposer in the catalogue would risk surprise OpenRouter charges on anyone running the smoke test. Keeping LLM modules out means smoke tests and demos cost $0 forever.
- **Clear 18-A / 18-B boundary.** A-tier = offline scaffolding. B-tier = external credentials + real APIs. This split is consistent across all phases.
