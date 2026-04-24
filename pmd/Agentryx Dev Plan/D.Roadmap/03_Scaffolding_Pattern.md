# Scaffolding Pattern — the 14×-proven A-tier recipe

**Provenance**: Phases 5-A through 18-A all followed this. Each phase closed with the same 7-artifact bundle, the same smoke-test posture, and the same commit-flow sequence. This document codifies it so Phase 19 onwards applies it without reinventing.

**Audience**: anyone (human or LLM agent) scaffolding a new A-tier module.

---

## 1. The 7 artifacts every A-tier ships

```
cognitive-engine/<module>/
  ├── types.js             1. JSDoc shapes + validators + constants
  ├── store.js             2. Filesystem-backed persistence (if applicable)
  ├── <core-logic>.js      3. The actual capability (proposer, renderer, pipeline, etc.)
  ├── smoke-test.js        4. Exhaustive assertion suite — runs offline, $0
  ├── README.md            5. Status + layout + API + decisions + next-phase preview
  └── (optional subdirs)   generators/, providers/, backends/ — one file per plug-in variant

pmd/Agentryx Dev Plan/D.Roadmap/Phase_NN_<slug>/
  ├── Phase_NN_Plan.md     6a. Written pre-scaffold; expanded at phase activation
  ├── Phase_NN_Status.md   6b. What shipped + what deferred + exit criteria met
  ├── Phase_NN_Decisions.md 6c. Dxx decisions with Why + Tradeoff structure
  └── Phase_NN_Lessons.md  6d. What surprised us + what to do differently

+ 1 flag registration in cognitive-engine/admin-substrate/registry.js
+ 1 smoke-count bump in cognitive-engine/admin-substrate/smoke-test.js
```

Seven files in the module + four phase docs + one flag registration + one count bump = **13 file edits per A-tier**. Every closed phase follows this count within ±2.

---

## 2. The 8 conventions every module must follow

Derived from `02_Current_Architecture.md §4`. Re-listed here as an actionable checklist:

- [ ] **DI registry** for plug-in variants (`createXRegistry({defaults})` pattern)
- [ ] **JSONL** for indices and audit logs (`index.jsonl` newest-last; `audit.jsonl` event stream)
- [ ] **Atomic writes** via temp-file + rename (never direct fs.writeFile for durable state)
- [ ] **Per-item asset directory** when a module emits multi-file outputs
- [ ] **Per-item failure isolation** — one failing item doesn't kill the whole batch; failure is a typed state
- [ ] **Dotted two-segment ids** for modules (`<module>.<variant>`)
- [ ] **SHA-256-linked content+metadata** for stored artifacts (enables verify())
- [ ] **Zero LLM calls in A-tier** — LLM backends ship in B-tier behind the same interface

---

## 3. The phase lifecycle (14× proven)

```
  [pre-existing one-line sketch in Phase_NN_Plan.md]
       │
       ▼
  1. Survey (pre-phase code survey, per Phase 4 Lesson #1)
     - read the existing interfaces this module will integrate with
     - confirm no overlap with prior phases' scaffolds
       │
       ▼
  2. Expand Phase_NN_Plan.md
     - scope table (NN.1 through NN.7 deliverables)
     - design diagram if non-trivial
     - out-of-scope list (what B-tier will add)
     - decisions expected (Dxx-Dxx)
       │
       ▼
  3. Write types.js first (commits to the shape before the code)
       │
       ▼
  4. Write store / logic / renderer / pipeline
     - each piece in isolation; tests alongside
     - DI dependencies passed as function args (not imported globally)
       │
       ▼
  5. Write smoke-test.js with SHARP assertions
     - assert content, not just shape (catches silent-degradation bugs)
     - target ≥60 assertions per A-tier (range is 28-117 across 14 closes)
     - every failure path covered
     - at least one E2E that exercises the full pipeline
       │
       ▼
  6. Run smoke — must pass 100%
     - fix assertions that were wrong (not the code) before committing
     - document any bug caught during testing in Phase_NN_Lessons.md
       │
       ▼
  7. Write README.md
     - Status line with assertion count
     - Layout diagram (ASCII)
     - API with one working example
     - Smoke summary table (group × assertion count)
     - Design decisions section pointing at Phase_NN_Decisions.md
     - "What N-B adds" preview
       │
       ▼
  8. Register USE_<MODULE> flag in admin-substrate/registry.js
     - default_when_unset = "off"
     - bump flag count in admin-substrate/smoke-test.js (2 places)
     - rerun admin smoke → 41 assertions pass
       │
       ▼
  9. Write Phase_NN_Status.md, Phase_NN_Decisions.md, Phase_NN_Lessons.md
     - Status: subphase table with ✅; "what shipped" per file with line counts; exit criteria checklist
     - Decisions: Dxx format: What / Why (bulleted) / Tradeoff
     - Lessons: What surprised us / What to do differently / What feeds next phases / Stats
       │
       ▼
 10. Branch + commit + push + PR + link-to-milestone + squash-merge + tag
     (see §4 below)
       │
       ▼
 11. Open the roadmap-sync PR (separate from the phase PR)
     - Updates README.md table row + tag list
     - Updates Dev_Task_list_Update.md headline numbers + row
     - Same milestone, separate PR for cleanliness
       │
       ▼
  DONE — phase closed, tag pushed, roadmap current
```

