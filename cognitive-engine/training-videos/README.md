# Training Videos (Phase 17-A)

Consume Phase 16-A's voiceover_script + video_storyboard and render them as training videos. TTS, screen capture, and stitching are all pluggable provider backends; 17-A ships null + stub variants so the whole pipeline works offline at $0.

## Status: Phase 17-A scaffolding

**91 smoke-test assertions pass**, including end-to-end through Phase 16-A's training-gen (real `runTrainingPipeline` → `renderFromScript` → committed VideoArtifact). **No external API calls, $0 cost, no graph changes.** 17-B swaps real ElevenLabs / Puppeteer / ffmpeg behind the same interface.

## Files

- `types.js` — VideoArtifact, RenderStatus (5), ProviderChoice, RenderJobInput, BeatRenderLog, RendererProgressEvent JSDoc
- `providers/tts.js` — `createNullTtsProvider`, `createStubElevenLabsProvider`, `createStubOpenAiProvider`
- `providers/capture.js` — `createNullCaptureBackend`, `createStubPuppeteerBackend`, `createStubPlaywrightBackend`
- `providers/stitcher.js` — `createNullStitcher`, `createStubFfmpegStitcher`
- `providers/registry.js` — `createProviderRegistry({defaults})` with 3 categories
- `store.js` — `createVideoStore(rootDir)`: reserve / appendLog / commit / readManifest / readLog / list / stats
- `renderer.js` — `renderVideo({phase17, providers, renderDir, subdirs, appendLog?, onProgress?})`; failure-tolerant at beat level
- `pipeline.js` — `renderFromPhase17Payload` + `renderFromScript` (injects Phase 16-A `renderVoiceoverForPhase17`)
- `smoke-test.js` — 91 assertions across 13 test groups

## Layout

```
<workspace_root>/_videos/
  └── <project_id>/
      ├── _seq                          per-project monotonic counter
      ├── VID-0001/
      │   ├── manifest.json             authoritative VideoArtifact record
      │   ├── render-log.jsonl          append-only per-stage events
      │   ├── video.<ext>               final (or stub manifest) mp4
      │   ├── thumbnail.<ext>
      │   ├── captions.srt              from Phase 16-A renderer
      │   ├── audio/BEAT-*.{wav,json}   per-beat TTS output
      │   └── capture/BEAT-*.{png,json} per-beat screen captures
      └── VID-0002/ …
```

`manifest.json` is the VideoArtifact record. Asset paths inside are relative to the VID dir.

## Render lifecycle

```
Phase 16-A voiceover_script / video_storyboard
        │
        ▼
  Phase17Payload via training-gen/renderer.js::renderVoiceoverForPhase17
        │
        ▼
  renderFromPhase17Payload({project_id, script_id, phase17, providerChoice, ...})
        │
        ▼
  store.reserve(project_id)  →  { id: VID-NNNN, renderDir, subdirs }
        │
        ▼
  renderVideo orchestrates:
    for each beat in phase17.narration:
       providers.tts.synth(beat)       → audio_ref  (degrades on failure)
       providers.capture.capture(cue)  → image_ref  (degrades on failure)
    providers.stitcher.assemble({ok_beats, transitions, captions_srt})
        │
        ▼
  store.commit(project_id, manifest)
        │
        ▼
  VideoArtifact   status: done | degraded | failed
```

## Provider interfaces (D154)

Three categories, each with `id` + one method. 17-A ships null + two stub variants per category:

| Category | Method | 17-A variants | 17-B targets |
|---|---|---|---|
| `tts` | `synth(beat, opts)` | null · stub-elevenlabs · stub-openai | real ElevenLabs · real OpenAI · Synthesia/HeyGen |
| `capture` | `capture(cue, opts)` | null · stub-puppeteer · stub-playwright | real Puppeteer · real Playwright |
| `stitcher` | `assemble({beats, transitions, captions_srt, output_dir})` | null · stub-ffmpeg | real ffmpeg (child_process or fluent-ffmpeg) |

### Registry

```js
import { createProviderRegistry } from "./training-videos/providers/registry.js";

const registry = createProviderRegistry();   // 3 tts + 3 capture + 2 stitcher defaults

// Swap in a real backend later:
registry.register("tts", myRealElevenLabsInstance);     // { id, synth }
registry.register("capture", myRealPuppeteerInstance);  // { id, capture }
registry.register("stitcher", myRealFfmpegInstance);    // { id, assemble }
```

RenderJob carries provider *ids* (`{tts, capture, stitcher}`) — serialisable for Phase 14-A queueing. Registry resolves ids to instances at render time.

## API

