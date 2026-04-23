# Phase 16 — Lessons Learned

Phase 16-A closed: 2026-04-23. Duration: single session (same day as 15-A).

## What surprised us

1. **The voiceover schema landed in the first draft.** Five beat fields — `id`, `narrator_text`, `target_duration_ms`, optional `screen_capture`, optional `transition` — cover everything a real video pipeline needs. Any fewer fields and Phase 17 would need to invent missing data; any more and authors would agonize over filling in unused slots. This exact shape came from reading Phase 17's one-liner ("ElevenLabs + headless-browser screen capture stitched") and asking "what's the minimum Phase 17 needs from us?" The first answer was right.

2. **Template generators are more useful than expected.** A template voiceover with 7 beats, correct URLs, sensible pacing, and real feature titles is not just a "contract proof" — it's a usable first-draft input to Phase 17's rendering pipeline. Meaning: Phase 17 can be fully built and tested against 16-A output, and 16-B is about polish (prose quality), not about unblocking downstream work.

3. **Pipeline ordering is the only "smart" thing the pipeline does.** Everything else is `for kind in kinds: generator.fn(ctx, opts); store.write(...)`. The storyboard-after-voiceover ordering + forwarding the voiceover record into storyboard opts is the only piece of non-obvious logic. Keeping the pipeline thin means 16-B's LLM swap doesn't touch pipeline code.

4. **The renderer's `renderVoiceoverForPhase17` is worth more than it looks.** On paper it's a "reshape the object" helper — but it's actually the formal handoff contract between Phase 16 and Phase 17. Moving the split `{narration, capture_plan, transitions, captions_srt}` from ad-hoc-in-Phase-17 into 16-A's renderer means both phases share the same integration point and changes are auditable.

## What to do differently

1. **`storyboard.parent_ids` uses the voiceover artifact's TART id — but the storyboard generator runs before the voiceover is persisted unless the pipeline injects it.** First draft had the storyboard generator try to call `store.readLatest` itself, which made the generator non-pure and harder to test. Moving that to the pipeline (`perKindOpts.voiceover = {record, content}`) kept generators pure. Note for 16-B: when LLM generators want additional context (related memory observations, prior TARTs), inject via `opts`, never via hidden store reads inside the generator.

2. **`list()` newest-first vs the store index being newest-last surprised me twice.** Index append convention: newest-LAST (matches append semantics). API ergonomics: newest-FIRST (matches UI expectations). Decided to keep the disk convention and reverse in `list()`. Any future query helpers should document this explicitly.

3. **`project_id` validation matters more than expected.** Initially accepted any string; a test caught that a `project_id` with `/` would escape its own directory. Tightened to `[A-Za-z0-9._-]+`. Worth codifying as a convention: any user-influenceable path segment must be regex-validated at the store's edge.

4. **Did not spec `how_to` depth** — the template produces one generic how-to. A real project will want one per major feature. 16-B should accept a `kinds: ["how_to"]` request with `perKindOpts.how_to = [{feature: ...}, {feature: ...}]` (array) and produce multiple how-to artifacts in one pass. Today the pipeline runs each kind exactly once; that needs to change.

## What feeds next phases

### Phase 16-B (deferred) — brain + production wiring
- **LLM generators** — call OpenRouter with structured prompts; reuse the same `fn(ctx, opts) → {title, content, parent_ids?, meta, tags}` contract
- **Post-dev graph handler** — `registerHandler("training_gen", async (job, ctx) => { const result = await runPipeline(...); return {tart_count: result.produced.length}; })` in Phase 14-A concurrency engine
- **Phase 4 PMD registry** — reference_doc template reads from `configs/pmd-registry.json` instead of `ctx.artifacts`; produces a richer doc
- **Memory-layer personalization** — voiceover/storyboard generators pull agent/project lessons and interweave ("in this project, we learned to include auth context upfront — you'll see that reflected here")
- **Phase 6-A dual-write** — optional `store.write({..., dualWrite: true})` also calls `artifactStore.write({kind: "training_output", ...})`
- **Phase 9 Verify integration** — reviewers see voiceover beats in a timeline UI; per-beat approve/reject writes user_note observations; 15-B self-improvement consumes those observations to retune generators

### Phase 17 — Training Videos
- **Consumes `renderVoiceoverForPhase17` output directly** — no schema translation. The `capture_plan[]` drives Puppeteer/Playwright; `narration[]` drives ElevenLabs; `captions_srt` is the subtitle track; `transitions[]` drives ffmpeg concat filters
- Phase 17 can build + test against 16-A template output today; 16-B's prose improvements are additive, not breaking
- **Storyboard** feeds the pre-render preview UI — humans scan the beats + camera plan before paying for an ElevenLabs render

### Phase 4 — PMD Template Registry
- 16-B integration: training-gen registers `training_output` as a new `producer_type` in pmd-registry.json? **Probably no** — training outputs aren't per-phase-gated artifacts; they're cross-cutting. Keep them separate to avoid polluting the PMD doc producer pipeline.

### Phase 15 — Self-Improvement
- **Evaluator can target training-gen generators** — a proposal "switch voiceover generator from template to opus-4-7 on projects X/Y/Z" evaluates by comparing cost/success-rate/latency deltas across replays. Registry DI makes the swap mechanical.

### Phase 14 — Concurrency
- `training_gen` becomes a registered job kind in 16-B; handler invokes `runPipeline`
- Per-project fairness (Phase 14-A round-robin) naturally extends to training jobs — no project monopolizes generator capacity

### Phase 9 — Verify integration
- Reviewer UI surfaces `summarize(record, content)` as the one-liner for each TART in the queue
- `renderMarkdown` output feeds the diff viewer

## Stats

- **1 session** (same day as 15-A)
- **$0.00 spent** (all templates, no LLM)
- **0 new dependencies** (node built-ins only)
- **7 files created** in `cognitive-engine/training-gen/`: `types.js`, `store.js`, `generators.js`, `renderer.js`, `pipeline.js`, `smoke-test.js`, `README.md`
- **2 files modified**: `admin-substrate/registry.js` (+1 flag), `admin-substrate/smoke-test.js` (9 → 10 flag counts)
- **0 files modified** in: graph files, `tools.js`, `telemetry.mjs`, memory-layer, concurrency, replay, artifacts, self-improvement, cost-tracker, courier, verify-integration, parallel, mcp
- **4 phase docs**: Plan (expanded), Status, Decisions, Lessons
- **6 Decisions**: D147-D152

## Phase 16-A exit criteria — met

- ✅ `training-gen/` scaffolded (types, store, generators, renderer, pipeline, smoke-test, README)
- ✅ 6 template generators registered as defaults; DI registry supports LLM swap for 16-B
- ✅ Voiceover script shape matches Phase 17's contract; renderer produces the 5-field Phase-17 payload
- ✅ Pipeline orders voiceover before storyboard; isolates per-kind failures
- ✅ Store supports append-only regeneration with latest pointer and sha-verified integrity
- ✅ **102 smoke-test assertions all pass**
- ✅ Admin-substrate smoke still green at 41 assertions after flag add
- ✅ `USE_TRAINING_GEN` flag registered with correct owning-phase
- ✅ Zero changes outside `training-gen/` + flag registration
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 16-B LLM + post-dev wiring + PMD + memory + 6-A dual-write + Verify deferred

Phase 16-A is **wired, tested, and ready**. Substrate is firm — 16-B brings the prose and production wiring.
