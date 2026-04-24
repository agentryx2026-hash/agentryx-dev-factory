# Phase 17 — Training Videos

**One-liner**: Consume Phase 16's voiceover_script + video_storyboard and render them as published training videos — narrated audio + headless-browser screen capture stitched via ffmpeg into mp4. Configurability-first: TTS provider (ElevenLabs / OpenAI / Synthesia / HeyGen / null), capture backend (Puppeteer / Playwright / null), and stitcher (ffmpeg / null) all behind provider interfaces. Phase 17-A ships the substrate with **fake providers** that produce valid manifests without external APIs; 17-B swaps in real backends when credentials + OpenRouter/ElevenLabs credit are available.

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 ("read existing code before scoping"):

- **Phase 16-A already defined the handoff.** `renderVoiceoverForPhase17(record, content)` returns `{narration[], capture_plan[], transitions[], captions_srt, total_duration_ms}` — exactly the four inputs a video pipeline needs. No schema negotiation required.
- **Phase 14-A concurrency engine** is the natural scheduler. `kind: "training_video_render"` enqueues a render job; per-project fairness already exists. 17-B wires the handler; 17-A's pipeline can be invoked directly or queued — both work.
- **Phase 6-A artifact store** accepts arbitrary binary content via `content_ref`. Video assets (mp4, wav, srt) land cleanly as artifacts once 6-B dual-write is live. 17-A keeps its own `_videos/` store meanwhile — same pattern as training-gen's `_training/`.
- **Phase 11-A cost tracker** — each provider call has a `cost_usd`. Renderer aggregates per-job cost + stamps it onto the VideoArtifact so Phase 11 can roll up.
- **Phase 12-A admin substrate** — provider choice per category (`tts_provider`, `capture_backend`, `stitcher`) belongs in a new `training_video_config` entry in the config registry. 17-A defines the schema; 17-B wires UI.
- **Hermes evaluation (Phase 2.75)** noted video-related tools may use Hermes for specialised pipelines. Keeping providers DI'd means Hermes integration is one registration call.

## Design

```
Phase 16-A voiceover_script + video_storyboard
        │
        ▼
  RenderJob  { project_id, script_id, providers, output_dir, callbacks }
        │
        ▼
  renderer (fan-out)
   ├── ttsProvider.synth(beat) → { audio_ref, duration_ms, cost_usd } per beat
   ├── captureBackend.capture(beat.screen_capture) → { image_ref, size } per beat
   └── (captions_srt already provided by Phase 16 renderer)
        │
        ▼
  stitcher.assemble({ audio_refs, capture_refs, transitions, captions_srt })
        │
        ▼
  VideoArtifact  { id: "VID-NNNN", mp4_ref, thumbnail_ref, duration_ms, cost_usd, beats }
        │
        ▼
  _videos/<project_id>/VID-NNNN/
     ├── video.mp4                (final output; fake manifest in 17-A)
     ├── audio/BEAT-1.wav         (per-beat TTS output)
     ├── capture/BEAT-1.png
     ├── captions.srt
     ├── manifest.json            (VideoArtifact record + asset map)
     └── render-log.jsonl         (per-beat events + timings)
```

### Provider interfaces

**TtsProvider**
```ts
interface TtsProvider {
  id: string;                                    // e.g. "tts:elevenlabs:rachel"
  synth(beat: { id, narrator_text, target_duration_ms }): Promise<{
    audio_ref: string,                           // relative path inside render dir
    actual_duration_ms: number,
    cost_usd: number,
    voice_metadata?: object,
  }>;
}
```

**CaptureBackend**
```ts
interface CaptureBackend {
  id: string;                                    // e.g. "capture:puppeteer:chromium"
  capture(cue: ScreenCaptureCue, opts): Promise<{
    image_ref: string,                           // PNG/JPG path
    width: number,
    height: number,
    cost_usd?: number,                           // 0 for local; >0 for cloud-hosted browser services
  }>;
}
```

**Stitcher**
```ts
interface Stitcher {
  id: string;                                    // e.g. "stitcher:ffmpeg"
  assemble({ beats, audio_refs, capture_refs, transitions, captions_srt, output_path }): Promise<{
    mp4_ref: string,
    thumbnail_ref?: string,
    duration_ms: number,
    cost_usd?: number,
  }>;
}
```

17-A ships three "null" providers (marker files only, $0) and three "fake" providers (populate metadata realistically, still no external API). All three satisfy the same interface — 17-B swaps in ElevenLabs / Puppeteer / ffmpeg without renderer changes.

## Scope for this phase (17-A: substrate)

Mirrors 5-A through 16-A pattern.

