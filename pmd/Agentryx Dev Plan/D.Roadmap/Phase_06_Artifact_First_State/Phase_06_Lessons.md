# Phase 6 — Lessons Learned

Phase 6-A closed: 2026-04-21. Duration: single session.

## What surprised us

1. **The artifact catalog fell out of the graph state audit, not the other way around.** I expected to design kinds first. Instead, `grep` for `Annotation\(` across the 4 graphs revealed exactly the state fields that deserved promotion — `codeOutput`, `testOutput`, `qaReport`, `triageSpec`, `researchDossier`, `architectReview`, `deployStatus`, `pmdDocs`. The "catalog" is really "what state fields exist today." One-to-one mapping.

2. **Provenance is the real product of an artifact, not the content.** Content is whatever the LLM returned. The value-add is `{agent, node, model, run_id, iteration, cost, latency, parent_ids}` — because that's what makes replay, diff, and evaluation possible. Phase 6-B's real job is making sure every call site threads provenance correctly.

3. **File-per-artifact with a jsonl manifest is remarkably simple.** 130 lines of `store.js` covers write/read/list/verify. Postgres-backed alternatives would be 4x the code and lose `ls`-browseability. I was tempted by SQLite as a middle ground — rejected for the same reason.

4. **Phase 5-A's shape works as a template for other "build a new substrate" phases.** Same structure: types/contract → store/engine → smoke-test → README → feature flag → phase docs. Phase 5-A, 6-A, and probably 7-A will all share this skeleton.

## What to do differently

1. **Phase 6-B must add a run-id helper, not hand-roll one per call site.** The provenance metadata includes `run_id`, which must correlate all artifacts from one pipeline run. If each node generates its own, correlation breaks. Add a `startRun()` helper in `graph.js` (or wherever the graph is invoked) that stamps a UUID and threads it through state.

2. **Consider adding `kind-specific shape validators` in a later subphase.** `code_output` vs `pmd_doc` have different content expectations. Phase 6-A treats both as opaque strings. A Phase 6-C could add a `kind → validator` map and reject writes with mismatched shape. Avoid for now — premature rigidity.

3. **Smoke test should live long-term** (same note as 5-A's smoke-test). Add to a "factory regression" script in a future phase that runs all module smoke tests in one command.

## What feeds next phases

### Phase 6-B (deferred) — graph dual-write
- Add `writeArtifact(...)` calls after each LLM node returns.
- Threading provenance: `state._runId` → passed into every `produced_by`.
- Needs E2E validation on a real LLM run → blocked on OpenRouter credit (same constraint as Phase 4/5).

### Phase 7 — Memory Layer
- Direct input: artifact index.jsonl is a natural source for Postgres mirroring.
- Memory "remembers" artifacts across projects — e.g. "all `qa_report` artifacts with `failed > 0` in the past 30 days."
- Phase 7's Postgres MCP server (catalogued in 5-A) gets wired to read artifacts.

### Phase 9 — Verification Queue
- `qa_report` artifacts with failures feed Verify portal review items.
- Human reviews the `qa_report` content (stored in `ART-NNNN.json`) directly in the portal.

### Phase 12 — B7 Admin Module
- Admin UI can filter/search artifacts by kind, agent, run, cost.
- `listArtifacts(projectDir, {kind})` is the initial API; Phase 12 may add SQL-backed queries (via Phase 7 mirror).

### Phase 13 — Pipeline Replay
- **Direct dependency.** Replay means: pick a `run_id`, re-execute from any step, replacing the LLM call with the recorded artifact.
- Artifact store's `run_id` + `parent_ids` are the primary keys replay operates on.
- Without artifacts, replay is impossible — confirming Phase 6 must land before Phase 13.

### Phase 14 — Multi-Project Concurrency
- `index.jsonl` append-only works single-process. Multi-project = multiple node processes writing to different project dirs = no conflict.
- Within one project, concurrent runs might race on the index. Mitigation: separate run-id-scoped indexes, or a real queue (e.g. Redis stream). Phase 14's call.

## Stats

- **1 session**
- **$0.00 spent** (no LLM calls)
- **0 new dependencies** (uses node built-ins: fs, crypto, path)
- **4 files created**: `artifacts/types.js` (~50 lines), `artifacts/store.js` (~130 lines), `artifacts/smoke-test.js` (~45 lines), `artifacts/README.md`
- **0 files modified**: all graph files + tools.js untouched
- **4 phase docs**: Plan (expanded from sketch), Status, Decisions, Lessons
- **5 Decisions**: D97-D101

## Phase 6-A exit criteria — met

- ✅ `artifacts/types.js` — 9 kinds, JSDoc shapes, validator
- ✅ `artifacts/store.js` — write/list/get/verify, sha256, monotonic IDs
- ✅ `artifacts/smoke-test.js` — **verified end-to-end** (3 artifacts, filter, sha check, negative-case)
- ✅ `artifacts/README.md` — API, kinds table, decisions
- ✅ `USE_ARTIFACT_STORE` env flag documented
- ✅ Zero graph/state changes → zero regression risk
- ⏳ 6-B graph dual-write deferred (needs OpenRouter credit for validation)

Phase 6-A is **wired, tested, and ready**. 6-B opens when credit allows end-to-end LLM validation.
