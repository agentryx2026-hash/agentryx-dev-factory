# Phase 16 — Decisions Log

## D147 — Standalone `_training/` store, not fused with Phase 6-A `_artifacts/`

**What**: Training artifacts live under `<workspace>/_training/<project_id>/` with their own manifest (`index.jsonl`), per-project counter (`_seq`), and per-(project,kind) latest pointer (`latest.json`). Phase 6-A artifact store is untouched in 16-A.

**Why**:
- **Phase 6-B is deferred** (awaiting OpenRouter credit). Coupling training-gen to 6-A would push 16-A's ship date behind 6-B's.
- **Rollback is one directory** — remove `_training/` and the feature is gone. No migration worries on the shared artifact store.
- **Different consumers** — Phase 17's video pipeline wants voiceover JSON with a specific shape; bundling with generic code/test artifacts would mean Phase 17 has to filter. Separating keeps consumer code trivial.
- **Dual-write adapter is a small 16-B PR** — add a `dualWrite` option to `store.write` that also calls `writeArtifact(projectDir, {kind: "training_output", content_ref, ...})`. No schema changes; pure composition.

**Tradeoff**: cross-project analytics (e.g., "how does training content correlate with code cost?") can't join TART and ART ids without a second index. Acceptable — the use case doesn't exist until 16-B ships anyway.

## D148 — Generators dependency-injected per kind (registry pattern)

**What**: `createGeneratorRegistry({defaults=true})` returns `{register, get, has, list}`. Defaults register 6 template generators. Tests and 16-B swap individual kinds via `registry.register(kind, {id, fn})`.

**Why**:
- **Convention reuse**: same DI shape as Phase 9-A `fixRouter`, Phase 13-A `nodeStubs`, Phase 14-A `handlerRegistry`, Phase 15-A proposer. No cognitive tax for reviewers.
- **Mixed registries are natural** — a project might want LLM-generated voiceover but template-generated reference docs (reference is machine-generatable from API specs; voiceover needs voice). Per-kind swap handles that without ceremony.
- **16-B LLM integration is one PR**, not a rewrite: plug in `generator:llm:voiceover:opus-4-7` and everything downstream (pipeline, store, renderer, Phase 17) is unchanged.
- **Testability** — smoke test registers a deliberately-failing generator for one kind to prove the pipeline isolates failures; no monkey-patching.

## D149 — Voiceover script structure IS the Phase 17 contract

**What**: Every `voiceover_script` artifact has a stable beat structure: `{id, narrator_text, target_duration_ms, screen_capture?, transition?, note?}`. The renderer's `renderVoiceoverForPhase17(record, content)` produces exactly what Phase 17 needs: `narration[]`, `capture_plan[]`, `transitions[]`, `captions_srt`, `total_duration_ms`.

**Why**:
- **Phase 17 can start on 16-A template output** — ElevenLabs narrator + headless browser renderer + ffmpeg stitcher can all be built and tested against template voiceover output. Prose quality upgrade in 16-B doesn't break Phase 17.
- **5 required beat fields are the minimum viable contract**: text (for TTS), duration (for pacing), cue (for screen capture), transition (for stitching), id (for cross-referencing to storyboard). Every real video pipeline needs these five; none needed a sixth.
- **`note` field is an escape hatch** — authors add non-narrated annotations without polluting TTS input.
- **Captions are derived, not authored** — `captionsFromVoiceover` computes SRT timing from cumulative `target_duration_ms`. Phase 17 can re-time after real ElevenLabs render completes.

**Tradeoff**: pacing accuracy depends on authors (or LLM) setting `target_duration_ms` realistically. 16-B can add a "speak-rate" helper that estimates duration from word count; not blocking.

## D150 — Content + manifest split; sha256 links them

**What**: The artifact content is a separate file (`.md` or `.json`); the manifest row lives in `index.jsonl` and carries the content's sha256. `verify()` recomputes sha for every record and reports mismatches.

**Why**:
- **Same pattern as Phase 6-A artifacts + Phase 7-A memory**: consistent mental model across three stores — training, artifacts, memory. Debuggable via `ls + cat`.
- **Integrity checks are free** — a changed or corrupted content file shows up immediately in `verify()`. Useful for the Verify portal (reviewer edits a markdown file on disk; the mismatch is flagged rather than silently consumed).
- **Renderer decoupled from storage format** — `renderMarkdown` / `renderVoiceoverForPhase17` take `(record, content)` not the file path. Callers read once, render multiple ways.

## D151 — Append-only store with per-(project,kind) `latest.json` pointer

**What**: Regenerating a kind produces a new `TART-NNNN` id; older records stay. `latest.json` carries a `{kind: tart_id}` map for convenient lookup.

**Why**:
- **History preserved** — a Phase 15-B self-improvement proposal may compare successive voiceover scripts for the same project. That comparison is impossible if regeneration overwrites.
- **Latest pointer is O(1) lookup** — the Verify portal needs "show me the current voiceover" without scanning the whole manifest.
- **`latest.json` is a derived index** — it can be rebuilt from the manifest if ever damaged. Not authoritative; authoritative state is `index.jsonl` (newest-last convention).
- **Semver-free**: no version numbers per kind, just monotonic ids + timestamps. Simpler than per-kind v1/v2/v3 labels.

**Tradeoff**: disk grows unbounded with regenerations. Ops policy in 16-B can prune TARTs older than N days, keeping latest + latest-1 always. Today we let it grow — tests tmpdir themselves, and real projects won't regenerate all 6 kinds more than a few times per week.

## D152 — 16-A emits zero LLM calls

**What**: All generators are template functions. Every pipeline run costs $0, runs offline, and produces deterministic output given the same `ProjectContext`.

**Why**:
- **Ship before 16-B's budget question is answered**: R&D phase (v0.0.1), OpenRouter credit deferred. Template output is functional (correct structure, reasonable titles/features/cues) if not polished.
- **Deterministic output makes smoke tests sharp** — "voiceover has exactly N+2 beats where N is the feature count" is a stable assertion. Real LLM output would require looser assertions.
- **Phase 17 can develop against deterministic input** — easier to reproduce bugs in the video renderer when the script is deterministic.
- **Matches 15-A's heuristic proposer discipline**: both modules ship template-driven substrate, then 16-B / 15-B layer LLM brains behind the same interface. Pattern is now the default for "new-agent scaffolding" phases.

**Tradeoff**: template prose is obviously template prose. A voiceover scripted by 16-A templates is useful for testing Phase 17's rendering pipeline but shouldn't be published without 16-B's LLM polish. This is fine; 16-A isn't meant to ship user-facing content.
