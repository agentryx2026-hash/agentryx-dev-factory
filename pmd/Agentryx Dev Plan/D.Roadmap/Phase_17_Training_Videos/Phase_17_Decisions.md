# Phase 17 — Decisions Log

## D153 — Per-render asset directory under `_videos/<project_id>/VID-NNNN/`

**What**: Each render gets its own directory containing `manifest.json` + `render-log.jsonl` + `audio/` + `capture/` subdirs + stitcher outputs. The manifest is the authoritative VideoArtifact; every asset is referenced by relative path.

**Why**:
- **Atomic rollback**: removing `VID-0042/` undoes exactly one render. No cross-talk with other renders of the same project.
- **Ops debugging** — `ls -la VID-0042/` shows every piece of the render at a glance. `cat render-log.jsonl` walks the timeline. Matches Phase 14's `_jobs/work/` and Phase 16's `_training/` discipline.
- **Per-render asset volumes** — audio files, images, and the final mp4 all belong to one render. Grouping keeps them together; removing a render removes all its assets in one directory operation.
- **Cloud upload (17-B) is a trivial walk** of the directory — no complex manifest splitting.

**Tradeoff**: duplicated asset bytes across renders if the same voiceover is rendered twice (e.g., tuned cost comparison). Accept it; R&D isn't about storage economy. 17-C can add asset de-dup if it becomes a real concern.

## D154 — Three provider categories, each with its own registry. RenderJob carries provider *ids*

**What**: Categories are `tts` / `capture` / `stitcher`. Each category has a keyed map. A RenderJob's `providerChoice` is `{tts: "tts:stub:elevenlabs:rachel", capture: "capture:stub:puppeteer:1280x720", stitcher: "stitcher:stub:ffmpeg:1280x720"}` — three strings, not three functions.

**Why**:
- **Serialisable jobs**: Phase 14-A's concurrency queue passes JSON payloads between enqueue and handler. Function references would need rehydration per worker; ids don't.
- **Audit trail**: the manifest records which provider produced each render. "Which ElevenLabs voice produced this video?" is answered by reading the provider id in one field.
- **Three categories, not one registry**: the contracts are distinct (`synth` vs `capture` vs `assemble`), so splitting keeps each registry's type signature clean and the interface validation (`typeof instance.synth === "function"`) sharp.
- **Same DI rhythm** as Phase 9-A `fixRouter`, Phase 13-A `nodeStubs`, Phase 14-A `handlerRegistry`, Phase 15-A proposer, Phase 16-A generators. Fourth time we've done this; pattern is proven.

## D155 — Two fidelity tiers per category: `null` + `stub:<backend>`

**What**: Every category ships a `null` backend (writes a marker file, $0, zero metadata) and one or more `stub:<backend>` variants that simulate realistic metadata (durations estimated from word count; costs from rough pricing tables).

**Why**:
- **Tests pick fidelity** — the 91 assertions span "manifest integrity with null" (lowest overhead) to "stub cost ordering is ElevenLabs > OpenAI" (moderate fidelity). Neither extreme forces the other.
- **17-B migration is mechanical** — real providers replace stubs one at a time. Smoke tests written against stubs keep running (the interface is stable); real tests come online as real backends connect.
- **Cost modeling lives in stubs**, not in the renderer. Swapping a provider model (e.g., ElevenLabs Creator tier → Pro tier) changes one line in the provider factory, not the orchestration.
- **Demos without credentials** — `null` providers let anyone run the full E2E smoke test with no external accounts. Important for new contributors.

## D156 — Beat-level failure isolation; fail hard only when all beats fail

**What**: When a TTS or capture call throws for beat N, the renderer records `beats[N].ok = false` with the error message and continues with beat N+1. After the loop, if zero beats succeeded, the render status is `failed`. If ≥1 succeeded but <all did, status is `degraded` and `degraded: true` is stamped on the VideoArtifact. Stitcher receives only the successful subset.

**Why**:
- **Real-world TTS / capture calls fail intermittently**: ElevenLabs rate limits, Puppeteer page timeouts, network blips. A render that burns 19 successful API calls shouldn't discard everything on beat 20.
- **Reviewer workflow**: `degraded` is a meaningful signal — "look at this render, something's off, decide whether to republish or accept." Silent partial success would hide the problem.
- **Retry granularity**: 17-B can retry just the failed beats (attach them to the successful render), not the whole video.
- **Caller chooses next action**: 17-A doesn't auto-retry. The caller (17-B queue handler; humans in 17-A) decides between degraded-publish, targeted retry, and abandon.

