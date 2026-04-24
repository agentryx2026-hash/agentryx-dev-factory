# Phase 17 — Status: 17-A COMPLETE ✅  (17-B DEFERRED)

**Phase started**: 2026-04-24
**Phase 17-A closed**: 2026-04-24
**Duration**: single session (same arc as 15-A / 16-A)

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 17-A.1 | `training-videos/types.js` — VideoArtifact / RenderStatus (5) / ProviderChoice / BeatRenderLog / RendererProgressEvent | ✅ done |
| 17-A.2 | `training-videos/providers/` — TTS (null + stub-elevenlabs + stub-openai) + capture (null + stub-puppeteer + stub-playwright) + stitcher (null + stub-ffmpeg) + three-category registry | ✅ done |
| 17-A.3 | `training-videos/store.js` — reserve/commit lifecycle, per-render asset dirs, atomic manifest write, append-only render log | ✅ done |
| 17-A.4 | `training-videos/renderer.js` — orchestrates TTS × beats + capture × beats + stitch; progress events; beat-level failure isolation (D156) | ✅ done |
| 17-A.5 | `training-videos/pipeline.js` — `renderFromPhase17Payload` + `renderFromScript` wired to Phase 16-A training-gen | ✅ done |
| 17-A.6 | Smoke test — 91 assertions across 13 test groups | ✅ done — all pass |
| 17-A.7 | `training-videos/README.md` + `USE_TRAINING_VIDEOS` flag registered in admin-substrate | ✅ done |
| 17-B | Real ElevenLabs/OpenAI TTS + real Puppeteer/Playwright + real ffmpeg + Phase 14 handler + Phase 9 Verify + cloud upload | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/training-videos/types.js` (new, ~100 lines)
- `VideoArtifact`, `RenderStatus` (`queued|rendering|done|failed|degraded`), `ProviderChoice`, `RenderJobInput`, `BeatRenderLog`, `RendererProgressEvent`
- `PROVIDER_CATEGORIES` (3: tts / capture / stitcher), `RENDER_STATUSES` (5)
- Validators + `nowIso()` helper

### `cognitive-engine/training-videos/providers/tts.js` (new, ~130 lines)
- `createNullTtsProvider` — writes 1-line marker, cost=0
- `createStubElevenLabsProvider({voice_id, model_id, price_per_char_usd})` — defaults to Rachel / monolingual v2 / ~$0.00003/char
- `createStubOpenAiProvider({model, voice, price_per_char_usd})` — defaults to tts-1 / alloy / ~$0.000015/char
- All three share the `synth(beat, opts) → {audio_ref, actual_duration_ms, cost_usd, voice_metadata?}` contract
- Stub duration estimate: word count × 400ms (150wpm fallback)

### `cognitive-engine/training-videos/providers/capture.js` (new, ~100 lines)
- `createNullCaptureBackend` — marker file, 0×0 dimensions, cost=0
- `createStubPuppeteerBackend({width, height, price_per_capture_usd})` — default 1280×720 / $0
- `createStubPlaywrightBackend(...)` — same contract, different id
- All share `capture(cue, opts) → {image_ref, width, height, cost_usd?}` contract

### `cognitive-engine/training-videos/providers/stitcher.js` (new, ~95 lines)
- `createNullStitcher` — marker video + thumb + passes captions_srt through
- `createStubFfmpegStitcher({resolution, format, price_per_sec_usd})` — emits an ffmpeg plan JSON (17-B reads this and invokes real ffmpeg); default 1280×720 / mp4 / $0
- Shared contract: `assemble({beats, transitions, captions_srt, output_dir}) → {mp4_ref, thumbnail_ref?, duration_ms, cost_usd?}`

### `cognitive-engine/training-videos/providers/registry.js` (new, ~70 lines)
- `createProviderRegistry({defaults=true})` — returns `{register, get, has, list, resolve, categories}`
- Defaults register 3 TTS + 3 capture + 2 stitcher backends (8 total)
- `register` validates each instance against its category's required method (`synth` / `capture` / `assemble`)
- `resolve({tts, capture, stitcher})` — turns a ProviderChoice into concrete instances

### `cognitive-engine/training-videos/store.js` (new, ~145 lines)
- `reserve(projectId)` → `{id, renderDir, subdirs: {audio, capture}, logPath}` — creates the render dir + subdirs + empty log
- `appendLog(renderDir, entry)` — stamps `at` then appends JSON line
- `commit(projectId, record)` — atomic manifest write (temp + rename)
- `readManifest(projectId, id)` / `readLog(projectId, id)` / `list(projectId)` — newest-first over committed renders only
- `stats(projectId)` — total + by_status + total_cost_usd + total_duration_ms

### `cognitive-engine/training-videos/renderer.js` (new, ~160 lines)
- `renderVideo({phase17, providers, renderDir, subdirs, appendLog?, onProgress?})` → `{status, beats, duration_ms, cost_usd, mp4_ref, thumbnail_ref?, captions_ref?, degraded?, error?}`
- Three stages per beat: TTS → capture (if cue) → (outside loop) stitch
- **Beat-level failure isolation (D156)**: failed beats stamp `ok: false` with `error`; successful-only subset passed to stitcher; `degraded: true` when any beat fails
- **Emits progress events** (`start` / `beat` / `stitch` / `end`) via injected `onProgress`
- **Append-only log** via injected `appendLog` — every TTS / capture / stitch stage logged with duration + cost + provider id

### `cognitive-engine/training-videos/pipeline.js` (new, ~95 lines)
- `renderFromPhase17Payload({project_id, script_id, phase17, providerChoice, store, registry, onProgress?, storyboard_id?, meta?})` — primary entry point
- `renderFromScript({scriptRecord, scriptContent, renderVoiceoverForPhase17, storyboardRecord?, providerChoice, store, registry, onProgress?})` — convenience wrapper that accepts Phase 16-A training-gen records directly via injected renderer function (no hard dependency)
- Handles catastrophic renderer errors → writes `failed` manifest with error message

### `cognitive-engine/training-videos/smoke-test.js` (new, ~470 lines)
- **91 assertions across 13 test groups**:
  - types (7)
  - TTS providers (10) — null + elevenlabs + openai; cost ordering proven
  - capture backends (7) — null + puppeteer + playwright; configurable dimensions
  - stitchers (6) — null + ffmpeg; plan JSON; SRT writeout
  - provider registry (10) — 3 categories × defaults; interface validation; resolve errors
  - store reserve + commit + log + stats (13)
  - renderer happy path (13) — status + beats + 3 TTS logs + 3 capture logs + 1 stitch log + progress events + assets on disk
  - renderer degraded (4) — one beat fails → status=degraded + flag set + 2 ok beats
  - renderer all-beats-fail (2) — status=failed + error names cause
  - renderer empty-payload (2) — fails fast
  - pipeline renderFromPhase17Payload (10) — manifest + log + progress events
  - pipeline renderFromScript (7) — **real E2E through Phase 16-A training-gen** (runs the training-gen pipeline, fetches the voiceover_script via readLatest, renders the video)
  - pipeline validation (2)

### `cognitive-engine/training-videos/README.md` (new)
- Status, layout diagram, provider contract, API, custom-provider swap example, smoke summary, decisions, 17-B/17-C preview

### `cognitive-engine/admin-substrate/registry.js` (modified)
- Added `USE_TRAINING_VIDEOS` flag (11 total now)
- Admin smoke test updated (10 → 11) — 41 assertions still pass

### Unchanged
- Graph files (`dev_graph.js`, `factory_graph.js`, `post_dev_graph.js`, `pre_dev_graph.js`), `tools.js`, `telemetry.mjs`
- All prior A-tier modules: `training-gen` (Phase 16), `self-improvement` (15), `concurrency` (14), `replay` (13), `admin-substrate` core (12), `cost-tracker` (11), `courier` (10), `verify-integration` (9), `parallel` (8), `memory-layer` (7), `artifacts` (6), `mcp` (5)
- Zero regression risk

## Smoke test highlight

```
[pipeline — renderFromScript wired to Phase 16-A training-gen]
  ✓ training-gen produced voiceover + storyboard
  ✓ voiceover record fetched
  ✓ real-voiceover E2E status done
  ✓ video references training TART id
  ✓ project_id propagated
  ✓ null providers produce $0 cost
  ✓ beat count matches script

