# Phase 7 — Decisions Log

## D102 — `memory-layer/` lives ALONGSIDE `memory.js`, does not modify it

**What**: Phase 7-A creates `cognitive-engine/memory-layer/` as a parallel module. The existing `cognitive-engine/memory.js` (Chroma + Postgres skill synthesizer) is untouched.

**Why**:
- **Two different abstractions.** `memory.js` is narrow: "did this code work? remember it." Observations are broader: "Troi has a pattern of hallucinating auth middleware." Merging them would lose clarity.
- **Zero regression.** `memory.js` is already wired (via its exported tool) into graph agents. Changing it risks breaking the skill recall path.
- **Mirrors 5-A / 6-A pattern.** Alongside-new-module, feature-flagged, no edits to existing code. Proven template.

**Consequence**: factory will have TWO memory-ish subsystems. This is intentional until we learn which patterns matter most. A future phase (possibly 7-E or 15) may consolidate.

## D103 — Filesystem + markdown is the default backend, not SQLite

**What**: Default `MEMORY_BACKEND=filesystem` writes to `~/Projects/agent-workspace/_factory-memory/` with one markdown file per observation + append-only `index.jsonl`.

**Why**:
- **Obsidian-compatible.** User can point Obsidian at the vault directory and get a fully-featured browser/editor for free. Human curation (kind `user_note`) becomes trivial.
- **Zero dependencies.** No SQLite binding, no pg driver, no network. Works on every factory VM immediately.
- **Git-diffable.** The agent-workspace repo can track memory edits alongside project code. Changes to observations are reviewable.
- **SQLite/Postgres/vector come later.** Same `MemoryService` interface. Swap when we have a reason (scale, FTS need, embedding recall).

**Tradeoff**: no SQL query API, no FTS5 relevance ranking, no cross-process concurrency safety. Acceptable for v0.0.1; addressed in 7-B/C.

## D104 — `scope` is a single string key, not a nested structure

**What**: `scope` is a string like `"global"`, `"agent:troi"`, or `"project:2026-04-22_todo-app"`. Not a `{type, id}` object or multi-field.

**Why**:
- **Simpler validation + filtering.** A regex validates; `startsWith("project:")` filters. Nested shapes need deep-equal or custom index building.
- **Matches filesystem layout.** `agents/troi/` and `projects/<id>/` map cleanly from the scope string.
- **Swap-in backends inherit the same key model.** SQLite partition column is one TEXT; Postgres is one VARCHAR; vector metadata is one string. No translation layer.

**Tradeoff**: cross-scope queries (e.g. "all `user_note` across both `agent:*` and `project:*`") need prefix matching, not boolean predicates. Acceptable — such queries are rare.

## D105 — `MemoryService` is async-everywhere

**What**: All backend methods (`addObservation`, `recall`, `listForScope`, `getById`) return promises even when the implementation could be synchronous.

**Why**:
- **Backend parity.** SQLite better-sqlite3 is sync; Postgres pg is async; vector store calls are async. If the interface allowed either, graph code would need `await Promise.resolve(result)` guards or conditional branching per backend.
- **Consumers are already async.** Graph nodes are async functions; LLM calls are async. No perf penalty from wrapping sync FS in a promise.
- **Easier future evolution.** A streaming recall (async iterator) slots in without refactoring callers.

## D106 — Artifact walker is a read-only helper, not a backend

**What**: `artifact-walker.js` reads artifact `index.jsonl` files from multiple projects and returns a flat list. It does NOT copy artifact records into the memory vault.

**Why**:
- **Single source of truth.** Artifacts live in `_artifacts/` (Phase 6-A). Duplicating them into memory = two sources, sync problems, stale data.
- **Cross-project insight comes from walking, not aggregating.** Questions like "which agents produce the most qa_reports with failed > 0?" are one-off scans, not persistent queries.
- **Observations reference artifacts by ID.** `refs.artifact_ids` is the join key. When a later phase wants relational queries, it joins at read time.

**Implication**: any performance-sensitive cross-project query in the future will need a proper DB (Phase 7-C Postgres). The walker is for dev/admin UI and periodic summaries, not hot-path queries.