**Tradeoff**: rendering continues even when it might be cheaper to abort early (e.g., every beat fails due to expired API key). Acceptable — renderer stays simple; Phase 11-A budget gate in 17-B catches pathological cost scenarios.

## D157 — Cost aggregated per provider call and summed on the VideoArtifact

**What**: Each provider returns `cost_usd`. The renderer sums per-beat TTS + per-beat capture + stitcher costs and stores the total on the VideoArtifact. Each per-call cost is also logged in `render-log.jsonl`.

**Why**:
- **Phase 11-A rollup integration is trivial**: cost-tracker can scan `render-log.jsonl` entries or read `manifest.cost_usd` directly. Either granularity works.
- **Per-provider attribution** — reviewers ask "which provider drove this cost?"; the log answers per beat.
- **Parity with Phase 2 pattern**: per-call cost capture is a foundation principle. Video generation is another cost source; same treatment.
- **Self-improvement (Phase 15)** can propose provider swaps with evidence ("Switching to OpenAI TTS saves $0.12 per render based on last 30 runs").

## D158 — Zero external API calls in 17-A

**What**: Every provider in 17-A writes local files only. No network. Every renderer run costs $0 and works offline.

**Why**:
- **Matches 15-A / 16-A discipline**: R&D ships substrate at $0. Real backends layer in later when credentials + credit are available.
- **Deterministic smoke tests**: 91 assertions are stable because stub output is a pure function of input.
- **Demos run anywhere**: a fresh clone can `node cognitive-engine/training-videos/smoke-test.js` without any setup.
- **17-B migration is additive**: swap one provider at a time from stub → real; existing tests keep passing, new tests verify the real-backend-specific behavior.

## D220 — 17-B Tier B: training_video_render handler as its own module + all-null providerChoice default (added 2026-05-11)

**What**: Phase 17-B Tier B registers `training_video_render` as a Phase 14-A queue kind via a dedicated module (`cognitive-engine/concurrency/handlers/training-video-handler.js`). Same separation pattern as D211 / D217 / D219 (one handler module per domain). Default `providerChoice` is all-null backends (`{tts: "null", capture: "null", stitcher: "null"}`); real backends become opt-in per-job via payload.

**Why default to all-null providers**:
- **Substrate ships at $0 with no credentials**. ElevenLabs / Puppeteer / ffmpeg can all land independently when keys/binaries arrive; the queue is live before any of them.
- **Per-job override is the natural opt-in**: payload `providerChoice: { tts: "elevenlabs" }` flips one backend without env vars. Mirrors how Phase 21-B's dispatcher is per-cadence (D209): production-grade choice should sit at the call site, not a global flag.
- **Partial overrides merge**: caller can flip `tts` to a real backend while keeping `capture` + `stitcher` on stubs (useful during incremental rollout).

**Why a separate handler module (not extending factory-handlers.js)**:
- Same reasoning as D211 / D217 / D219 — domain separation. Video rendering is a different concern than pipeline graph dispatch.
- Test isolation: 31 assertions stub every Phase 17-A dep; no real providers / store touched. Iterations on the handler stay fast.

**Why no flag gates the substrate registration**:
- The handler is dormant until enqueued. Today no caller enqueues — Phase 17-A's pipeline is invoked directly by callers (none in v0.0.1 yet) or via the post-dev graph extension (full 16-B + 17-B integration).
- Adding a flag would force every test environment to flip it explicitly with no behaviour win — same posture as D219.

**Coordination with D219 (training_gen handler)**: both kinds land as siblings off `phase/14-b-queue-handlers`. Once both merge, the natural job chain is `training_gen → training_video_render`: post-dev graph enqueues `training_gen`; on completion, a wrapper enqueues `training_video_render` with the produced script's `phase17` payload. The wrapper itself is full-17-B work.

**Tradeoff acknowledged**: the substrate is wire-only; nothing in the factory enqueues `training_video_render` today. Acceptable: same posture as D219; behaviour change waits for full integration.
