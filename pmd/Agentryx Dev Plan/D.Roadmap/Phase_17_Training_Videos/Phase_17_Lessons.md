# Phase 17 — Lessons Learned

Phase 17-A closed: 2026-04-24. Duration: single session (same arc as 15-A / 16-A — three A-tier modules in two days).

## What surprised us

1. **Phase 16-A did 80% of Phase 17-A's design work.** The voiceover beat schema already carried narrator text, duration, screen-capture cue, and transition — exactly the four inputs a video pipeline consumes. Phase 17's renderer is mostly "for each beat, call TTS then capture, then hand the list to the stitcher." The real engineering question — "what does a voiceover script look like?" — was answered one phase earlier. This is the payoff of D149: the contract is durable; everything downstream is mechanical.

2. **Provider categories split cleanly into three.** First instinct was one unified `backend` interface. Second look: `synth` (produces audio), `capture` (produces image), `assemble` (combines everything into a video) are fundamentally different — different inputs, different outputs, different failure modes. Keeping them as three separate registries kept each contract minimal. Trying to unify them would have created a `backend.execute(stage, input)` dispatcher — more abstract, less clear.

3. **Beat-level failure isolation is simpler than I expected.** Two lines: `catch (err) { beat.ok = false; beat.error = ... }`. One decision: do we pass failed beats to the stitcher or not? (Answer: no — `successful.filter(b => b.ok)`.) One status: `degraded`. That's it. The hardest part was picking the right names.

4. **Real E2E test through Phase 16-A training-gen was one import away.** The training-gen pipeline produces a `voiceover_script` record + content; the training-gen renderer's `renderVoiceoverForPhase17(record, content)` returns the payload 17-A needs. Smoke test imports both, runs the training-gen pipeline, reads the latest, feeds it into 17-A. Seven assertions validate the full chain. The payoff of aligned contracts across phases.

## What to do differently

1. **Progress events are minimal today.** `{type: "beat", beat_id, stage, progress}` — useful but coarse. 17-B may want finer-grained "uploading audio", "launching browser", "waiting for selector" sub-events. That's a provider-internal concern though — they can emit via `opts.onStageProgress` if needed. Defer.

2. **Stitcher's plan JSON is only useful if 17-B reads it.** Risk: if 17-B's real ffmpeg invocation is written fresh ignoring the plan, the stub plan JSON is dead code. Mitigation: document the plan shape and make `ffmpegStitcher.assemble` factor out `buildPlan` → `executePlan`. For now it's a single function; note for 17-B.

3. **No cross-render caching.** If the same voiceover_script is rendered twice with the same TTS provider, it re-synthesizes all beats. In 17-B with real API calls this matters. Simple mitigation: cache by `sha256(provider_id + beat.narrator_text)` → audio file; check cache before calling `synth`. Defer to 17-B where it has measurable cost.

4. **Renderer reads `capture_plan` by linear scan** for every beat (`capture_plan.find(c => c.beat_id === ...)`). Fine for 10-beat videos; O(n²) for long ones. If 17-B renders videos with 100+ beats, build a Map once at renderer entry. Defer until measured.

## What feeds next phases

### Phase 17-B (deferred) — real backends + production wiring
- **ElevenLabs integration** — real `synth` against the v1/text-to-speech API; mp3 output
- **OpenAI TTS integration** — real `synth` against `audio/speech` endpoint
- **Puppeteer launcher** — headless Chromium per render; persistent browser across beats; network waits; selector targeting
- **Playwright alternative** — same contract, for cross-browser comparison under Principle 1
- **ffmpeg invocation** — `child_process.spawn` (or `fluent-ffmpeg`) reading the stitcher's plan JSON → real mp4 + ffmpeg thumbnail
- **Phase 14-A handler registration** — `register("training_video_render", async (job) => renderFromScript({...}))`
- **Phase 11-A pre-flight cost gate** — estimate from beat count × avg chars × provider pricing; abort if projected > hard_cap_usd
- **Retries with backoff** — transient network / rate-limit failures retry with jitter; permanent errors (invalid voice_id, 403) fail fast
- **Cloud storage upload** — on status=`done|degraded`, copy mp4 + thumbnail + captions.srt to S3/R2; rewrite manifest with public URLs
- **Phase 9 Verify integration** — reviewer queues VideoArtifact; approval triggers publish; annotations → memory observations

