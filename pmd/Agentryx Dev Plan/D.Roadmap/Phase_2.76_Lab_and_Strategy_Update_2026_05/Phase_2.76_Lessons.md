# Phase 2.76 — Lessons Learned

Phase 2.76 closed: 2026-05-09. Duration: single session. **First phase that's purely architectural / strategic** — no new substrate code in `cognitive-engine/`, but a new top-level capability (`playground/`) plus 9 Decisions reshaping how we evaluate the field going forward.

## What surprised us

1. **The doc-trail constraint forced clarity.** Founder's explicit ask was: "in two months, you should be able to read the docs and reconstruct everything — no chat history needed." That constraint turned what could have been a quick "add a Lab folder" PR into 9 decision entries, 5 profile docs, 4 phase docs, and 4 cross-phase doc updates. It felt heavier in the moment but the result is genuinely durable. **Lesson**: when the founder says the docs are the durable context, treat them as the deliverable, not an afterthought.

2. **The marketplace category enum was the right primitive.** When I started this phase I expected to build a parallel "Lab registry" alongside `cognitive-engine/marketplace/`. Stopped, re-read Phase 18-A's design, realised `category: "experimental"` was always the right slot — Phase 18-A had built the substrate, just not named the experimental tier. One-line change to the enum + smoke-test bump is the entire infra-level integration. The Lab is mostly *docs and discipline*, not new code. **Lesson**: when something feels like it needs new infrastructure, re-read the existing primitives — Phase 18-A's marketplace is more general-purpose than its own Phase docs claimed.

3. **Founder's "next Hermes / next OpenCLAW" framing reframed the Lab.** I'd designed the Lab as an *evaluation* capability — "test before adopting." Founder's framing was *generative* — "test, learn, then build our own." Same mechanics; different mental model. Profiles that fail evaluation aren't dead-ends; they're the seeds of internal innovation. Updated `playground/README.md` to lead with "the Lab is the launching pad for our own innovations" rather than just "evaluation capability." **Lesson**: the founder is generally one frame ahead of where I'm pitching things. Listen for the upgrade.

4. **Security deferral to v3 was the right call given internal-only v0.0.1 → v2.** I'd been flagging Hermes' ALLOW-ALL default + skill-poisoning vector as integration blockers in earlier responses. Founder pointed out that with v3 production at ~5-6 months out, these are aspirational gates, not current ones. Switched to "record findings in PROFILE.md, gate at v3 boundary." Cleaner posture, faster iteration during the in-house testing band. **Lesson**: production-direction code and production-deployed code are different things; security posture should match the deployment context, not the long-term aspiration.

## What to do differently

1. **Profile manifests are mostly metadata; the real work is in the PROFILE.md.** I built `manifest.js` for each of 5 profiles, registered them all as `experimental` with `feature_flag` placeholders. Useful for discoverability but contributes nothing measurable until adapter.js lands. Future profiles: write PROFILE.md first, defer manifest.js until status moves to `testing`. Saves ~30 lines × N profiles of low-information code.

2. **Profile status enum should have a `graduated` terminal state.** Currently profiles either `adopting` (in-progress promotion) or stay in the Lab forever. Adding `graduated` as a sixth status would let us mark a profile as "done its job, archived as institutional memory" without it cluttering active reviews. Punted to next monthly review when we'll need it for the first time.

3. **Composition smoke's 73 assertions don't currently exercise the experimental category itself.** When I added `experimental` to MODULE_CATEGORIES, the marketplace smoke gained one assertion (`isValidCategory("experimental")`), but the catalogue smoke ("category X has at least one built-in module") doesn't run for experimental — by design (no built-ins should be experimental). Worth adding a positive assertion: "experimental category has zero built-ins; only profiles register here." Adding to backlog.

4. **The runner's `--include` flag is currently a no-op.** I shipped runner.js knowing the adapter-loading machinery isn't built yet (deferred to when Tier 1 profiles transition to `testing`). Documented the no-op explicitly with a console message. Trade-off: ships incomplete, but runs the baseline cleanly today. Better than blocking on adapter.js infrastructure that 5/5 of the Tier 1 profiles wouldn't use this month anyway.

