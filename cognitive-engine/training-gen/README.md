# Training Generation (Phase 16-A)

Substrate for producing voiceover-ready video scripts, storyboards, and companion written training materials from a factory project. Phase 17 (Training Videos) consumes the voiceover+storyboard pair.

## Status: Phase 16-A scaffolding

**102 smoke-test assertions pass.** Full pipeline (ProjectContext → 6 template generators → training store → Phase-17 payload) green end-to-end. **No LLM calls, $0 cost, no graph changes.** 16-B swaps in LLM-backed generators behind the same interface.

## Files

- `types.js` — `TrainingArtifact`, `TrainingKind` (6), `VoiceoverBeat`, `StoryboardBeat`, `ProjectContext`; per-kind format table
- `store.js` — filesystem-backed store: `write` / `read` / `list` / `latest` / `readLatest` / `verify` / `stats`
- `generators.js` — 6 template generators + `createGeneratorRegistry({defaults})`; DI'd per kind for 16-B LLM swap
- `renderer.js` — `summarize` / `renderMarkdown` / `renderVoiceoverForPhase17` / `captionsFromVoiceover`
- `pipeline.js` — `runPipeline({ctx, store, registry, kinds?})`; orders voiceover before storyboard; isolates generator failures
- `smoke-test.js` — 102 assertions across 12 test groups

## Layout

```
<workspace_root>/_training/
  └── <project_id>/
      ├── index.jsonl                 append-only manifest (newest-last)
      ├── latest.json                 { "<kind>": "<TART-id>" }
      ├── _seq                        monotonic counter (per project)
      ├── TART-0001-user-guide.md
      ├── TART-0002-voiceover-script.json
      ├── TART-0003-video-storyboard.json
      └── ...
```

- Content and manifest are separate files; SHA-256 links them.
- Re-running a generator produces a fresh `TART-NNNN` (D151 — append-only). `latest.json` carries the convenience pointer per `(project, kind)`.

## Training kinds

| Kind | Format | Audience | Phase 17 consumer? |
|---|---|---|---|
| `user_guide` | md | end users | no |
| `quick_start` | md | new users | no |
| `how_to` | md | task-focused users | no |
| `reference_doc` | md | integrators | no |
| `voiceover_script` | json | Phase 17 narrator | **yes** |
| `video_storyboard` | json | Phase 17 renderer | **yes** |

## Voiceover script structure (Phase 17 contract)

Every `voiceover_script` content has:

```jsonc
{
  "schema_version": 1,
  "project_id": "...",
  "project_title": "...",
  "beats": [
    {
      "id": "BEAT-1",
      "narrator_text": "...",
      "target_duration_ms": 6000,
      "screen_capture": { "url": "...", "selector": "...", "wait": "networkidle", "action": "none" },
      "transition": "fade"
    }
  ]
}
```

`video_storyboard` mirrors the beats (`id` matches) and adds `camera_plan` + `b_roll_hint` + `on_screen_text`.

## Pipeline

```
ProjectContext
   ├── project_id / project_title / project_summary
   ├── features[]        { id, title, description, entry_points, tags }
   ├── runtime           { base_url, auth_method, ... }  ← screen-capture base
   ├── artifacts         { apis, configs }               ← reference doc inputs
   └── pmd_doc_ids[]     ← 16-B will read these from Phase 4 registry
            │
            ▼
   registry.list()  →  ordered kinds (voiceover before storyboard)
            │
            ▼
   for each kind: generator.fn(ctx, opts) → { title, content, parent_ids, meta, tags }
            │
            ▼
   store.write(...)   →   TART-NNNN in _training/<project>/
            │
            ▼
   Phase 17 consumes via store.readLatest(project, "voiceover_script")
                          + renderVoiceoverForPhase17(record, content)
```

## API

```js
import { createTrainingStore } from "./training-gen/store.js";
import { createGeneratorRegistry } from "./training-gen/generators.js";
import { runPipeline } from "./training-gen/pipeline.js";
import { renderVoiceoverForPhase17 } from "./training-gen/renderer.js";

const store = createTrainingStore("/path/to/workspace");
const registry = createGeneratorRegistry();   // 6 defaults

const result = await runPipeline({
  ctx: {
    project_id: "todo-app",
    project_title: "Todo",
    project_summary: "A simple todo app.",
    features: [
      { id: "FEAT-lists",  title: "Lists",  description: "Create lists.",  entry_points: ["/lists"]  },
      { id: "FEAT-sync",   title: "Sync",   description: "Offline sync.",  entry_points: ["/sync"]   },
    ],
    runtime: { base_url: "https://todo.example.com" },
  },
  store, registry,
  // kinds: ["voiceover_script", "video_storyboard"],   // optional subset
});
// result = { produced: [{kind, record}, ...], errors: [] }

// Phase 17 fetches the latest voiceover + renders the payload it needs
const latestVo = await store.readLatest("todo-app", "voiceover_script");
const payload = renderVoiceoverForPhase17(latestVo.record, latestVo.content);
// payload = {
//   narration: [{id, text, target_duration_ms}, ...],
//   capture_plan: [{beat_id, url, selector, wait, action, input}, ...],
//   transitions: [{beat_id, transition}, ...],
//   captions_srt: "1\n00:00:00,000 --> 00:00:06,000\nWelcome...\n\n...",
//   total_duration_ms: 42000,
// }
```