[smoke] OK  — 91 assertions
```

## Why 17-B deferred

17-B = **real backends + production wiring**. Requires:

- **Real ElevenLabs / OpenAI TTS** — actual audio files, actual durations, actual cost (needs credentials + credit)
- **Real Puppeteer / Playwright** — browser binaries, network access to capture cues' URLs, headless Chromium managed across renders
- **Real ffmpeg stitcher** — child_process or fluent-ffmpeg consuming the existing plan JSON (binary available on every factory VM)
- **Phase 14-A handler** — `register("training_video_render", async (job) => renderFromScript({...job.payload}))` so videos render async
- **Phase 9 Verify integration** — reviewer approval gate before publish; feedback loops back as memory observations for 15-B
- **Cloud storage upload** (S3/R2) for published mp4 + thumbnail
- **Retries with backoff** for transient provider failures
- **Phase 11-A budget gate** — pre-flight cost estimate; abort if projected spend > hard_cap_usd

Ship 17-A as the firm substrate; 17-B layers real backends on a tested contract.

## Feature-flag posture

| Flag | Default | Effect |
|---|---|---|
| (existing 10 flags ...) | off | Phases 4-16 |
| `USE_TRAINING_VIDEOS` | off | Phase 17-B onwards: training_video_render jobs dispatched via Phase 14 queue; 17-A library only |

## Phase 17-A exit criteria — met

- ✅ `training-videos/` scaffolded (types, providers/, store, renderer, pipeline, smoke-test, README)
- ✅ 8 provider backends registered as defaults (3 TTS + 3 capture + 2 stitcher); DI registry validates each (D154)
- ✅ Renderer orchestrates TTS × beats + capture × beats + stitch with progress events + beat-level failure isolation (D156)
- ✅ Pipeline consumes real Phase 16-A training-gen output end-to-end; produces a VideoArtifact + asset dir
- ✅ Store supports reserve → commit lifecycle with atomic manifest writes + append-only log
- ✅ Cost aggregation per provider call; summed onto VideoArtifact (D157)
- ✅ $0 cost (no external API calls) — matches D158
- ✅ **91 smoke-test assertions all pass**
- ✅ `USE_TRAINING_VIDEOS` flag registered; admin-substrate smoke still green (41 assertions)
- ✅ No changes to graph files, training-gen (Phase 16-A), memory-layer, concurrency, replay, artifacts, self-improvement, or other modules
- ✅ Phase docs: Plan (expanded), Status, Decisions (D153-D158), Lessons
- ⏳ 17-B real backends + Phase 14/9 wiring + cloud upload + retries deferred

Phase 17-A is **wired, tested, and ready**. Substrate is firm — 17-B brings real pixels and sound.