### Phase 17-C — provider diversity + optimisation
- **Synthesia / HeyGen** — avatar-driven alternatives (different provider category? or under `tts`/`capture` with avatar flag? Design decision for 17-C)
- **Multi-language rendering** — one voiceover × N locales × TTS provider; parallel via Phase 14 queue
- **Automated A/B testing** — Phase 15-B evaluator compares engagement metrics across provider combinations
- **Caption-as-overlay variant** — burned-in vs sidecar; admin-configurable per project
- **Beat-level caching** — content-addressed audio + capture cache; dedup across renders

### Phase 14-B — queue handler
- `kind: "training_video_render"` with payload = RenderJob; handler calls `renderFromScript`
- Per-project fairness (already in 14-A round-robin) naturally extends to video renders
- Long-running videos may need extended lease duration vs default job max
- Cost-aware scheduling: Phase 14-B can read `training_video_config` to pick cheaper providers when budget is tight

### Phase 11-B — Cost dashboard
- Video renders become a new row in the cost rollup (`kind: "training_video_render"`)
- Per-render cost breakdown: TTS chars × rate + capture × rate + stitch-seconds × rate — all already in the manifest/log

### Phase 9-B — Verify integration
- VideoArtifact flows to the reviewer queue; thumbnail + player preview in UI
- Reject → write memory observations that 15-B self-improvement can consume (e.g., "narrator voice too fast on BEAT-3")
- Approve → trigger cloud publish + notify via Phase 10 Courier

### Phase 12-B — Admin UI
- `training_video_config` config entry: default provider per category, per-project overrides, per-render budget cap
- Live admin view of in-flight renders + recent done/degraded/failed with log excerpts

### Phase 15-B — Self-improvement
- Proposer kind `video_provider_change` — "switch capture:stub:puppeteer → capture:real:playwright based on N successful renders + $X cost delta"
- Applier extension: `task:training_videos.tts_provider` target routes to `training_video_config`

## Stats

- **1 session** (shared arc with 15-A and 16-A; three phases closed over two days)
- **$0.00 spent** (null + stub providers; no external API)
- **0 new dependencies** (node built-ins only)
- **10 files created** in `cognitive-engine/training-videos/`: `types.js`, `providers/{tts,capture,stitcher,registry}.js`, `store.js`, `renderer.js`, `pipeline.js`, `smoke-test.js`, `README.md`
- **2 files modified**: `admin-substrate/registry.js` (+1 flag = 11 total), `admin-substrate/smoke-test.js` (10 → 11 counts)
- **0 files modified** in: graph files, `tools.js`, `telemetry.mjs`, training-gen (16-A), self-improvement (15-A), concurrency, replay, artifacts, memory-layer, cost-tracker, courier, verify-integration, parallel, mcp
- **4 phase docs**: Plan (expanded), Status, Decisions, Lessons
- **6 Decisions**: D153-D158

## Phase 17-A exit criteria — met

- ✅ `training-videos/` scaffolded (types, providers/, store, renderer, pipeline, smoke-test, README)
- ✅ 8 provider backends registered as defaults (3 TTS + 3 capture + 2 stitcher); DI registry validates each (D154)
- ✅ Renderer orchestrates 3 stages with beat-level failure isolation (D156); emits start/beat/stitch/end progress events
- ✅ Pipeline consumes real Phase 16-A training-gen records E2E via injected `renderVoiceoverForPhase17`
- ✅ Store: reserve → commit lifecycle, atomic manifest writes, append-only render log
- ✅ Cost aggregation per provider (D157); stamped on VideoArtifact
- ✅ $0 cost discipline (D158) — zero external API calls; deterministic output
- ✅ **91 smoke-test assertions all pass**
- ✅ Admin-substrate smoke green at 41 assertions after flag add
- ✅ `USE_TRAINING_VIDEOS` flag registered with correct owning phase
- ✅ Zero changes outside `training-videos/` + flag registration
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 17-B real backends + Phase 14/9/11 wiring + cloud upload + retries deferred

Phase 17-A is **wired, tested, and ready**. Substrate is firm — 17-B brings real pixels and sound.
