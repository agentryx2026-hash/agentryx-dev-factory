# Phase 2.76 — Decisions Log

8 decisions establish the Beta Playground capability + the v0.0.1 → v3 release-band schedule + the expanded Hermes footprint. Decisions are sequential (D181 → D188) per the global counter.

---

## D181 — Beta Playground as a permanent capability

**What**: Add a top-level `playground/` directory alongside `cognitive-engine/`. Every meaningful new external tool the field ships gets a profile under `playground/profiles/<slug>/`. Profiles cycle through states (`watching` → `exploring` → `testing` → `adopting`/`rejecting`/`parked`) under a monthly review cadence. The Lab is permanent infrastructure, not a one-off evaluation effort.

**Why**:
- The AI ecosystem moves faster than any single team can absorb. Predicting winners failed Phase 2.75 (we slated Hermes as Courier-only, but Hermes shipped multi-agent Kanban in v0.13 we'd want regardless). Active testing beats prediction.
- Founder's framing 2026-05-09: "we should have one working pipeline that we can test, and then we should have optional components that we can plug into our pipeline and see their results or impact."
- Phase 18-A marketplace was the right primitive — we just hadn't named the experimental tier. The Lab is the practice; the marketplace is the substrate.
- The Lab also serves as **the launching pad for our own innovations**. A tool that fails to satisfy us but reveals a clear pattern is the seed of something we build ourselves. "Next Hermes or next OpenCLAW" framing is real.

**Tradeoff**: maintenance overhead. Each profile takes ongoing attention. Mitigation: monthly review cadence forces decisions; profiles that linger two release-band cycles without progress get parked, not perpetually open.

## D182 — Hermes footprint expansion via pattern-steal + selective adoption

**What**: Phase 2.75 D74 established Hermes for Courier (Phase 10) + agentskills (Phase 18) + patterns for Memory (Phase 7) and Self-improve (Phase 15). D182 expands this:

- **Adopt upstream**: Honcho (separable from Hermes; MIT)
- **Wrap + extend**: Hermes Courier gateway (Phase 10-B; reaffirms 2.75 D74)
- **Steal the patterns**: Multi-agent Kanban (heartbeat + zombie-reclaim + circuit-breaker; Phase 9 durability layer); Curator (Phase 18-B skills health); `/goal` Ralph-loop primitive (Picard agent); `SOUL.md` per-agent identity files
- **Reject as runtime replacement**: Hermes does NOT replace LangGraph as the primary agent runtime. Security posture is too immature for that role.

**Why**:
- 2026-05 landscape scan documented Hermes' rapid capability growth (v0.10 → v0.13 in ~3 weeks shipped major durability + multi-agent + memory features).
- Hermes' architecture maps cleanly onto multiple Agentryx phase gaps simultaneously — this is rare; capture the value.
- Stealing patterns (vs adopting upstream) keeps the runtime in our control. Hermes has 4 critical / 9 high security findings (Issue #7826) and weekly major-version cadence; both are anti-features for a runtime dependency.
- LangGraph remains validated by Klarna / Uber / LinkedIn at production scale + LC 1.0 GA stable.

**Tradeoff**: pattern-steal means we re-implement (engineering cost). Acceptable — the patterns are bounded; reimplementing under our control is a one-time cost that buys long-term safety.

## D183 — Honcho as Phase 7-E candidate memory backend

**What**: Add a new Phase 7-E in the roadmap targeting Honcho integration as a dialectic memory backend, between current 7-A (filesystem) and deferred 7-B/C/D (sqlite/postgres/vector). Lab profile installed at `playground/profiles/honcho/`. Adoption strategy: adopt upstream (separable, MIT, no Hermes dependency).

**Why**:
- Phase 7-A's filesystem-only setup maps to Hermes' `MEMORY.md` + FTS5 layer. The dialectic-inference layer (implicit user/project modelling derived from conversation history) is the genuine architectural gap.
- Honcho is the open-source separable component that fills it — distinct from Hermes' broader stack.
- ~1 week of integration when promoted to stable; immediate quality-of-context win for every named agent.

**Tradeoff**: Honcho adds an LLM-cost-per-dialectic-update overhead. Mitigation: Haiku-tier should suffice; budget cap per project tracked in PROFILE.md.

## D184 — LangChain Deep Agents as Phase 9 coordinator candidate

**What**: Add a Lab profile for LangChain Deep Agents as a candidate Phase 9 coordinator implementation. Adoption strategy: adopt upstream + extend (our Star Trek agents become subagent registrations). Steal the `deepagents deploy` pattern for Phase 16 production deployment.

**Why**:
- Same vendor as our existing LangGraph runtime → near-zero integration friction.
- Deep Agents covers ~70% of Phase 9's planned scope. The remaining 30% (Picard/Sisko/Troi/etc. specifics) becomes our extensions.
- `deepagents deploy` single-command production deploy is a proven Phase 16 pattern.

**Tradeoff**: takes a runtime dependency on LangChain's harness layer (in addition to LangGraph's runtime). LangChain has been stable about this stack; the risk is bounded.

## D185 — Thinking Machines / Tinker watching profile

**What**: Founder identified Mira Murati's Thinking Machines Lab as a long-term high-priority research target. Lab profile installed at `playground/profiles/thinking-machines-tinker/` with `status: watching`. Tinker is in private beta; profile tracks the lab's releases monthly. Once Tinker exits beta, profile transitions to `exploring` → `testing` against a Phase 15-C / 15-D specialist-model training experiment.

**Why**:
- Murati's lab has unique strategic background (former OpenAI CTO, deep model-training credibility). Following hands-on (not just reading reviews) is high-information.
- Tinker + Atropos is the credible path to specialist-model training for Agentryx's Phase 15 self-improvement (DeepHermes specialists reportedly hit 2.5–4.6× task gains via this stack).
- Watching profile costs $0 until Tinker exits beta. Founder request explicit (2026-05-09): "I would like to keep testing what she is delivering, what she's shipping in the beta playground."

**Tradeoff**: long lead time before integration is possible (Tinker GA timing TBD). Profile remains `watching` indefinitely; cost of holding is monthly attention only.

## D186 — Anthropic Agent Teams as third coordinator candidate

**What**: Lab profile for Anthropic's experimental Agent Teams primitive (Claude Code SDK). Three-way Phase 9 coordinator comparison: LangGraph (current) vs Deep Agents (D184) vs Agent Teams (D186). Decision at v3 boundary.

**Why**:
- Claude Agent SDK is already a runtime dependency for Agentryx development. Testing Agent Teams costs nothing.
- If Agent Teams is mature enough, the development environment IS the runtime — minimal impedance.
- Three-way comparison gives data, not vibes.

**Tradeoff**: Agent Teams is `experimental`; API can change without notice. Mitigation: keep the other two coordinator candidates active in the Lab as fallbacks until v3.

## D187 — Lab cadence: monthly review + hard re-evaluation at release-band cuts

**What**:
- **Monthly review** (last Friday): walk every active profile; bump status; add Learnings; decide whether to keep going, park, or graduate / reject.
- **Hard re-evaluation** at every release-band cut (v0.0.1 → v1, v1 → v2, v2 → v3): each profile must have a clear verdict.
- **Drop-in welcome anytime**: alpha / beta tools can land between cadences.

**Why**:
- Without cadence, profiles linger and the Lab becomes a graveyard of half-tested ideas.
- Without hard release-band cuts, profiles never get forced to a decision.
- Without drop-in welcome, we miss alpha-stage tools that sometimes carry the most strategic information.

**Tradeoff**: monthly review is a recurring cost. Mitigation: profiles parked after 2 release-band cycles without progress; review is short for parked items.

## D188 — `experimental` added to Marketplace ModuleCategory enum

**What**: `cognitive-engine/marketplace/types.js::MODULE_CATEGORIES` extended from 9 to 10 categories. New value `"experimental"` reserved for Beta Playground profiles. The marketplace's `installer`, `store`, `validateManifestShape`, and dependency-resolution all work unchanged — `experimental` is just a new enum member.

Lab profile graduation = recategorisation: a profile that adopted moves from `category: "experimental"` to its proper stable category in the same marketplace store. The store records the change in its append-only audit log.

**Why**:
- Phase 18-A marketplace was built for exactly this purpose. The `experimental` category was always implicit; D188 makes it explicit.
- Single source of truth for "what's installed where, including experimental?" — adminstration UI (12-B / 18-B) gets it for free.
- Promotion path is mechanical: `setStatus` + recategorise + audit. No bespoke "graduation" flow.

**Tradeoff**: the marketplace's smoke test was hardcoded to expect 9 categories — needed a one-line update (8 → 10 with the new "9 stable + 1 experimental" comment). Worth the bookkeeping.

## D189 — Release-band schedule update: v0.0.1 → v1 → v2 → v3 production at ~5-6 months

**What**: Founder confirmed (2026-05-09) the user-facing version schedule:
- **v0.0.1** = current — A-tier substrate complete; internal R&D
- **v1** = in-house testing of B-tier integrations + Lab promotions; internal-only
- **v2** = advanced internal testing + first external pilot users (no production data)
- **v3** = production-grade; first real customer projects with stakes; **target ~5-6 months out from 2026-05-09 (i.e., 2026-Q4 / 2027-Q1)**

Master_Factory_Architect § 1 already had R1-R5 architectural bands. The user-facing v0.0.1 → v3 maps onto R1-R3 with a tighter schedule than the original r0.1 estimate (which had R3 at month 6-9). This update compresses to ~5-6 months for production.

**Why**:
- Founder explicit decision based on what 100% A-tier coverage achieved.
- Aligns the Lab cadence (D187 hard re-evaluations at version cuts) with the release-band horizons.
- Security gating shifts to the v3 boundary (no enterprise-grade hardening required during v0.0.1 → v2).

**Tradeoff**: tighter than original Master Factory Architect r0.1 estimate. We may slip to month 7-8 for v3 production if B-tier marathon hits unexpected friction. Acceptable; the schedule is aspirational, not contractual.

## Decision counter

- D1–D165: Phases 0-18
- D166–D172: Phase 19 (Customer Portal)
- D173–D180: Phase 20 (Public Release)
- **D181–D189: Phase 2.76 (this phase)**
- Future: Phase 21+ work continues from D190