---

## 4. Commit-flow sequence (exact git commands)

All phases from 5-A onwards use this exact flow. **Direct push to main is blocked** by sandbox policy.

### Phase PR (the code)

```bash
# Start fresh from main
git checkout main && git pull --ff-only origin main

# Feature branch named after the phase slug
git checkout -b phase/<n>-a-<slug> main

# Make all the edits (see §3 above)
# Stage specific files (not git add -A; keep roadmap-level docs for separate PR)
git add cognitive-engine/<module>/ \
        cognitive-engine/admin-substrate/registry.js \
        cognitive-engine/admin-substrate/smoke-test.js \
        "pmd/Agentryx Dev Plan/D.Roadmap/Phase_NN_<slug>/"*

# Commit with HEREDOC body explaining scope + pieces + decisions (D-range) + deferrals
git commit -m "$(cat <<'EOF'
Phase <N>-A — <title>

<2-3 sentence summary>

Pieces:
- types.js: ...
- store.js: ...
- <core-logic>.js: ...
- smoke-test.js: NN assertions across M test groups
- README: ...

Flag USE_<MODULE> registered in admin-substrate.

Phase docs: Plan (expanded), Status, Decisions (Dxx-Dxx), Lessons.

Closes <N>-A scope. <N>-B (...) deferred pending <blocker>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

# Push + create the milestone (if not already present) + open PR
git push -u origin phase/<n>-a-<slug>
gh api repos/:owner/:repo/milestones -X POST \
   -f title="Phase <N> — <title>" \
   -f description="..."
# Note the milestone number from the response.

gh pr create --base main --head phase/<n>-a-<slug> \
  --title "Phase <N>-A — <title>" \
  --body "$(cat <<'EOF'
## Summary
...

## Test plan
- [x] node cognitive-engine/<module>/smoke-test.js — N assertions pass
- [x] node cognitive-engine/admin-substrate/smoke-test.js — 41 assertions pass
...

## Rollback
...

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# Link PR to milestone
gh api repos/:owner/:repo/issues/<pr#> -X PATCH -F milestone=<milestone#>

# Squash-merge
gh pr merge <pr#> --squash --delete-branch

# Sync main + tag the squash commit
git checkout main && git pull --ff-only origin main
git tag -a phase-<n>a-closed <squash-sha> -m "Phase <N>-A closed — <1-sentence what + assertion count>. <N>-B deferred pending <blocker>."
git push origin phase-<n>a-closed
```

### Roadmap-sync PR (the docs index)

```bash
git checkout -b docs/roadmap-sync-phase-<n>a main

# Edit:
#   pmd/Agentryx Dev Plan/D.Roadmap/README.md         — phase row + tag list
#   pmd/Agentryx Dev Plan/D.Roadmap/Dev_Task_list_Update.md — headline numbers + row

git add "pmd/Agentryx Dev Plan/D.Roadmap/README.md" \
        "pmd/Agentryx Dev Plan/D.Roadmap/Dev_Task_list_Update.md"
git commit -m "docs: roadmap sync after Phase <N>-A close"
git push -u origin docs/roadmap-sync-phase-<n>a

gh pr create --base main --head docs/roadmap-sync-phase-<n>a \
  --title "docs: roadmap sync after Phase <N>-A close" \
  --body "..."
gh api repos/:owner/:repo/issues/<pr#> -X PATCH -F milestone=<milestone#>
gh pr merge <pr#> --squash --delete-branch
```

---

## 5. Smoke test assertion patterns (what good looks like)

Across 14 phases, assertion styles that catch real bugs:

### Content assertions, not shape assertions

```js
// ❌ weak — passes even with silently-wrong output
assert(result.beats.length > 0, "has beats");

// ✅ sharp — catches silent-degradation (real bug from Phase 14-A round-robin)
assert(firstFour.length === 4 && new Set(firstFour).size === 4,
       `first 4 jobs span all 4 projects (got ${firstFour.join(",")})`);
```

