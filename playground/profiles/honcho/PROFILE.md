# Honcho

**Org / Author**: [Plastic Labs](https://github.com/plastic-labs/honcho) · [docs.honcho.dev](https://docs.honcho.dev)
**Latest release**: 2026 stable (date pending verification at first contact)
**License**: MIT
**Status**: **exploring**
**Profile owner**: subhash
**Last updated**: 2026-05-09

---

## What it is

Open-source dialectic memory backend. Derives an *implicit* user / project / context model by reasoning about conversations *after* they happen, separate from the live agent loop. Adopted by Hermes Agent as one of three memory layers (FTS5 + Honcho + skills-as-procedural). Independent product — works as a standalone backend without Hermes.

The "dialectic" framing: classic memory systems store facts the agent put there explicitly. Honcho infers a model the user *didn't tell you* — communication style, preferences, repeated topics, pain points — by reasoning over recent dialogue.

## Why we're testing it

Per Phase 2.76 D183 — Honcho fills the biggest gap in the Phase 7-A memory layer plan: implicit user / project modelling derived from conversation history. The current Phase 7 plan has filesystem (7-A done), sqlite/postgres/vector (7-B/C/D deferred), but no layer that *infers* a model. Honcho is the layer that does this without bespoke summarisation.

- Gap addressed: **Phase 7-E** — implicit user / project modelling
- Hypothesis: Honcho as a Phase 7-E backend gives every named agent (Picard / Sisko / Troi / etc.) a deepening understanding of the user / project without requiring custom summarisation prompts
- Source: [Research/2026-05_Landscape_Scan.md §B Memory architecture](../../../pmd/Agentryx%20Dev%20Plan/Research/2026-05_Landscape_Scan.md#memory-architecture-this-is-the-hidden-gem)

## What we plan to adapt

Adopt as **Phase 7-E** stable module: `cognitive-engine/memory-layer/backends/honcho.js`. Sits alongside the existing filesystem backend; agent code calls the higher-level memory service which routes by query type.

## Adaptation strategy

- [x] **Adopt upstream** as Phase 7-E. MIT-licensed; separable; no runtime dependency on Hermes.

Rationale: Honcho is a focused dialectic-memory backend with a clear API. There's no architectural advantage to reimplementing it; the value is in the dialectic-reasoning pattern, not the storage substrate. We adopt and let the upstream team iterate; we layer our memory-layer service on top to route between Honcho and the filesystem backend.

## Integration sketch

- **DI registry**: `memory_backend` once it graduates to stable; `experimental` while in the Lab
- **Feature flag**: `USE_HONCHO_MEMORY` (default off)
- **Depends on**: Phase 7-A `memory-layer/service.js` (extends it, not replaces)
- **Phase mapping**: candidate Phase 7-E

## Test plan

Reference scenario: `cognitive-engine/integration/composition-smoke.js` extended with a "user makes 5 requests over time" sub-scenario.

Specific scenarios:
1. **Stable baseline** — composition-smoke as-is, filesystem-only memory.
2. **Honcho layered** — same scenario; agents read user/project model from Honcho. Compare: do agent responses become more contextually appropriate?
3. **Recall latency** — Honcho recall vs filesystem recall. Honcho carries inference cost per turn.

Metrics:
- Recall latency (target: < 200ms per query)
- Quality delta — measured by composition-smoke's existing assertions about agent context fidelity (extend the assertion set if needed)
- Cost per dialectic-update — Honcho needs an LLM to do the dialectic reasoning; how much per session?

Budget cap: $3 per scenario per month. Honcho's reasoning is light; Haiku-tier should suffice.

## Learnings (running log)

- **2026-05-09** — Profile created. Status `exploring`. No code yet.

## Security findings (parked until v3)

- TBD on first contact. Honcho is a separate codebase from Hermes; the Hermes audit findings don't transfer automatically.

## Decision (when ready)

- **Verdict**: TBD (default expectation: `adopt-upstream` per Phase 2.76 D183)
- **Date**: TBD
- **Cited in**: Phase 2.76 D183
- **Graduates to**: `cognitive-engine/memory-layer/backends/honcho.js` as Phase 7-E

## References

- Upstream repo: https://github.com/plastic-labs/honcho
- Documentation: https://docs.honcho.dev
- Hermes' Honcho integration: https://hermes-agent.nousresearch.com/docs/user-guide/features/honcho
- Our Research scan: [Research/2026-05_Landscape_Scan.md](../../../pmd/Agentryx%20Dev%20Plan/Research/2026-05_Landscape_Scan.md)
- Our Phase Decision: [Phase_2.76_Decisions.md D183](../../../pmd/Agentryx%20Dev%20Plan/D.Roadmap/Phase_2.76_Lab_and_Strategy_Update_2026_05/Phase_2.76_Decisions.md#d183--honcho-as-phase-7-e-candidate-memory-backend)