## Swapping in a custom generator (16-B LLM hook)

```js
const registry = createGeneratorRegistry({ defaults: true });
registry.register("voiceover_script", {
  id: "generator:llm:voiceover:opus-4-7",
  fn: async (ctx, opts) => {
    // call LLM with ctx + per-kind prompts; produce the same { title, content, meta, tags } shape
    return { title: `${ctx.project_title} — Voiceover`, content: { schema_version: 1, beats: llmBeats } };
  },
});
```

Pipeline, store, renderer, and Phase 17 payload are all unchanged. Only the generator's internals swap.

## Smoke test summary

```
$ node cognitive-engine/training-gen/smoke-test.js
[types]                                 ✓ 9   (schema/kinds/transitions/formatFor)
[store basics]                          ✓ 16  (write/read/list/latest/verify/stats)
[store validation]                      ✓ 5   (bad kind/missing fields/bad project_id)
[store append-only + latest pointer]    ✓ 4   (regeneration retains old; latest pointer updated)
[generators — each valid]               ✓ 17  (title/content shape, meta, beat shape, counts)
[generator registry]                    ✓ 7   (defaults/swap/invalid kind/missing fn/empty)
[pipeline — full flow]                  ✓ 6   (6 produced, stats, parent link, verify)
[pipeline — subset]                     ✓ 2   (voiceover ordered before storyboard always)
[pipeline — generator failures]         ✓ 3   (one fails, other 5 still produced)
[renderer]                              ✓ 10  (Phase-17 payload, markdown, summary, invalid kind)
[renderer — SRT timing]                 ✓ 3   (cumulative ms → HH:MM:SS,mmm)
[end-to-end]                            ✓ 6   (pipeline → renderer → Phase 17-ready payload)

[smoke] OK  — 102 assertions
```

## Feature flag

```
USE_TRAINING_GEN=true     Phase 16-B onwards: post-dev graph emits training artifacts
                          Phase 16-A: no runtime effect; library only
```

## Design decisions

- **D147** — Standalone `_training/<project_id>/` store. Not fused with Phase 6-A `_artifacts/`. Dual-write is a 16-B concern. Isolating keeps rollback to one directory and lets 16-A ship before 6-B graph dual-write lands.
- **D148** — Generators dependency-injected per kind. Same pattern as Phase 9-A `fixRouter`, Phase 13-A `nodeStubs`, Phase 14-A `handlerRegistry`, Phase 15-A proposer. 16-A ships 6 template generators; 16-B swaps in LLM variants behind the same `fn(ctx, opts)` signature.
- **D149** — Voiceover script structure IS the Phase 17 contract. 6 fields per beat (id, narrator_text, target_duration_ms, screen_capture, transition, note) is enough to drive ElevenLabs + a headless-browser renderer. Structure stable even while prose quality changes in 16-B.
- **D150** — Content + manifest split: the file is a separate `.md`/`.json`; `index.jsonl` carries the SHA-256-stamped manifest row. Matches Phase 6-A artifacts and Phase 7-A memory. Enables `verify()` for integrity checks.
- **D151** — Append-only. Regenerating a kind writes a new `TART-NNNN`; old records are preserved. `latest.json` carries the per-(project,kind) convenience pointer. No overwriting → easy timeline view in future UI.
- **D152** — 16-A emits zero LLM calls. Every run costs $0 and works offline. Proves the contract; 16-B layers prose quality on a tested substrate.

## Rollback

16-A has no runtime hooks. Nothing consumes the library yet. Removal = `rm -rf cognitive-engine/training-gen/` + unregister the flag. Phase tag `phase-16a-closed` is the rollback anchor.

## What 16-B adds

- **LLM generators** — prose quality for `user_guide`/`quick_start`/`how_to`/`reference_doc`; thoughtful pacing + varied phrasing for `voiceover_script`
- **Post-dev graph integration** — after `post_dev_graph.js` runs, enqueue a `training_gen` job via Phase 14-A; handler invokes `runPipeline` with the real project context
- **Phase 4 PMD registry integration** — reference_doc generator reads from the PMD catalog (B2 Dev Doc, B5 Training Guide) instead of just the synthetic `artifacts` field
- **Memory-layer personalization** — generators pull relevant `lesson` + `pattern` observations for the project/agent and include them in training content
- **Phase 6-A dual-write** — each TrainingArtifact also lands in `_artifacts/` with kind `training_output`, enabling cross-project analytics
- **Phase 9 Verify integration** — reviewers annotate scripts; feedback flows back as memory observations which self-improvement (Phase 15-B) may use to tune generators

## What 16-C (or later) may add

- **Multi-language output** — translation lane for each generator
- **Cost-aware proposer** — pick between template / Haiku / Sonnet generators based on budget remaining (Phase 11-A integration)
- **A/B tests** between template and LLM variants via Phase 15 self-improvement evaluator
- **Video-first formats** — TikTok-style short-form storyboard alongside the long-form