## What feeds next phases

### Next monthly review (last Friday of May 2026)

- Tier 1 profiles transition from `exploring` to `testing`:
  - hermes-agent: install upstream, write adapter.js for Kanban-pattern variant + Honcho-memory variant, first comparison run vs baseline
  - honcho: install standalone, write adapter.js as Phase 7-E backend, first comparison run
  - deep-agents: install `deepagents` JS, write adapter.js wiring Picard as top-level + Sisko/Troi/etc. as subagents, first comparison run
  - anthropic-agent-teams: write adapter.js using Claude Code SDK Agent Teams primitive, first comparison run
- thinking-machines-tinker: stays `watching`; founder action item to apply for waitlist
- First decision: which Tier 1 profile shows the strongest comparative signal after one round of testing?

### Tier 2 profiles to add in June 2026

- Inspect AI (UK AISI) — could become *the* Lab evaluator (meta-tool)
- Mastra (TS-native LangGraph alternative)
- DSPy + BAML (prompt management + structured outputs)

### Tier 3 watch list (research-only until promoted)

- Strands Agents · Vercel AI SDK 6 · A2A protocol · Browser Use / Stagehand · E2B / Daytona / Modal · Spec Kit / BMAD-METHOD / Factory.ai · OpenAI Agents SDK · Cursor 3 / Composer 2 · Devin / Aider / OpenHands · OpenSpec · Replit Agent v3 · Lovable.dev · Claude Code as a meta-runtime study

### B-tier marathon impact

- Phase 7-E (Honcho) becomes a real subphase candidate — was implicit before D183
- Phase 9 coordinator decision now has 3 candidates competing instead of 1 hand-rolled solution (LangGraph + Deep Agents + Agent Teams)
- Phase 18-B marketplace UI work has more to display (experimental category becomes a tab)
- v3 production target updates `04_B_Tier_Marathon.md`'s timeline

### Master Factory Architect r0.4

- §1 release-band table compressed (R3-equivalent at ~5-6 months vs original r0.1's 6-9 months)
- §11.8 documents Beta Playground architecture; future r0.5 will document what we learned from it
- §13 (Bridge to marathon) implicitly extended to "marathon + Lab in parallel"

## Stats

- **1 session** (same arc that started with the founder's "Hermes is on fire" prompt)
- **\$0.00 spent** (no LLM calls; no external API calls; baseline run is offline)
- **0 new dependencies** (node built-ins only)
- **15 files created** (5 PROFILE.md + 5 manifest.js + 1 README + 1 PROFILE_TEMPLATE + 1 runner.js + 1 results JSON + 1 results/ dir created via mkdir)
- **4 phase docs created** (Phase 2.76 Plan + Decisions + Status + Lessons)
- **6 files modified** (Master_Factory_Architect r0.4; 02_Current_Architecture; 04_B_Tier_Marathon; D.Roadmap/README; Dev_Task_list_Update; marketplace types.js + smoke-test.js)
- **9 Decisions** (D181-D189)
- **+1 smoke assertion** (marketplace 117 → 118)
- **5 Lab profiles** seeded (4 exploring + 1 watching)

## Phase 2.76 close criteria — met

(See `Phase_2.76_Status.md` checklist.) All criteria green.

## Founder feedback

> "We need to test these tools so as to analyze and see firsthand what they are doing, what they are doing, so that we can adopt something, learn from it, and build our own tool or artifact for that."
>
> "We might build the next Hermes or next OpenCLAW if we keep building and testing over the entire dev factory."

The Lab now exists in service of both framings. Six months from now (v3 production target), the Lab's monthly review log will show whether the strategy was right. Until then, the doc-trail captures the bet, the rationale, and the rubric for evaluating the bet.

Phase 2.76 closes the strategic-update arc. Back to the B-tier marathon next session.
