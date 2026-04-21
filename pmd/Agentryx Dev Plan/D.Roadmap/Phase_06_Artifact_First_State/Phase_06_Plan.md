# Phase 6 — Artifact-First State

**One-liner**: Replace text-blob state (`codeOutput`, `qaReport`, `researchDossier`, etc.) with typed, versioned artifacts written to a filesystem-backed artifact store. Enables clean diff, replay, hand-off between pipelines.

## Context (pre-phase code survey)

Current graph state carries large untyped string blobs:

| State field | Where | Currently |
|---|---|---|
| `codeOutput` | `dev_graph.js`, `factory_graph.js` | Raw LLM output string |
| `testOutput` | `dev_graph.js`, `factory_graph.js` | Raw string |
| `qaReport` | `dev_graph.js`, `factory_graph.js` | Raw string |
| `triageSpec` | `dev_graph.js`, `factory_graph.js` | Raw string |
| `researchDossier` | `dev_graph.js`, `factory_graph.js` | Raw string |
| `architectReview` | `dev_graph.js`, `factory_graph.js` | Raw string |
| `deployStatus` | `dev_graph.js`, `factory_graph.js` | Raw string |
| `pmdDocs` | all graphs | Object keyed by doc id, values are strings |
| `deliveryDocs` | `post_dev_graph.js` | Object keyed by id |

**Problems with string-blob state:**
- No schema — consumer nodes must re-parse each time.
- No provenance — can't tell which agent/model/cost produced this blob.
- No diff — can't compare iteration N vs N+1 cleanly.
- No replay — rerunning a node overwrites state; lose history.
- No hand-off between pipelines — `pre_dev` → `dev` → `post_dev` pass `pmdDocs` but no shared artifact log.

## Design

An **artifact** is a typed, content-addressable object with metadata:

```json
{
  "id": "ART-0042",
  "kind": "code_output",
  "schema_version": 1,
  "produced_by": {
    "agent": "troi",
    "node": "troiBackendNode",
    "model": "openrouter:anthropic/claude-sonnet-4-5",
    "run_id": "pre-dev-2026-04-21-abc",
    "iteration": 1
  },
  "produced_at": "2026-04-21T18:42:11Z",
  "cost_usd": 0.042,
  "latency_ms": 4812,
  "content_ref": "_artifacts/ART-0042.md",
  "content_sha256": "...",
  "parent_ids": ["ART-0040", "ART-0041"],
  "tags": []
}
```

**Artifact kinds** (initial catalog):
- `code_output` (replaces `codeOutput`)
- `test_output` (replaces `testOutput`)
- `qa_report` (replaces `qaReport`)
- `triage_spec` (replaces `triageSpec`)
- `research_dossier` (replaces `researchDossier`)
- `architect_review` (replaces `architectReview`)
- `deploy_status` (replaces `deployStatus`)
- `pmd_doc` (for each entry in `pmdDocs` / `deliveryDocs`)
- `raw_extraction` (Genovi's structured JSON — Phase 3/4)

**Store layout**:
```
${PROJECT_DIR}/_artifacts/
  ├── index.jsonl          # append-only log of artifact metadata
  ├── ART-0001.md          # content of artifact 1
  ├── ART-0002.json        # content of artifact 2 (kind determines extension)
  └── ...
```

- `index.jsonl` is the source-of-truth manifest. One line per artifact. Append-only.
- Content lives in separate files so LLM outputs can be diffed / viewed / edited.
- Content files are named by artifact ID, not hash, for human browseability.
- `content_sha256` in the metadata lets us verify integrity.

## Scope for this phase (6-A: scaffolding)

Mirrors Phase 5-A's pattern — build the module alongside, feature-flag, no graph changes, smoke test.

| Sub | What | Deliverable |
|---|---|---|
| 6-A.1 | Artifact type definitions (JSDoc or TS types in comments) | `artifacts/types.js` |
| 6-A.2 | Store: write / read / list / get-by-id / append-to-index | `artifacts/store.js` |
| 6-A.3 | Content-sha256 + ID allocation (monotonic `ART-NNNN`) | in `store.js` |
| 6-A.4 | Smoke test: write 3 artifacts, read index, verify sha | `artifacts/smoke-test.js` |
| 6-A.5 | `USE_ARTIFACT_STORE` flag docs + README | `artifacts/README.md` |

**Out of scope for 6-A** (deferred to 6-B):

- Graph nodes writing artifacts alongside state
- Graph state shape migration (keep `codeOutput` etc. — add artifact write as a side-effect)
- Cross-pipeline artifact hand-off (`pre_dev` artifacts visible to `dev_graph`)
- Phase 13 (Replay) — depends on artifact store but is its own phase

## Why this scope is right

- **Configurability-first (P1)**: artifact store as an optional parallel mechanism — flip flag to start writing; existing behavior unchanged when off.
- **Source-of-truth (P6)**: `_artifacts/` lives inside the project dir, which is already versioned (git on the agent-workspace repo).
- **Earn replacement rights**: we don't rip out `codeOutput` until artifacts are proven. 6-A is dual-write at best; 6-B may add dual-read; state field removal is a much later phase.

## Phase close criteria

- ✅ `cognitive-engine/artifacts/` directory scaffolded
- ✅ Can write, read, list, get artifacts from a standalone test
- ✅ sha256 integrity check works
- ✅ `USE_ARTIFACT_STORE` flag documented (no runtime effect in 6-A)
- ✅ No graph files modified
- ✅ Phase docs: Status, Decisions (D97-Dxx), Lessons

## Decisions expected

- **D97**: filesystem-backed, not DB-backed (defer Postgres to Phase 7)
- **D98**: append-only jsonl index, not in-memory cache
- **D99**: content in separate files keyed by ID, not content-hash
- **D100**: 6-B graph integration is dual-write, not replacement
