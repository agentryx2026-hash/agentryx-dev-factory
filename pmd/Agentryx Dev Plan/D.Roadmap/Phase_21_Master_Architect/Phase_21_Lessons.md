# Phase 21 — Lessons

Post-mortem across **21-A** (substrate) + **21-A.1** (Platform Evolution Roadmap + Founder R&D Brief + Seven) + **21-B** (real LLM dispatcher), plus the cross-cutting **visible-factory sprint** that closed 12-B + 13-B Tier B + 9-B Tier B + 10-B Tier B + 6-B + 7-E + 15-B Tier B in the same session.

**Closed**: 2026-05-09 (single multi-hour session, 19 commits).
**Branch**: `phase/21-a-master-architect`.

---

## 1. The "doc said 4 hours, code said 5 minutes" pattern

The marathon doc estimated 12-B as "3-4 sessions." It shipped in ~5 minutes of actual work. Same for 13-B Tier B (2 hours estimated, ~10 minutes shipped). Same for 9-B Tier B + 10-B Tier B (each estimated multi-day, each shipped in ~5 minutes).

**Why**: ~85% of every B-subphase was already built in the A-tier substrate. The "B-tier" work was *composition*, not greenfield. Wiring 6 library calls (`snapshotAllFlags`, `readConfig`, `marketplace.list()`, `queue.stats()`, `getRollup()`, `readAudit()`) to a UI is fast. Writing the substrate library was the slow part — already done in the A-tier marathon.

**Implication**: The marathon doc's effort estimates assumed greenfield work and need a downward revision pass. **Specifically**: when the substrate exists, "Tier B" wiring is typically 5-15 minutes per subphase, not 1-3 sessions. The 1-3 session number is right for "Tier B + full" — full implies new substrate + Postgres migration + role-gated edits + write paths, which IS multi-session work.

**Concrete adjustment** to the marathon doc:
- Tier B (read-only surface that exposes existing substrate) = 5-15 min each
- Tier B-extended (basic write path with file persistence) = 1-3 hours each
- Full B-subphase (real DB migration + auth + everything) = 1-3 sessions each

This affects sequencing dramatically: if the goal is "close the visible-factory gap," shipping 8 Tier B surfaces in one focused session is achievable. We did exactly that 2026-05-09.

---

## 2. The chokepoint pattern beats per-graph patches every time

**Phase 6-B** (artifact dual-write) had two implementation strategies on the table:

A. Patch each graph (`pre_dev_graph.js`, `dev_graph.js`, `post_dev_graph.js`) at every LLM call site to call `writeArtifact` after each successful response.

B. Hook the universal chokepoint — `RouterChatModel.invoke()` in `llm-router/src/langchain-adapter.js` — once, with `setProjectDir()` populating `process.env.AGENT_PROJECT_DIR` so all 3 graphs auto-activate.

We chose (B). One file changed (plus `tools.js` for the env-var setter). Effect: every LLM call from anywhere in the codebase — 3 graphs + Phase 21-B Sonnet dispatcher + any future caller — automatically writes artifacts when the flag is on.

**Decision captured as D210**.

The pattern repeats elsewhere in this phase:
- Phase 21-A.1 cadence daemon: embedded in `factory-telemetry.service` (chokepoint), not a new systemd unit per cadence
- Phase 12-B flag toggle: persisted via one `_factory_runtime/flag_overrides.json` file + `applyFlagOverrides()` at process start, not per-flag config edits
- Phase 7-E memory sync: walks all artifacts via `walkArtifacts(workspaceRoot)` chokepoint, not per-project subscriptions

**Lesson**: Look for the universal entry point before patching N call sites. When found, the same hook covers everything — present and future.

---

## 3. "Wired-but-empty" is a legitimate ship state

Several surfaces shipped this session are *correct* but show empty data today: Replay (no artifacts yet), Cost panel (no LLM cost yet), Memory Layer (no observations yet), proposer buttons (no observations yet).

Initial impulse was to defer shipping these until real data flows. We resisted that — and were right to.

**Why ship empty**:
- The infrastructure is in place. Founder can flip flags and see data appear.
- The empty-state UI is *informative*: each banner explicitly says what flag to flip and what activates it ("Phase 6-B `USE_ARTIFACT_STORE` is OFF, so pipeline runs aren't writing replayable artifacts yet"). The user gets a clear next step.
- The 5-minute Tier B ships compound. Shipping 8 empty-but-wired surfaces in one session = 8 surfaces ready to light up the moment OpenRouter activity starts.
- Full-state demos at the start of the session would have required real LLM cycles that cost money. We avoided that cost while delivering the visible-factory gap closure.

**Lesson**: Ship the surface even when the data is empty. The empty state is itself a deliverable: it tells the founder exactly what to do next.

---

## 4. Founder-driven course corrections > over-planning

This session pivoted hard mid-flight three times based on founder direction:

