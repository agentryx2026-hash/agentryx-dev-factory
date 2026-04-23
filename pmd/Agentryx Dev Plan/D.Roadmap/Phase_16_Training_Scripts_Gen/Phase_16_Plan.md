# Phase 16 — Training Scripts Generation

**One-liner**: Auto-generate voiceover-ready video scripts, storyboards, and companion written training materials as versioned artifacts. Phase 17 (Training Videos) consumes the script+storyboard pair to render narrated videos. Phase 16-A ships the substrate (types, store, generators, renderer, pipeline); 16-B swaps in LLM-backed generators when OpenRouter credit is live.

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 ("read existing code before scoping"):

- **Phase 4 PMD Template Registry** already catalogs 27 PMD doc types including `B2 Developer Documentation`, `B5 Training Guide`, `C1 Training Walkthrough Videos`, `C2 Manuals & Guides`, `C3 Support, Help & FAQ`. These are produced by the PMD agent pipeline (Picard/Sisko/Troi). **Phase 16's scope does NOT overlap** with PMD docs — it adds the video-script + storyboard lane (C1's inputs) which no existing agent produces, plus shorter task-focused companions (quickstart, how-to) that sit alongside the formal PMD guides.
- **Phase 6-A artifact store** is the natural home for training outputs at scale, but 6-B graph dual-write is deferred. 16-A ships its own `_training/` store with an adapter so 6-B integration is one constructor-arg swap later.
- **Phase 7-A memory layer** captures `lesson` and `pattern` observations — Phase 16-B's LLM generator will recall these to personalize training for the project ("the Troi auth lesson informs the storyboard's auth section").
- **Phase 12-A admin substrate** catalogs feature flags; `USE_TRAINING_GEN` registers alongside the other 9.
- **Phase 14-A concurrency engine** can run training generation as a post-dev queue job (`kind: "training_gen"`) so it doesn't block the factory pipeline. 14-B wires the real handler; 16-A ships the generator library.
- **Phase 17 is the consumer** — it needs: (a) narration text per beat, (b) target duration per beat, (c) screen-capture cues (URL/selector/wait-condition), (d) transition hints. 16-A's `voiceover_script` artifact carries exactly these four fields per beat so Phase 17's ElevenLabs + headless-browser renderer plugs in without schema changes.

## Design

A **TrainingArtifact** is a typed, versioned training output produced by a generator.

```
project context (code, PMD docs, test results, feature manifest)
        │
        ▼
  generators (template-based in 16-A; LLM-backed in 16-B)
        │
        ▼
  TrainingArtifact[]   kinds: user_guide | voiceover_script | video_storyboard | quick_start | how_to | reference_doc
        │
        ▼
  renderer — markdown for human consumption; structured JSON for Phase 17 pipeline
        │
        ▼
  _training/<project_id>/<TART-id>.{md,json}     +  _training/<project_id>/index.jsonl
        │
        ▼
  Phase 17 reads voiceover_script + video_storyboard pair → ElevenLabs + headless browser → mp4
```

### Training artifact kinds (16-A)

| Kind | Primary audience | Content | Phase 17 consumer? |
|---|---|---|---|
| `user_guide` | End users | Long-form markdown walkthrough of all features | no |
| `quick_start` | New users | 5-minute task-focused markdown | no |
| `how_to` | Specific-task users | One task, explicit steps, deep-linked | no |
| `reference_doc` | Integrators | API/config reference rendered from code + types | no |
| `voiceover_script` | Phase 17 narrator | Structured beats with narrator text + duration + cues | **yes** |
| `video_storyboard` | Phase 17 renderer | Ordered beats with screen-capture plan (URL/selector/wait) | **yes** |

### Voiceover script structure (Phase 17 contract)

Each `voiceover_script` artifact has `beats[]` with:
- `narrator_text` — what gets read aloud
- `target_duration_ms` — pacing guide
- `screen_capture` (optional) — `{url, selector?, wait?, action?}` cues for the renderer
- `transition` — enum: `cut | fade | zoom | highlight`
- `id` — stable beat id so storyboard can cross-reference

`video_storyboard` artifacts mirror the beats and add `camera_plan` + `b_roll_hints`.

