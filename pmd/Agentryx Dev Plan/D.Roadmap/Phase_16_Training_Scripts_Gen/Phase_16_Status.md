# Phase 16 — Status: 16-A COMPLETE ✅  (16-B DEFERRED)

**Phase started**: 2026-04-23
**Phase 16-A closed**: 2026-04-23
**Duration**: single session

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 16-A.1 | `training-gen/types.js` — TrainingArtifact/TrainingKind/VoiceoverBeat/StoryboardBeat/ProjectContext shapes | ✅ done |
| 16-A.2 | `training-gen/store.js` — filesystem-backed store with per-project latest pointer + sha-verified integrity | ✅ done |
| 16-A.3 | `training-gen/generators.js` — 6 template generators + DI registry (matches Phase 9/13/14/15 pattern) | ✅ done |
| 16-A.4 | `training-gen/renderer.js` — markdown passthrough + Phase 17 payload + SRT captions | ✅ done |
| 16-A.5 | `training-gen/pipeline.js` — voiceover→storyboard ordering; isolates per-kind failures | ✅ done |
| 16-A.6 | Smoke test — 102 assertions across 12 test groups | ✅ done — all pass |
| 16-A.7 | `training-gen/README.md` + `USE_TRAINING_GEN` flag registered in admin-substrate | ✅ done |
| 16-B | LLM generators + post-dev graph wiring + PMD + memory integration + Phase 6-A dual-write + Verify feedback | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/training-gen/types.js` (new, ~110 lines)
- `TrainingArtifact`, `TrainingKind` (6), `VoiceoverBeat`, `StoryboardBeat`, `ScreenCaptureCue`, `ProjectContext`, `TrainingProvenance`, `FeatureManifestEntry` JSDoc shapes
- `KIND_FORMAT` table — maps each kind to its on-disk format (markdown vs json)
- `SCHEMA_VERSION`, `TRAINING_KINDS`, `TRANSITIONS`, `isValidKind`, `isValidTransition`, `formatFor`, `nowIso`

### `cognitive-engine/training-gen/store.js` (new, ~215 lines)
- `createTrainingStore(rootDir)` returns store instance:
  - `write({project_id, kind, title, content, produced_by, parent_ids?, tags?, meta?, cost_usd?})` → TrainingArtifact
  - `read(projectId, id)`, `readLatest(projectId, kind)`, `list(projectId, {kind?, limit?})`
  - `latest(projectId)` — returns the {kind: TART-id} map
  - `verify(projectId)` — recomputes sha256 per record, returns mismatches
  - `stats(projectId)` — total + by_kind counts
- Layout: `<root>/_training/<project_id>/` with `index.jsonl` + `latest.json` + `_seq` + content files
- Atomic content write (temp-file + rename); atomic `latest.json` write (same pattern)
- `project_id` validated against `^[A-Za-z0-9._-]+$` to keep filesystem paths clean

### `cognitive-engine/training-gen/generators.js` (new, ~225 lines)
- 6 template functions:
  - `userGuideTemplate` — markdown with Features section + per-feature blocks
  - `quickStartTemplate` — 5-step onboarding markdown
  - `howToTemplate` — one-task explicit-steps markdown (accepts `opts.feature`)
  - `referenceDocTemplate` — API + Configuration sections from `ctx.artifacts.{apis,configs}`
  - `voiceoverScriptTemplate` — structured beats with narrator text + cues + transitions (Phase 17 contract)
  - `videoStoryboardTemplate` — mirrors voiceover beats + camera plan + on-screen text; parents onto voiceover record when `opts.voiceover` provided
- `createGeneratorRegistry({defaults=true})` — returns `{register, get, has, list}`; swap a kind to plug in an LLM generator for 16-B

### `cognitive-engine/training-gen/renderer.js` (new, ~165 lines)
- `summarize(record, content)` — one-line description; beat count + duration for voiceover; scene count for storyboard
- `renderMarkdown(record, content)` — passthrough for prose kinds; compact tables for voiceover/storyboard
- `renderVoiceoverForPhase17(record, content)` — **this is the Phase 17 handoff**: splits content into `narration[]` (for ElevenLabs), `capture_plan[]` (for headless browser), `transitions[]`, `captions_srt`, `total_duration_ms`
- `captionsFromVoiceover(voiceoverContent)` — SRT caption block with cumulative timing from `target_duration_ms`

### `cognitive-engine/training-gen/pipeline.js` (new, ~85 lines)
- `runPipeline({ctx, store, registry, kinds?, perKindOpts?})` → `{produced, errors}`
- **Orders voiceover before storyboard** regardless of request order, so the storyboard generator receives the voiceover record/content via `opts.voiceover`
- **Isolates generator failures** — one generator throwing doesn't stop the others

### `cognitive-engine/training-gen/smoke-test.js` (new, ~355 lines)
- **102 assertions across 12 test groups**:
  - types (9): schema, kinds, transitions, formatFor
  - store basics (16): roundtrip md+json, list order, kind filter, stats, latest pointer, verify
  - store validation (5): invalid kind / missing title / missing content / missing generator_id / bad project_id
  - store append-only + latest (4): old versions retained; latest pointer updates
  - generators each (17): 6 generators all valid shape; beat structure; meta counts
  - generator registry (7): defaults registers 6; custom swap; invalid kind / missing fn / empty registry
  - pipeline full flow (6): 6 produced, stats, storyboard parent link, verify
  - pipeline subset (2): voiceover always before storyboard
  - pipeline generator failure (3): isolated; other 5 still produce
  - renderer (10): Phase-17 payload, markdown, summary, invalid kind
  - renderer SRT timing (3): cumulative ms → HH:MM:SS,mmm
  - end-to-end (6): pipeline → renderer → Phase 17 payload complete

### `cognitive-engine/training-gen/README.md` (new)
- Status, files table, layout diagram, kinds table, voiceover schema, pipeline flow, API, Phase-17 payload example, custom-generator swap example, smoke summary, decisions, 16-B/C preview

### `cognitive-engine/admin-substrate/registry.js` (modified)
- Added `USE_TRAINING_GEN` feature flag (10 total now)
- Admin smoke test updated (9 → 10) — 41 assertions still pass

### Unchanged
- Graph files (`dev_graph.js`, `factory_graph.js`, `post_dev_graph.js`, `pre_dev_graph.js`)
- `tools.js`, `telemetry.mjs`, memory-layer, concurrency, replay, artifacts, cost-tracker, courier, admin-substrate core logic, self-improvement, verify-integration, parallel, mcp
- Zero regression risk

## Smoke test highlight

```
[end-to-end: pipeline → renderer → Phase 17 payload]
  ✓ every narration has text
  ✓ every narration has duration
  ✓ every capture entry has url
  ✓ captions_srt non-empty
  ✓ total_duration_ms > 0
  ✓ E2E: storyboard parents voiceover