| Sub | What | Deliverable |
|---|---|---|
| 17-A.1 | `training-videos/types.js` — VideoArtifact, RenderJob, RenderStatus, provider-interface JSDoc | ✅ |
| 17-A.2 | `training-videos/providers/` — 3 TTS backends (elevenlabs-stub, openai-stub, null) + 3 capture backends (puppeteer-stub, playwright-stub, null) + 2 stitchers (ffmpeg-stub, null) | ✅ |
| 17-A.3 | `training-videos/store.js` — per-project video artifact store with per-render asset directory | ✅ |
| 17-A.4 | `training-videos/renderer.js` — orchestrates TTS × beats + capture × beats + stitch; emits progress events; aggregates cost | ✅ |
| 17-A.5 | `training-videos/pipeline.js` — training-gen record → renderer → store; idempotent; returns VideoArtifact | ✅ |
| 17-A.6 | Smoke test — full flow using Phase 16-A voiceover output + null/fake providers | ✅ |
| 17-A.7 | `training-videos/README.md` + `USE_TRAINING_VIDEOS` flag doc | ✅ |

**Out of scope for 17-A** (deferred to 17-B/C):

- Real ElevenLabs / OpenAI / Synthesia / HeyGen API integration
- Real Puppeteer / Playwright browser automation (binaries, screenshots)
- Real ffmpeg invocation (node-fluent-ffmpeg or subprocess)
- Post-dev graph handler via Phase 14-A queue
- Verify portal integration (human review of rendered video before publish)
- Cloud storage upload (S3/R2) for publishing
- Retries on provider failure (caller-responsibility in 17-A; engine in 17-B)
- Provider cost budgeting gate (Phase 11-A integration; 17-B)

## Why this scope is right

- **The provider interface is the durable artifact.** 17-B's real backends swap behind it without renderer changes. The interface is the bet; fake providers prove the bet.
- **Phase 16-A hand-off is already typed.** `renderVoiceoverForPhase17` gives the renderer exactly the five fields (narration, capture_plan, transitions, captions_srt, total_duration_ms) it needs. 17-A just has to orchestrate those into a VideoArtifact.
- **Stitcher doesn't need to invoke ffmpeg in 17-A** — it produces a manifest describing the cuts, audio overlay, and caption timing. 17-B replaces the manifest with a real encoded mp4. All consumers (Verify portal, dashboards) can already work with the manifest.
- **Matches 15-A / 16-A pattern**: standalone store, DI'd providers, $0 cost, zero graph changes.

## Phase close criteria

- ✅ `training-videos/` scaffolded (types, providers/, store, renderer, pipeline, smoke-test, README)
- ✅ 8 provider backends (3 TTS + 3 capture + 2 stitchers) all satisfy their interfaces
- ✅ Renderer orchestrates a voiceover_script through TTS × beats + capture × beats + stitch, emits progress events, aggregates cost
- ✅ Pipeline consumes a Phase 16-A voiceover_script store record end-to-end; produces a VideoArtifact + per-render asset directory
- ✅ Smoke test: full flow with ≥80 assertions; provider swap proven; failure isolation proven
- ✅ `USE_TRAINING_VIDEOS` flag documented (no runtime effect in 17-A)
- ✅ No changes to graph files, training-gen (Phase 16-A), memory layer, concurrency engine, or admin substrate core
- ✅ Phase docs: Plan (expanded), Status, Decisions (D153-Dxx), Lessons

## Decisions expected

- **D153**: Video artifacts live in `<workspace>/_videos/<project_id>/VID-NNNN/` with a per-render asset directory (audio/, capture/, manifest.json, render-log.jsonl). Matches Phase 16's `_training/` and Phase 14's `_jobs/work/` conventions.
- **D154**: Three provider categories (TTS / capture / stitcher), each with its own registry. RenderJob carries the *ids* of the chosen providers, not functions — makes jobs serialisable for Phase 14-A queueing.
- **D155**: 17-A ships both "null" and "stub" backends per category. `null` writes a marker file only; `stub` writes realistic metadata (duration derived from word count, 720p default capture dimensions, cost pulled from a small price table). Tests can choose which to use.
- **D156**: Renderer is failure-tolerant at beat level — one bad beat doesn't kill the render. Failed beats are recorded with `ok: false` in render-log; stitcher receives only the successful subset and stamps `degraded: true` on the VideoArtifact. Caller decides whether to republish or retry.
- **D157**: Cost is aggregated per provider call, summed onto the VideoArtifact, and logged per-beat. Phase 11-A cost rollup can attribute spend to `training_video_render` kind.
- **D158**: 17-A emits zero external API calls. 100% of 17-A runs cost $0 and work offline. Same discipline as 15-A / 16-A.