### Failure-path assertions

```js
try {
  await store.write({ kind: "bogus", ... });
  throw new Error("should have rejected");
} catch (e) {
  assert(/invalid kind/.test(e.message), "bad kind rejected");
}
```

### Round-trip assertions

```js
const written = await store.write(input);
const { record, content } = await store.read(projectId, written.id);
assert(record.id === written.id, "roundtrip record id");
assert(content.includes("Hello."), "roundtrip content");
```

### E2E through prior phases

```js
// Phase 17-A smoke runs the REAL Phase 16-A training-gen pipeline,
// fetches its output via readLatest, and renders a video from it.
const scriptRec = await trainingStore.readLatest(ctx.project_id, "voiceover_script");
const artifact = await renderFromScript({
  scriptRecord: scriptRec.record,
  scriptContent: scriptRec.content,
  renderVoiceoverForPhase17,
  providerChoice: { tts: "tts:null", capture: "capture:null", stitcher: "stitcher:null" },
  store: videoStore, registry,
});
assert(artifact.script_id === scriptRec.record.id, "video references training TART id");
```

---

## 6. Decisions document format (Dxx)

Each decision follows this structure (extracted from Phases 14-A / 15-A / 16-A / 17-A / 18-A):

```markdown
## Dxx — <One-sentence summary of what was decided>

**What**: <The concrete thing we did, in 1-3 sentences.>

**Why**:
- <Bullet of rationale #1>
- <Bullet of rationale #2>
- <Bullet of rationale #3>

**Tradeoff**: <What this decision costs us, acknowledged. Leave blank only if truly no downside.>
```

Decision numbers are globally monotonic across all phases — Phase 15 decisions are D141-D146; Phase 16 is D147-D152; Phase 17 is D153-D158; Phase 18 is D159-D165. Phase 19 will start at D166.

---

## 7. Phase lessons structure

Each `Phase_NN_Lessons.md` has four sections:

1. **What surprised us** — numbered list of 3-4 observations. Format: one-line claim + 2-3 sentences of context + takeaway. These are the memory-worthy items.
2. **What to do differently** — numbered list of 2-4 items. Things that would improve the next phase.
3. **What feeds next phases** — Phase N-B preview, plus cross-references to other phases that will consume this work.
4. **Stats** — session count, $ spent, dependencies added, files created/modified, decisions count.
5. **Phase N-A exit criteria — met** — checklist mirroring `Plan.md` exit criteria, each with ✅.

---

## 8. Why this pattern holds

After 14 phases, the pattern is the artifact. It:

- **Makes review mechanical**: reviewer checks the 7 files exist, smoke passes, docs are present.
- **Makes onboarding fast**: a new developer reading one `Phase_NN_*` folder understands the decisions, not just the code.
- **Makes rollback safe**: every phase is one squash commit, tagged. `git revert` is atomic.
- **Makes automation possible**: a future agent (Claude or otherwise) given a phase sketch can apply this recipe to produce consistent scaffolds.
- **Makes cost predictable**: each A-tier is ~1 session, $0, 7 new files, 60-120 assertions.

The pattern is the contract with future-us.

---

## 9. Anti-patterns we deliberately avoid

- **❌ Writing code before types.js** — shape is harder to refactor than behavior; decide the interface first.
- **❌ Deferring the smoke test** — scaffolds without sharp assertions rot silently. Every module ships with ≥60 assertions from day one.
- **❌ Editing shared files without a flag** — `tools.js`, graph files, `telemetry.mjs` stay read-only during A-tier. Everything gated.
- **❌ Skipping the roadmap-sync PR** — the dashboard is the source of truth for "what exists"; it must stay current.
- **❌ Creating README without examples** — every README has at least one working code block.
- **❌ Decisions without tradeoffs** — if a decision has no tradeoff, it's probably not worth recording as a decision.
- **❌ Lessons as a formality** — the "what surprised us" section is where future phases mine for signal. Fill it honestly; `Phase_14_Lessons.md` documented the round-robin bug that shaped Phase 15-A's stub-proposer approach.

---

## 10. Document revision log

| Rev | Date | Trigger | Sections |
|---|---|---|---|
| v1 | 2026-04-24 | First codification; based on Phases 5-A through 18-A | all |

This document should be revised when:
- A new convention emerges across ≥2 consecutive phases (add to §2 conventions list)
- The commit flow changes (update §4)
- A phase deliberately violates the pattern and succeeds (document the exception + why)