```js
import { createVideoStore } from "./training-videos/store.js";
import { createProviderRegistry } from "./training-videos/providers/registry.js";
import { renderFromPhase17Payload, renderFromScript } from "./training-videos/pipeline.js";
import { renderVoiceoverForPhase17 } from "./training-gen/renderer.js";

const store = createVideoStore("/path/to/workspace");
const registry = createProviderRegistry();

// Option A — already-computed Phase-17 payload
const video = await renderFromPhase17Payload({
  project_id: "todo-app",
  script_id: "TART-0007",             // Phase 16-A voiceover TART id
  phase17,                             // { narration, capture_plan, transitions, captions_srt, total_duration_ms }
  providerChoice: {
    tts: "tts:stub:elevenlabs:rachel",
    capture: "capture:stub:puppeteer:1280x720",
    stitcher: "stitcher:stub:ffmpeg:1280x720",
  },
  store, registry,
  onProgress: (evt) => console.log(evt),
});

// Option B — training-gen record directly
const video2 = await renderFromScript({
  scriptRecord,                        // training-gen voiceover_script record
  scriptContent,                       // training-gen voiceover_script content
  storyboardRecord,                    // optional video_storyboard record
  renderVoiceoverForPhase17,           // injected from training-gen/renderer.js
  providerChoice,
  store, registry,
});

// Result shape (VideoArtifact)
// {
//   id: "VID-0001",
//   project_id: "todo-app",
//   script_id: "TART-0007",
//   status: "done",                          // or "degraded" / "failed"
//   providers: { tts, capture, stitcher },
//   beats: [{ id, audio_ref, capture_ref, duration_ms, ok }, ...],
//   mp4_ref: "video.stub.mp4.json",
//   thumbnail_ref: "thumbnail.stub.png.json",
//   captions_ref: "captions.srt",
//   duration_ms: 13500,
//   cost_usd: 0.0123,
//   degraded: false,
//   created_at: "...", rendered_at: "..."
// }
```

## Failure tolerance (D156)

- Per-beat failures do NOT kill the render. Failed beats are logged to `render-log.jsonl`; successful beats continue.
- If ≥1 beat succeeds, the render completes with `status: "degraded"`. Caller decides whether to republish or re-render the failed beats.
- If ZERO beats succeed, the render hard-fails with `status: "failed"` and a reason on the manifest.
- Stitcher receives only the successful beats plus filtered transitions.

## Smoke test summary

```
$ node cognitive-engine/training-videos/smoke-test.js
[types]                       ✓ 7   (schema, statuses, categories, validators)
[tts providers]               ✓ 10  (null marker, elevenlabs + openai stubs, cost curves)
[capture backends]            ✓ 6   (null, puppeteer, playwright with init opts)
[stitchers]                   ✓ 5   (null + ffmpeg plan JSON + captions write-through)
[provider registry]           ✓ 11  (3 categories, invalid-category/method guards, resolve, unknown-id throws)
[store reserve + commit]      ✓ 14  (ids, renderDir, validation, manifest+log roundtrip, stats)
[renderer happy path]         ✓ 12  (status, cost, mp4 + assets on disk, progress events)
[renderer degraded]           ✓ 4   (1 of 3 beats fails → status=degraded, degraded flag set)
[renderer all fail]           ✓ 2   (status=failed, error message)
[renderer empty narration]    ✓ 2   (fast fail, error message)
[pipeline — payload]          ✓ 10  (VID id, manifest on disk, progress events, pipeline log)
[pipeline — from script]      ✓ 7   (real Phase 16-A pipeline → Phase 17 render E2E)
[pipeline — validation]       ✓ 2   (missing project_id + missing provider choice rejected)

[smoke] OK  — 91 assertions
```

## Feature flag

```
USE_TRAINING_VIDEOS=true     Phase 17-B onwards: post-dev graph enqueues training_video_render jobs
                             Phase 17-A: no runtime effect; library only
```

## Design decisions

- **D153** — Per-render directory `<workspace>/_videos/<project_id>/VID-NNNN/` with `audio/` + `capture/` subdirs, a single `manifest.json`, and an append-only `render-log.jsonl`. Matches Phase 16's `_training/` + Phase 14's `_jobs/work/` conventions.
- **D154** — Three provider categories (tts/capture/stitcher), each with its own registry. RenderJob carries provider *ids*, not functions — jobs are serialisable through Phase 14-A queue.
- **D155** — `null` + `stub` backends per category in 17-A. `null` writes markers; `stub` writes realistic metadata (estimated durations, resolution, cost). Tests choose either.
- **D156** — Failure-tolerant at beat level. One failed beat degrades the render; all-failed hard-fails. Stitcher sees only successful beats.
- **D157** — Cost aggregated per call, summed on the VideoArtifact, logged per-beat. Phase 11-A cost rollup can attribute spend to `training_video_render`.
- **D158** — 17-A emits zero external API calls. $0 cost, offline-capable, deterministic tests.

## Rollback

17-A has no runtime hooks. `USE_TRAINING_VIDEOS` defaults off; nothing consumes the library yet. Removal = `rm -rf cognitive-engine/training-videos/` + unregister flag. Phase tag `phase-17a-closed` is the rollback anchor.

## What 17-B adds

- **Real ElevenLabs client** (character-tier billing, voice selection, model fallback)
- **Real Puppeteer / Playwright backend** (headless Chromium/Firefox/WebKit; waits; retries on network blips)
- **Real ffmpeg stitcher** (child_process spawn; filter_complex concat + audio overlay + SRT mux)
- **Post-dev graph handler** — Phase 14-A registers `training_video_render`; scheduled per-project fairness
- **Provider budget gate** — Phase 11-A hook: refuse render if project over `hard_cap_usd`
- **Cloud storage upload** (S3/R2) for publishing; manifest stamped with the public URL
- **Verify portal integration** — reviewer scrubs the video before publish; edits propagate to `_prompt-overrides/` via Phase 15
- **Retry policy** per provider (exponential backoff with jitter)

## What 17-C (or later) may add

- **Cloud browser services** (Browserless, Browserbase) for capture when local Chromium isn't viable
- **Synthesia / HeyGen** as alternate TTS+capture bundled backends (Principle 1 comparison)
- **Live-preview mode** — renderer emits a single beat's audio+capture before committing so reviewers can iterate
- **Multi-language audio tracks** — synth narration in N languages, stitcher muxes selectable audio