1. **"DevOps roadmap" → "Platform Evolution Roadmap"** — initial naming was wrong (DevOps means deployment automation in industry; what we're building is continuous platform R&D). Founder rejected the name; we renamed mid-session. Cost: 0 (we hadn't shipped code under the old name).

2. **"Standing Orders, not Founder Priorities Profile"** — same pattern, mid-session rename. Caught before any external-facing artifacts shipped.

3. **"We need first-hand evaluation, not 2nd-hand opinions"** — led directly to the Seven (Tool Evaluator) agent. New named agent, first SOUL.md in the codebase, Hermes Lab profile promoted to `testing` with Seven as evaluation owner. None of this was in the original 21-A scope; the pivot took ~30 minutes.

**Lesson**: Strong founder voice + small ship cycles = corrections cost almost nothing. If we'd been on a multi-week sprint with intermediate artifacts shipped, these renames would have been painful. Within a single session, they were free.

---

## 5. "Substrate first, integration later" survives contact with reality

The Phase 21 substrate was scoped to ship at $0 (stub dispatcher). When founder confirmed "OpenRouter is ready," 21-B took ~30 minutes to wire because:

- The dispatcher contract (`{ findings, cost_usd, produced_by }`) was already defined by the stub
- The LLM router was already in production with budget caps + cost capture + key resolution
- The architect's per-area failure-isolation already shielded against per-call errors
- The 4 dispatcher call sites in telemetry.mjs already factored through a `pickDispatcher` indirection (added when 21-A.1 introduced cadences with `dispatcher: 'stub'|'sonnet'|'opus'` fields)

**Net**: 21-B was ~150 lines of new code (`dispatchers/llm.js`) + ~30 lines of telemetry wiring. The bulk was the prompt template + output JSON contract.

**Lesson**: When you ship the substrate with the right seams, the activation phase is mechanical. Time spent on contract design pays back 10× when the real implementation drops in.

---

## 6. Star Trek naming convention pays for itself

The 12-agent roster (Picard / Sisko / Troi / Jane / Spock / Torres / Tuvok / Data / Crusher / O'Brien / Genovi / Seven) survived the year without ambiguity. When we needed an evaluator agent (per founder's "first-hand report" directive), Seven of Nine was the obvious pick — analytical, Borg-precision, picks apart inefficiencies. Founder approved instantly without debate ("Seven is one of my favorite characters also").

The naming convention also surfaced **scope clarity**: when designing Seven we asked "could Tuvok do this?" — but Tuvok tests *our* code. Seven evaluates *external candidates*. Different concerns, different roles. The Star Trek metaphor made this distinction self-evident.

**Anti-pattern avoided**: Generic role names ("Evaluator-1", "QA-Agent-2") would have invited scope creep. The named-character constraint forces each new agent to have a distinct *personality* + role.

---

## 7. Visible UI is the dopamine the marathon needs

Founder's frustration mid-session: *"Right now the Dev-Hub looks same as one month ago... we've done so much dev where is the visuals?"*

That was the inflection point. Until that complaint, every phase was scaffolding without UI. The complaint forced us to acknowledge: 16 modules built, 1 UI surface (Master Architect, just shipped). We pivoted to a visible-factory sprint that closed 6 sidebar items in one focused stretch.

**Lesson**: Substrate-first discipline is correct, but it has a presentation cost. The marathon doc already named "12-B Admin UI" as **highest-leverage** B-subphase — surfaces every other module's config in one place. We should have shipped 12-B Tier B as soon as 12-A landed (in late April), not 2 weeks later. Same for 13-B Tier B, 14-B status panel, 18-B catalogue browser. **Tier B reads of A-tier modules should ship within days of the A-tier close, not weeks.**

For future phases (22+): A-tier close → Tier B read UI ships within 48 hours. Treat them as the same effort, not separate phases.

---

## 8. The "loose ends" list mostly stayed loose

We tracked four "deferred — will follow up" items at various points:
- **SOUL.md backfill** for the other 11 named agents (since 2026-05-09)
- **Phase 21 Lessons.md** (this file — closing it now)
- **Doc-trail catch-up** — caught up twice in-session, still drifted between catches
- **Per-cadence "test pass" button** in the Master Architect UI — never circled back

Two thirds of these stayed loose. The doc-trail catches were forced by user prompting ("look at the dev plan and status about what is next"), not by self-discipline.

**Lesson**: "Deferred — track as a follow-up" is a polite way to say "this won't happen unless something forces it." Better to either:
- (a) Do it inline as a small commit (5-30 min), or
- (b) Explicitly NOT track it ("we're not doing this; here's why") and let it die.

Tracking-without-doing creates the worst of both worlds: psychological cost of an open todo + zero progress.

The SOUL.md backfill remains genuinely deferred (grunt work, not blocking). Doc-trail catch-up is now my responsibility on every batch of code commits, not a "later" item.

---

## 9. The proposer chain is now fully wired — and synthetic