## Scope for this phase (16-A: substrate)

Mirrors 5-A through 15-A pattern.

| Sub | What | Deliverable |
|---|---|---|
| 16-A.1 | `training-gen/types.js` — TrainingArtifact, TrainingKind, VoiceoverBeat, StoryboardBeat, ProjectContext shapes | ✅ |
| 16-A.2 | `training-gen/store.js` — filesystem-backed training artifact store with append-only index | ✅ |
| 16-A.3 | `training-gen/generators.js` — 6 template-based generators (one per kind), dependency-injected via registry | ✅ |
| 16-A.4 | `training-gen/renderer.js` — markdown rendering per kind + JSON rendering for Phase 17 |  ✅ |
| 16-A.5 | `training-gen/pipeline.js` — run selected generators over a ProjectContext, persist outputs | ✅ |
| 16-A.6 | Smoke test — full flow against synthetic ProjectContext | ✅ |
| 16-A.7 | `training-gen/README.md` + `USE_TRAINING_GEN` flag doc | ✅ |

**Out of scope for 16-A** (deferred to 16-B/C):

- LLM-backed generators (template stubs for now — produce useful scaffolding, not publication-ready prose)
- Integration with Phase 6-A artifact store (`_training/` is standalone; dual-write comes later)
- Scheduled generation via Phase 14-A queue (`kind: "training_gen"` handler is 16-B)
- Feedback loop from Phase 9 Verify portal (reviewers annotate scripts; feedback tunes generators) — 16-C
- Multi-language output — 16-B+
- Personalization from memory-layer recall — 16-B

## Why this scope is right

- **Phase 17 needs a firm contract, not prose.** Even a template generator that emits a 5-beat storyboard with correct cues lets Phase 17's renderer be built and tested. Prose quality is an orthogonal 16-B concern.
- **Template-driven generators prove the contract.** If the renderer can turn template output into Phase-17-consumable scripts, the LLM generator (16-B) just needs to fill slots with better text — the structure is the integration point.
- **Standalone store, artifact-store adapter later.** Matches Phase 9-A / 15-A pattern: ship the substrate decoupled, wire into shared infra when 6-B lands.
- **Heuristic generators are enough to ship the lifecycle.** Same rationale as 15-A's heuristic proposer: proves the contract at $0 cost; LLM swap is mechanical.

## Phase close criteria

- ✅ `training-gen/` scaffolded (types, store, generators, renderer, pipeline, smoke-test, README)
- ✅ 6 generator kinds implemented as template functions, DI-registered
- ✅ Voiceover script structure matches Phase 17's contract (beats with narrator text + duration + optional cues + transition)
- ✅ Smoke test: project context → generators → store → round-trip read, ≥60 assertions
- ✅ `USE_TRAINING_GEN` flag documented (no runtime effect in 16-A)
- ✅ No changes to graph files, PMD agents, memory layer, concurrency engine, or admin substrate core
- ✅ Phase docs: Plan (expanded), Status, Decisions (D147-Dxx), Lessons

## Decisions expected

- **D147**: Training artifacts live in `<workspace>/_training/<project_id>/` as a standalone store (not fused with Phase 6-A `_artifacts/`). Dual-write adapter is a 16-B concern; keeps rollback simple.
- **D148**: Generators are dependency-injected per kind (same pattern as Phase 9-A `fixRouter`, Phase 13-A `nodeStubs`, Phase 14-A `handlerRegistry`, Phase 15-A proposer). 16-A ships template generators; 16-B swaps in LLM variants behind the same interface.
- **D149**: Voiceover script structure is the Phase 17 contract — once 16-A lands, Phase 17 can start without waiting for 16-B prose quality.
- **D150**: Content stored as a separate file (`.md` or `.json`) with content-sha256; index.jsonl carries manifest rows. Matches the Phase 6-A + Phase 7-A pattern.
- **D151**: All applies are additive. Re-generating a kind creates a new `TART-NNNN` id; old versions are kept. A `latest` index is maintained per (project, kind) for convenient lookup. Matches Phase 6-A's append-only philosophy.
- **D152**: 16-A emits no LLM calls. 100% of 16-A runs cost $0 and work offline.
