# Phase 6 — Decisions Log

## D97 — Artifact store is filesystem-backed, not Postgres-backed

**What**: Artifacts live in `${PROJECT_DIR}/_artifacts/` — `index.jsonl` + one content file per artifact. No database.

**Why**:
- **Phase 6 is about shape, not substrate.** Getting the type system right matters more than the storage layer.
- **Filesystem gives git-diff for free.** Every artifact is inspectable with `cat`, `diff`, editor plugins. Postgres would lose this immediately.
- **Replay (Phase 13) becomes trivial.** `git checkout <tag>` on the project repo restores the exact artifact set from that moment.
- **Postgres comes in Phase 7 (Memory Layer).** The natural flow is: artifacts written to FS now → Phase 7 adds a Postgres mirror for cross-project queries. Don't conflate the two.

**Tradeoff**: no SQL query API. Mitigated by `listArtifacts({kind})` covering the common filter case; cross-project query comes with Phase 7.

## D98 — `index.jsonl` is append-only; no mutation, no lock

**What**: Every `writeArtifact` appends one JSON line to `index.jsonl`. The file is never rewritten, never sorted, never compacted.

**Why**:
- **Concurrency within one process is safe** — node's single-threaded write to an fd is atomic per line on Linux.
- **Cross-process concurrency is a future concern** — single factory runs today. Multi-project concurrency (Phase 14) will need a different strategy (per-run sharded indexes, or a proper queue).
- **Append-only is easier to reason about for replay.** Each line = one event, in order.

**Accepted limitations**:
- Reading the index = full scan. Fine for thousands of artifacts; needs rework at millions (Phase 13+ problem).
- No "delete" — only add. An artifact can be tagged `deleted: true` via a follow-up record if ever needed.

## D99 — Content files are named by ID (`ART-0042.md`), not content hash

**What**: Content lives at `_artifacts/ART-0042.md`. Hash is stored IN the manifest, not used as path.

**Why**:
- **Human browseability.** `ls _artifacts/` shows a chronological list. Hash-addressed stores (`ab/cd/abcdef...`) are opaque without a lookup.
- **Integrity still protected** — `content_sha256` in the record lets `verifyArtifact()` catch tampering.
- **Git-friendly paths.** Short, stable filenames diff cleanly in git history.

**Tradeoff**: identical content written twice = two different files, two different IDs. In practice artifacts diverge by provenance anyway (different agent, different timestamp), so this is noise-not-waste.

## D100 — Phase 6-B is dual-write, not state-field removal

**What**: When 6-B wires graphs to the store, it ADDS `writeArtifact(...)` calls after each LLM output — state fields like `codeOutput` are NOT removed.

**Why**:
- **Zero regression guarantee.** Removing state fields is a breaking change to downstream nodes. Dual-write is fully additive.
- **Earn replacement rights.** After 6-B runs long enough that we trust artifact reads, a much later phase can remove state fields. Not 6-B's problem.
- **Rollback = one env var.** `USE_ARTIFACT_STORE=false` → no writes, no reads, pipeline identical to pre-Phase-6.

**Consequence**: 6-B does not attempt to eliminate string blobs. It just makes them ALSO-stored as artifacts. State-field removal happens in a future phase (6-C or 8-ish) once evidence supports it.

## D101 — JSDoc types, not TypeScript migration

**What**: `types.js` uses `@typedef` JSDoc comments for shape definitions. No `.ts` files, no `tsc` build step.

**Why**:
- **Cognitive-engine is plain ESM JS.** Introducing TypeScript mid-project means a build step, config, and transpile for ALL files. Out of Phase 6 scope.
- **JSDoc gives 90% of the benefit** — VS Code shows types on hover, autocomplete works, `@param`/@returns flow through calls. Runtime shape enforcement is still absent, but that's the same in TS (types erase at runtime).
- **Migration path stays open.** If/when cognitive-engine converts to TS (possibly Phase 20 or post-R2), JSDoc typedefs are trivially convertible to `.d.ts` or inline types.

**Tradeoff**: no structural validation — if an agent passes a bad `produced_by` shape, we discover it at runtime. Acceptable for R&D mode.
