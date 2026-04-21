# Phase 6 — Status: 6-A COMPLETE ✅  (6-B DEFERRED)

**Phase started**: 2026-04-21
**Phase 6-A closed**: 2026-04-21
**Duration**: single session

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 6-A.1 | `artifacts/types.js` — 9 kinds, JSDoc shapes, validator | ✅ done |
| 6-A.2 | `artifacts/store.js` — write/read/list/get/verify, sha256 | ✅ done |
| 6-A.3 | Monotonic ID allocation (`ART-NNNN`) from index scan | ✅ done |
| 6-A.4 | `artifacts/smoke-test.js` — 3 artifacts, filter, verify | ✅ done — passed end-to-end |
| 6-A.5 | `artifacts/README.md` — layout, kinds, API, decisions | ✅ done |
| 6-A.6 | `USE_ARTIFACT_STORE` flag + `isEnabled()` export | ✅ done |
| 6-B | Graph nodes dual-write to artifact store under flag | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/artifacts/types.js` (new)
- 9 artifact kinds: code_output, test_output, qa_report, triage_spec, research_dossier, architect_review, deploy_status, pmd_doc, raw_extraction
- JSDoc typedefs: `Artifact`, `ArtifactProvenance`, `WriteArtifactInput`
- `SCHEMA_VERSION = 1` exported
- `isValidKind()` validator

### `cognitive-engine/artifacts/store.js` (new, ~130 lines)
- `writeArtifact(projectDir, input)` — allocates ID, writes content file (.md for string, .json for object), appends to `index.jsonl`, computes sha256
- `listArtifacts(projectDir, {kind})` — full index or filtered
- `getArtifact(projectDir, id)` — returns `{record, content}`, null if not found
- `verifyArtifact(projectDir, id)` — sha integrity check
- `isEnabled()` — reads `USE_ARTIFACT_STORE`

### `cognitive-engine/artifacts/smoke-test.js` (new)
- Writes 3 artifacts across 3 kinds (code_output string, qa_report object, pmd_doc tagged)
- Lists, filters, fetches, verifies — **passed end-to-end** in `/tmp`

### `cognitive-engine/artifacts/README.md` (new)
- Store layout, kinds table, API examples, design decisions, rollback

### Graph files: UNCHANGED
- All 5 graph files still carry string-blob state. Zero regression.

## Smoke test output

```
[smoke] wrote ART-0001 (code_output) sha=7ba3d82480b1...
[smoke] wrote ART-0002 (qa_report) parent=ART-0001
[smoke] wrote ART-0003
[smoke] index has 3 entries: ART-0001:code_output, ART-0002:qa_report, ART-0003:pmd_doc
[smoke] qa_report filter: 1 match
[smoke] getArtifact(ART-0001): content length=23, provenance agent=troi
[smoke] verify(ART-0002): ok=true
[smoke] getArtifact(missing): null (ok)
[smoke] OK
```

## Why 6-B deferred

6-B = graph nodes performing dual-write (state AND artifact store) on every LLM call. Requires:
- Adding `writeArtifact(...)` calls inside 20+ agent nodes across 5 graph files.
- Validation that provenance metadata (agent, model, run_id, iteration) is threaded correctly at each call site.
- End-to-end run to confirm artifacts match the state values that were written.

End-to-end validation requires OpenRouter credit — same constraint as Phase 4 and Phase 5. Close 6-A clean now, open 6-B when validation is possible.

## Feature-flag posture (P1 configurability-first)

| Flag | Default | Effect |
|---|---|---|
| `PRE_DEV_USE_GRAPH` | off | Phase 4 — template subst vs real LLM graph |
| `USE_MCP_TOOLS` | off | Phase 5 — no runtime effect until 5-B |
| `USE_ARTIFACT_STORE` | off | Phase 6 — no runtime effect until 6-B |

## Phase 6-A exit criteria — met

- ✅ `artifacts/` module scaffolded (types, store, smoke-test, README)
- ✅ Smoke test **passed end-to-end** (not just syntactic)
- ✅ sha256 integrity check works
- ✅ Monotonic ID allocation works
- ✅ Both string and object content serialization work (.md / .json)
- ✅ Zero changes to graph files or state schemas
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 6-B dual-write deferred pending OpenRouter credit for validation

Phase 6-A is **wired, tested, and ready**. 6-B opens when credit allows end-to-end validation of artifact writes inside real graph runs.
