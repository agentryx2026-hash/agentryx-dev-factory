# Phase 7 — Memory Layer v1

**One-liner**: Hybrid memory — Obsidian-compatible markdown vault (human-curated) + pluggable backends (SQLite FTS5 / Postgres / vector) for auto-captured observations. Ships behind a `MemoryService` interface so backends are hot-swappable per project.

**Original sketch note (pre-expansion, kept for history)**: Hermes's memory stack (FTS5 session search + LLM summarization + optional Honcho) was evaluated in Phase 2.75 as a candidate pattern. The factory will implement its own FTS5/Postgres/vector backends behind a shared interface, not run the full Hermes container just for memory. Letta and Graphiti are future swap-in options.

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 ("read existing code before scoping"):

- `cognitive-engine/memory.js` (77 lines) **already exists** but is narrow in scope:
  - Uses ChromaDB (vector) + Postgres `skill_documents` table
  - One function: `synthesizeSkill(task, code, success)` — post-task write path
  - One tool: `recall_past_skills` — semantic search via Chroma
  - Focused on **skill synthesis** (did this code work? remember it for next time)
- `cognitive-engine/test-memory.js` (23 lines) — smoke test for skill sequence
- `pg@8.20.0` and `chromadb@3.4.0` already in cognitive-engine dependencies
- Phase 5-A catalogued `postgres` MCP server (currently disabled in `mcp/configs/servers.json`) — future consumer of this memory layer
- Phase 6-A artifact store at `${PROJECT_DIR}/_artifacts/index.jsonl` — a natural data source for cross-project observations

**Decision**: Phase 7-A does NOT modify `memory.js`. It builds `memory-layer/` parallel to it (same pattern as 5-A and 6-A).

## Design

A **memory observation** is a durable note captured by the factory (or written by a human) about a project, an agent's behavior, a pattern, or a mistake. Structure:

```json
{
  "id": "OBS-0042",
  "kind": "observation|lesson|pattern|decision|user_note",
  "schema_version": 1,
  "scope": "project:2026-04-22_todo-app",
  "content": "Troi tends to hallucinate auth middleware when the spec doesn't mention auth.",
  "tags": ["troi", "auth", "hallucination"],
  "refs": {
    "artifact_ids": ["ART-0042"],
    "run_id": "pre-dev-2026-04-22-abc",
    "project_dir": "/path/to/project"
  },
  "produced_at": "2026-04-22T10:15:00Z",
  "produced_by": { "agent": "qa_reviewer", "model": "openrouter:..." }
}
```

**Vault layout** (filesystem-backed default, Obsidian-compatible):

```
~/Projects/agent-workspace/_factory-memory/
  ├── index.jsonl                          # append-only observation index
  ├── global/
  │   ├── OBS-0001-troi-auth-hallucination.md
  │   └── OBS-0002-genovi-prompt-needs-example.md
  ├── agents/
  │   ├── troi/
  │   │   └── OBS-0003-codes-well-on-react.md
  │   └── picard/
  ├── projects/
  │   └── 2026-04-22_todo-app/
  │       └── OBS-0004-missed-realtime-sync-spec.md
```

Each observation lives as a markdown file so Obsidian (or any editor) can open the vault directly for human curation.

## Scope for this phase (7-A: scaffolding)

Mirrors Phase 5-A / 6-A pattern — parallel module, feature-flagged, no changes to existing memory.js or graph files.

| Sub | What | Deliverable |
|---|---|---|
| 7-A.1 | Observation types (JSDoc) | `memory-layer/types.js` |
| 7-A.2 | `MemoryService` interface — `addObservation`, `recall`, `listForScope` | `memory-layer/service.js` |
| 7-A.3 | Filesystem/markdown vault backend (default) | `memory-layer/backends/filesystem.js` |
| 7-A.4 | Cross-project walker — reads artifact `index.jsonl` from multiple projects | `memory-layer/artifact-walker.js` |
| 7-A.5 | Smoke test: write 3 obs across 3 scopes, recall by filter | `memory-layer/smoke-test.js` |
| 7-A.6 | `USE_MEMORY_LAYER` + `MEMORY_BACKEND` flags + README | `memory-layer/README.md` |

**Out of scope for 7-A** (deferred to 7-B / 7-C / 7-D / 7-E):

- SQLite FTS5 backend (7-B)
- Postgres backend via Postgres MCP server (7-C)
- Vector/embedding backend (uses existing `memory.js` Chroma pattern) (7-D)
- Graph node integration (observations written post-LLM-call) (7-E)
- Honcho / Letta / Graphiti evaluations (Phase 15 self-improvement band)

## Why this scope is right

- **Configurability-first (P1)**: the `MemoryService` interface lets us swap backends (fs ↔ sqlite ↔ pg ↔ vector) per project via admin UI later.
- **P8 tool-swap flexibility**: no single memory tech commitment. v0.0.1 ships FS because it's zero-dep and Obsidian-visible.
- **Complements, doesn't replace `memory.js`**: skill synthesis (narrow vector-based post-task capture) remains. Observations (broader, human-curateable) are new.
- **Feeds Phase 9 Verification**: human reviewers can write observations from the Verify portal back into this store.

## Phase close criteria

- ✅ `memory-layer/` scaffolded (types, service, fs backend, walker, smoke-test, README)
- ✅ Smoke test **runs end-to-end** (3 observations, filter by scope, filter by tag)
- ✅ Artifact walker produces cross-project summary of artifact kinds/counts
- ✅ `USE_MEMORY_LAYER` + `MEMORY_BACKEND=filesystem` flag documented
- ✅ No changes to `memory.js` or graph files → zero regression
- ✅ Phase docs: Plan (expanded), Status, Decisions (D102-Dxx), Lessons

## Decisions expected

- **D102**: Parallel module at `memory-layer/`, not modifying `memory.js`
- **D103**: Filesystem/markdown default backend (Obsidian-visible) over SQLite
- **D104**: `scope` string as primary partition (`global`, `agent:<id>`, `project:<id>`) — not a separate column/field hierarchy
- **D105**: `MemoryService` as an async interface, async-everything so swap-in backends (sqlite sync, pg async) share signature
- **D106**: Artifact walker is a read-only helper, not a backend — it inspects the artifact store across projects without copying data