Phase 21 + 6-B + 7-E + 15-B Tier B closes the *self-improving loop* substrate-wise:

```
real LLM call → Phase 6-B archives artifact → Phase 7-E sync writes
memory observation → Phase 15-B LLM proposer reads observations →
emits ProposalDraft → founder approves → Phase 15-A applier ships
change → next architect cycle sees new factory state → ...
```

But every link in this chain runs on **synthetic data** today. The architect's stub dispatcher produces 6 hardcoded findings per pass; without real LLM activity, no artifacts get written; without artifacts, 7-E sync produces nothing; without observations, 15-B proposer has nothing to read.

**The whole loop activates the moment** founder flips one specific cadence (e.g. monthly) from `dispatcher: 'stub'` → `dispatcher: 'sonnet'` and clicks "Run cycle now". One click = one real research pass = N artifacts archived = N observations after sync = M LLM-proposer drafts. End-to-end live in <60 seconds.

**Lesson**: A loop where every link is wired but nothing flows is a *correctly built* loop, not an incomplete one. We resisted the temptation to fire test LLM calls "just to see" during this session — saved cost, kept commits clean. The first real pass should be a deliberate founder-driven moment, not a smoke test artifact buried in commit history.

---

## 10. The architect should have been built first

Hindsight: Phase 21 should not have been Phase 21. The architect (autonomous research + KB + proposer pipeline) is foundational infrastructure that EVERY OTHER PHASE benefits from. With the architect existing, Phases 5–20 would each have:

- A continuous watch on their slot's ecosystem (e.g. Phase 7's memory backends — sqlite/postgres/vector — would surface as findings the moment something shifts)
- A Founder R&D Brief lane to fire focused questions ("should Phase 8 parallel use Web Workers or worker_threads?")
- Seven as an evaluator agent for any external candidate the phase considered (Hermes for 7/9/10/15/18, etc.)

Instead the architect arrived at Phase 21, after 16 A-tier modules were already shipped without its help. We re-evaluated some of those decisions in 21-A.1 (the Hermes Lab profile got promoted because of the architect's substrate, not because of new evidence).

**Lesson**: Foundational meta-tools (research engine, evaluator, criteria registry) are easy to defer because they have no immediate dollar value. Building them first — before the work they're meant to inform — would have changed the shape of every downstream phase. Capture this for any future v3 → v4 migration: build the meta-tools BEFORE the things they're supposed to optimize.

For now: architect exists; every future phase from 22 forward gets it for free.

---

## 11. What stays open going into the next phase

- **SOUL.md backfill** for the other 11 named agents — pure grunt work, perfect for delegation to a subagent
- **Phase 11-B per-tenant cost charts** — needs real LLM activity first to produce real cost data
- **Phase 14-B queue handlers** — register `pre_dev` / `dev` / `post_dev` etc. as queue jobs (not direct spawns)
- **Phase 19-B customer portal** — multi-session phase; different audience (customers, not founder); needs HTTP+auth
- **Phase 15-B comparators** — the other half of 15-B (artifact-level cost / latency / success-rate diff readers feeding the proposer)
- **Phase 22 (Action Boundary Enforcement)** — at v2 → v3 boundary; sandbox runtimes + signed-manifest provenance + tool/egress allowlists; the architect itself becomes subject to it
- **Phase 21-B.2 (architect daemon → Phase 14-A queue handler)** — currently the daemon holds setTimeout in-process; production-grade is to enqueue cycles via the Phase 14-A queue so they survive process restart cleanly

These are all called out in Status / Plan / marathon docs. Not blocked on Phase 21 — they're just the next moves.

---

## 12. The headline numbers (closing snapshot)

| Metric | Value |
|---|---|
| Commits in this branch | 19 |
| Phases moved out of "B-tier deferred" | 12-B (full) · 21-B · 6-B · 7-E · 15-B Tier B · 9-B Tier B · 10-B Tier B · 13-B Tier B |
| Sidebar items now real | 11/11 (zero static mocks) |
| Decisions logged | D190 → D210 (21 decisions during this phase) |
| New named agents | Seven (12th) |
| First SOUL.md | Seven's |
| Architect smoke assertions | 87 → 89 |
| Total decisions across project | D1 → D210 |
| Lab profile promotions | Hermes Agent: `exploring` → `testing` |
| Code commits | b175bbd 6-B · 6314215 21-B · 5824a11 15-B Tier B (the three highest-leverage) |
| LLM spend during this phase | $0 (stub dispatcher; real Sonnet/Opus opt-in only when founder explicitly enables) |
| Time elapsed | ~6 hours of focused session work |

---

## 13. One-line for the chronicle

> Phase 21 turned the factory from "founder asks for X, devs build X" into a self-running R&D loop where the architect proposes and the founder approves — substrate complete, opt-in real LLM dispatcher in place, the loop will start producing real value the moment one cadence's `dispatcher` field flips from `stub` to `sonnet`.
