# Phase 7 — Status: 7-A COMPLETE ✅  (7-B/C/D/E DEFERRED)

**Phase started**: 2026-04-22
**Phase 7-A closed**: 2026-04-22
**Duration**: single session

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 7-A.1 | `memory-layer/types.js` — 5 kinds, scope convention, JSDoc shapes, validators | ✅ done |
| 7-A.2 | `memory-layer/service.js` — factory fn reading `MEMORY_BACKEND` + `FACTORY_MEMORY_ROOT` | ✅ done |
| 7-A.3 | `memory-layer/backends/filesystem.js` — markdown vault + `index.jsonl` | ✅ done |
| 7-A.4 | `memory-layer/artifact-walker.js` — cross-project artifact reader + summary | ✅ done |
| 7-A.5 | `memory-layer/smoke-test.js` — both memory and walker verified | ✅ done — passed end-to-end |
| 7-A.6 | `memory-layer/README.md` + flag documentation | ✅ done |
| 7-B | SQLite FTS5 backend (Hermes pattern) | ⏳ DEFERRED |
| 7-C | Postgres backend via Postgres MCP | ⏳ DEFERRED |
| 7-D | Vector/embedding backend | ⏳ DEFERRED |
| 7-E | Graph + Verify portal integration (actually write observations) | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/memory-layer/types.js` (new, ~80 lines)
- 5 observation kinds: `observation`, `lesson`, `pattern`, `decision`, `user_note`
- Scope convention: `global`, `agent:<id>`, `project:<id>` with `isValidScope()` regex validator
- JSDoc typedefs: `Observation`, `AddObservationInput`, `RecallFilter`, `ObservationRefs`, `ObservationProvenance`
- `SCHEMA_VERSION = 1`

### `cognitive-engine/memory-layer/service.js` (new)
- `getMemoryService({backend, rootDir})` — factory function
- Reads `MEMORY_BACKEND` (default "filesystem")
- Reads `FACTORY_MEMORY_ROOT` (default `~/Projects/agent-workspace/_factory-memory`)
- Throws descriptive errors for unimplemented backends (`sqlite`, `postgres`, `vector`)
- `isEnabled()` — reads `USE_MEMORY_LAYER`

### `cognitive-engine/memory-layer/backends/filesystem.js` (new, ~140 lines)
- `createFilesystemBackend(rootDir)` returns `{ addObservation, recall, listForScope, getById }`
- Monotonic `OBS-NNNN` IDs
- Per-scope directory layout (`global/`, `agents/<id>/`, `projects/<id>/`)
- Markdown file per observation with YAML frontmatter (Obsidian-ready)
- Append-only `index.jsonl` for fast listing without reading every file
- Recall filters: `scope` (exact or prefix), `kind`, `tags` (AND), `text` (case-insensitive substring), `limit`

### `cognitive-engine/memory-layer/artifact-walker.js` (new)
- `walkArtifacts(workspaceRoot)` — iterates project subdirs, reads each `_artifacts/index.jsonl`, returns flat list with `project_id` stamped
- `summarizeArtifacts(workspaceRoot)` — counts by kind + by project, total cost
- **Read-only** — never writes to artifact stores

### `cognitive-engine/memory-layer/smoke-test.js` (new)
- Memory test: 3 observations across 3 scopes (agent:troi, global, project:2026-04-22_todo-app), filter by scope, tags, text, fetch by ID
- Walker test: 2 synthetic projects with 3 artifacts, summary verified
- **Both passed end-to-end**

### `cognitive-engine/memory-layer/README.md` (new)
- Vault layout, observation schema, kinds table, scope convention, API examples, feature flags, design decisions, rollback

### Unchanged
- `cognitive-engine/memory.js` (77-line skill synthesizer) — untouched
- All 5 graph files — untouched
- `memory-layer/` is purely additive

## Smoke test output

```
[memory] wrote OBS-0001 (lesson, agent:troi)
[memory] wrote OBS-0002
[memory] wrote OBS-0003
[memory] recall scope=agent:troi: 1 hit(s)
[memory] recall tags=[auth]: 1 hit(s)
[memory] recall text=openrouter: 1 hit(s)
[memory] getById(OBS-0001): markdown starts "---\nid: OBS-0001\nkind: lesson\nschema_ver..."

[walker] summary: {"total_artifacts":3,"total_projects":2,"by_kind":{"code_output":2,"qa_report":1},"by_project":{"2026-04-22_blog":1,"2026-04-22_todo-app":2},"total_cost_usd":0.06}
[walker] walked 3 artifacts across 2 projects
```

## Why 7-B/C/D/E deferred

- **7-B (SQLite FTS5)**: full-text search becomes valuable at 100+ observations. Current system handles dozens easily via in-memory substring filter. Defer until scale warrants it.
- **7-C (Postgres)**: depends on Postgres MCP (Phase 5-A's `postgres` catalog entry, currently disabled). Wait until we have a reason to centralize (multi-host factory, Phase 14 multi-project concurrency).
- **7-D (vector)**: semantic recall needs embeddings. Existing `memory.js` already does this for skill synthesis — revisit when we have enough observations to make embedding worthwhile.
- **7-E (graph + Verify integration)**: writing observations from graph nodes needs provenance threading (same as Phase 6-B). Best handled alongside 6-B once OpenRouter credit permits E2E validation.

## Feature-flag posture (P1 configurability-first)

| Flag | Default | Effect |
|---|---|---|
| `PRE_DEV_USE_GRAPH` | off | Phase 4 — template subst vs real LLM graph |
| `USE_MCP_TOOLS` | off | Phase 5 — no runtime effect until 5-B |
| `USE_ARTIFACT_STORE` | off | Phase 6 — no runtime effect until 6-B |
| `USE_MEMORY_LAYER` | off | Phase 7 — no runtime effect until 7-E |
| `MEMORY_BACKEND` | `filesystem` | swap to `sqlite`/`postgres`/`vector` in 7-B/C/D |
| `FACTORY_MEMORY_ROOT` | `~/.../agent-workspace/_factory-memory` | override vault location |

## Phase 7-A exit criteria — met

- ✅ `memory-layer/` scaffolded (types, service, fs backend, walker, smoke-test, README)
- ✅ Smoke test **passed end-to-end** — memory service + artifact walker both verified
- ✅ Vault structure is Obsidian-visible (markdown + YAML frontmatter)
- ✅ Artifact walker summarizes across multiple projects correctly
- ✅ Feature flags documented
- ✅ Zero changes to `memory.js` or graph files → zero regression
- ✅ Phase docs: Plan (expanded from sketch), Status, Decisions, Lessons
- ⏳ 7-B/C/D/E deferred (scale-dependent or needs OpenRouter credit)

Phase 7-A is **wired, tested, and ready**. Backend swap-ins open when scale/credit allows; graph integration opens alongside 6-B.
