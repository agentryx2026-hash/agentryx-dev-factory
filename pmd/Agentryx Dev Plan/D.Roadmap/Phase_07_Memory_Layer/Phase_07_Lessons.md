# Phase 7 — Lessons Learned

Phase 7-A closed: 2026-04-22. Duration: single session.

## What surprised us

1. **`memory.js` was already there.** Pre-phase code survey (per Phase 4 Lesson #1) caught this. The existing file is a *narrow* skill-synthesizer tightly coupled to Chroma+Postgres — totally different in shape from the broad "observations across projects/agents" the sketch envisioned. If I'd skipped the survey, I'd have proposed renaming or merging, either of which would break the skill-recall path already wired into graph agents.

2. **The artifact walker was the most valuable piece**, more than the memory service itself. Once Phase 6-A exists, reading `index.jsonl` across project subdirs and summarizing is ~50 lines of code and answers "what's the factory done this week?" instantly. This'll be the backbone of Phase 11 (Cost/Quota Dashboard) — we just didn't plan it as a dashboard input. Add to 11's Plan.

3. **Scope-as-string is quietly powerful.** `"project:"` as a prefix filter, `"agent:troi"` as exact-match, `"global"` as a literal — one field covers three partition patterns without custom query logic. I was tempted to make `scope` a `{type, id}` object; glad I didn't.

4. **Phase 5-A / 6-A pattern is a reusable template.** Same shape each time:
   ```
   types.js → service/store → backend(s) → smoke-test → README → phase docs
   ```
   Each phase takes ~45-60 min now. Compounding velocity from the pattern itself.

## What to do differently

1. **Flag future subphases explicitly in the catalog.** `MEMORY_BACKEND=sqlite` throws `"not implemented yet (Phase 7-B)"`. Same pattern would help in `service.js` / `store.js` of other modules — flagged stubs are better than missing branches because they document the intended growth path.

2. **Observation IDs (`OBS-NNNN`) and Artifact IDs (`ART-NNNN`) use the same scheme.** Consistent but could collide in a cross-system query. Consider prefix-by-system in v2 (`A-NNNN` for artifacts, `M-NNNN` for memory). Not worth changing now.

3. **The smoke test should live as a regression script.** Third phase in a row where I wrote a smoke test, verified once, and moved on. A future phase should add `tools/smoke-all.sh` that runs every subsystem's smoke-test and exits non-zero on any failure. Candidate for Phase 11 or as a standalone docs/tooling PR.

## What feeds next phases

### Phase 7-B (deferred) — SQLite FTS5 backend
- Use `better-sqlite3`. FTS5 virtual table on `content`. `recall({text})` becomes true relevance-ranked search.
- Migration: read `index.jsonl`, bulk insert. Same IDs preserved.

### Phase 7-C (deferred) — Postgres backend
- Piggy-back on Phase 5-A's `postgres` MCP server entry. Enable it in `mcp/configs/servers.json`, add `backends/postgres.js`.
- Schema: `observations(id, kind, scope, content, tags[], refs jsonb, produced_at, produced_by jsonb)`.

### Phase 7-D (deferred) — Vector backend
- Reuse `memory.js` Chroma wiring. Add `backends/vector.js` that embeds `content` on write, similarity-searches on `recall({text})`.
- Hybrid pattern: vector for semantic, FTS5 for keyword, filesystem for human-curate. All behind the same `MemoryService`.

### Phase 7-E (deferred) — graph + Verify portal integration
- Graph node wrapper: after each LLM call, if `USE_MEMORY_LAYER=true`, write an `observation` with provenance + run_id.
- Verify portal (Phase 9): review UI offers "add observation" form → calls memory service → scope defaults to `project:<current>`.
- Depends on OpenRouter credit for E2E validation (same as 5-B, 6-B).

### Phase 9 — Verification Queue
- Reviewers can write `user_note` observations back into memory. Close the learning loop.

### Phase 11 — Cost + Quota Dashboard
- **`summarizeArtifacts()` is a natural dashboard input.** Per-project cost, per-agent cost, kind breakdown — all derivable from existing walker.
- Adds to Phase 11 Plan: "use Phase 7-A artifact walker as the cost aggregation source."

### Phase 12 — B7 Admin Module
- Per-project `memory_backend` setting via admin UI. Row in Postgres maps `project_id → backend`. `getMemoryService()` reads this instead of env.

### Phase 15 — Self-Improvement Loop
- Observations are input to self-improvement: "agent X has lesson Y from past N projects → propose graph change."
- Confirms Phase 7's core value: it's the memory of the factory's *own* behavior.

## Stats

- **1 session**
- **$0.00 spent** (no LLM calls)
- **0 new dependencies** (uses node built-ins: fs, path, os; reuses existing `../artifacts/store.js`)
- **6 files created**: `memory-layer/{types,service,smoke-test,artifact-walker,README}.js|.md` + `memory-layer/backends/filesystem.js`
- **0 files modified**: `memory.js`, graph files, tools.js all untouched
- **4 phase docs**: Plan (expanded from sketch), Status, Decisions, Lessons
- **5 Decisions**: D102-D106

## Phase 7-A exit criteria — met

- ✅ `memory-layer/types.js` — 5 observation kinds, scope validator, JSDoc shapes
- ✅ `memory-layer/service.js` — backend factory, env-driven
- ✅ `memory-layer/backends/filesystem.js` — Obsidian-visible markdown vault
- ✅ `memory-layer/artifact-walker.js` — cross-project artifact reader
- ✅ `memory-layer/smoke-test.js` — **verified end-to-end** (memory + walker halves, both passed)
- ✅ `memory-layer/README.md` — API, layout, flags, decisions
- ✅ Zero changes to `memory.js`, graph files, `tools.js` → zero regression
- ⏳ 7-B/C/D/E deferred (scale-dependent or needs OpenRouter credit)

Phase 7-A is **wired, tested, and ready**. Opens the path to 4 backend variants (7-B/C/D) and graph integration (7-E) when triggers warrant.