[smoke] OK  — 102 assertions
```

## Why 16-B deferred

16-B = **prose quality + production wiring**. Requires:

- **LLM generators** — real voice for `user_guide`/`quick_start`/`how_to`/`reference_doc`; thoughtful pacing and varied narration for `voiceover_script`. Needs OpenRouter credit to iterate meaningfully.
- **Post-dev graph integration** — after `post_dev_graph.js` runs, enqueue a `training_gen` job via Phase 14-A queue so training generation is async from the main pipeline.
- **Phase 4 PMD registry integration** — `referenceDocTemplate` reads from the PMD catalog (B2 Dev Doc, B5 Training Guide), not just synthetic `artifacts`.
- **Memory-layer personalization** — generators pull `lesson` + `pattern` observations for the project/agent; 15-B's self-improvement can then tune prompts based on reviewer feedback.
- **Phase 6-A dual-write** — each TrainingArtifact also lands in `_artifacts/` with kind `training_output` (enables cross-project analytics and Phase 15-B evaluator visibility).
- **Phase 9 Verify integration** — reviewers annotate scripts in the Verify portal; feedback flows back as memory observations.

Ship 16-A as the firm substrate; 16-B layers prose + integration on a tested contract.

## Feature-flag posture

| Flag | Default | Effect |
|---|---|---|
| (existing 9 flags ...) | off | Phases 4-15 |
| `USE_TRAINING_GEN` | off | Phase 16-B onwards: post_dev enqueues training_gen jobs; 16-A library only |

## Phase 16-A exit criteria — met

- ✅ `training-gen/` scaffolded (types, store, generators, renderer, pipeline, smoke-test, README)
- ✅ 6 generators registered as defaults; DI registry supports LLM swap in 16-B (D148)
- ✅ Voiceover script structure matches Phase 17's contract (D149) — 5 required fields per beat, plus parent-linked storyboards
- ✅ Phase 17 payload renderer produces `narration`/`capture_plan`/`transitions`/`captions_srt`/`total_duration_ms` in one call
- ✅ Append-only store with latest pointer (D151); integrity `verify()` passes
- ✅ Pipeline isolates generator failures; orders voiceover before storyboard
- ✅ $0 cost (no LLM calls) — matches D152
- ✅ **102 smoke-test assertions all pass**
- ✅ `USE_TRAINING_GEN` flag registered; admin-substrate smoke still green
- ✅ No changes to graph files, PMD agents, memory-layer, concurrency, replay, artifacts, or other modules
- ✅ Phase docs: Plan (expanded), Status, Decisions (D147-D152), Lessons
- ⏳ 16-B LLM + post-dev wiring + PMD + memory + Phase 6-A dual-write + Verify feedback deferred

Phase 16-A is **wired, tested, and ready**. Substrate is firm — 16-B brings prose and wiring.
