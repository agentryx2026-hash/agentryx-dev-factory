# Thinking Machines Lab — Tinker + future products

**Org / Author**: [Thinking Machines Lab](https://thinkingmachines.ai/) — Mira Murati's research lab (announced 2025-10-01)
**Latest release**: Tinker (private beta, waitlist; LoRA training API for distributed RL post-training)
**License**: proprietary API; pricing TBA
**Status**: **watching**
**Profile owner**: subhash
**Last updated**: 2026-05-09

---

## What it is

Thinking Machines Lab is Mira Murati's AI research startup. Tinker is their first publicly-announced product — a Python API for fine-tuning large language models via LoRA (Low-Rank Adaptation), targeting researchers and small teams who want to do distributed reinforcement-learning post-training without managing GPU clusters. Currently in private beta; free during beta, paid pricing TBA.

Distinct from but **related to** Nous Research's Atropos: Atropos is the rollout-coordinator + RL-environments framework; Atropos calls Tinker as its training backend. So "Hermes-Tinker-Atropos" really means "Atropos environments running training jobs through the Tinker API."

This profile is **broader than just Tinker**. It tracks Mira Murati's lab in aggregate. Whatever they ship next gets tracked here under a sub-section.

## Why we're testing it

Per Phase 2.76 D185 (founder request, 2026-05-09) — Mira Murati has unique strategic background (former OpenAI CTO, deep model-training credibility). Following her work hands-on (not just reading reviews) is a high-information bet on what advanced model-training infrastructure will look like in late 2026 / 2027. Even if Tinker itself doesn't graduate to a stable Agentryx module, the patterns it establishes likely shape the field.

Specific Phase 15-C / 15-D consideration: Tinker + Atropos enables training small specialist models (like Hermes' DeepHermes-ToolCalling-Specialist with reported 2.5–4.6× task gains). Agentryx's self-improvement phase (15) eventually wants to do exactly this — train small specialists for specific factory roles based on accumulated trajectory data.

- Gap addressed: **Phase 15-C/D** — model fine-tuning for specialist factory roles
- Hypothesis: Tinker + Atropos becomes a Phase 15-C training backend once Tinker exits beta
- Source: founder direct request 2026-05-09 + [Research/2026-05_Landscape_Scan.md §B Tinker clarification](../../../pmd/Agentryx%20Dev%20Plan/Research/2026-05_Landscape_Scan.md#tinker--clarification)

## What we plan to adapt

Hold a watching profile until Tinker exits beta. When it does:
1. Apply for production access.
2. Run a small experiment: fine-tune a specialist model for one specific Agentryx role (e.g., a Picard-tier architect specialist) using accumulated trajectory data from Phase 6-A artifacts.
3. Compare specialist vs generalist performance on composition-smoke and on real factory runs.
4. Decision based on data: adopt as Phase 15-C training backend, or document why not and stay on generalist models.

Anything else Thinking Machines Lab ships gets a sub-profile here.

## Adaptation strategy

- [x] **Watch and document** until Tinker GA
- [ ] Adopt upstream — pending GA + measured ROI
- [ ] Build our own — only if Tinker pricing or capabilities don't fit; very unlikely to make sense

Rationale: Thinking Machines Lab is a top-tier team with a clear vision. Reimplementing what they ship is unlikely to be a good use of engineering time. Following them and adopting selectively is the right pattern.

## Integration sketch

- **DI registry**: `experimental` (long-running watch profile; integration target is Phase 15-C/D)
- **Feature flag**: `USE_TINKER_TRAINING` (default off; not registered until Tinker exits beta)
- **Depends on**: Phase 15-A self-improvement substrate (already shipped); Phase 6-A artifacts (training data source)
- **Phase mapping**: candidate Phase 15-C / 15-D training backend

## Test plan

**Phase 1 (current — `watching`)**: Track Thinking Machines Lab releases. Update this PROFILE.md monthly with any new product / blog post / paper. Apply for Tinker waitlist; add `tinker_access: granted_at: ...` to learnings when it lands.

**Phase 2 (post-GA — `exploring`)**: Once Tinker is GA, run a single training experiment on a focused specialist (Picard architect specialist using accumulated artifacts as training data). Measure specialist-vs-generalist on composition-smoke + 3 real factory runs.

**Phase 3 (`testing`)**: If Phase 2 shows ≥1.5× improvement on the specialist's role, integrate as Phase 15-C training backend.

Budget caps:
- Phase 1: $0
- Phase 2: $50 single training run + $20 inference comparison
- Phase 3: $200/month for ongoing specialist refresh cycles

## Learnings (running log)

- **2026-05-09** — Profile created. Status `watching`. Founder identified Mira Murati's lab as a long-term high-priority research target. Tinker is private beta with waitlist; no Agentryx applicant yet.

## Security findings (parked until v3)

- Tinker handles training data, which for Agentryx would include accumulated artifact content (potentially containing customer-proprietary IP). v3 hardening must include: data residency, PII handling, training-data provenance, output model provenance signing.

## Decision (when ready)

- **Verdict**: TBD (likely deferred 5+ months until Tinker exits beta)
- **Date**: TBD
- **Cited in**: Phase 2.76 D185
- **Graduates to**: Phase 15-C / 15-D training backend (candidate)

## References

- Thinking Machines Lab: https://thinkingmachines.ai/
- Tinker product page: https://thinkingmachines.ai/tinker/
- Mira Murati's announcement (2025-10-01): https://thinkingmachines.ai/ (initial announcement; verify URL on first refresh)
- Atropos (Nous Research; calls Tinker as backend): https://github.com/nousresearch/atropos
- Hermes RL training docs (Tinker integration): https://hermes-agent.nousresearch.com/docs/user-guide/features/rl-training
- Our Research scan: [Research/2026-05_Landscape_Scan.md §B Tinker](../../../pmd/Agentryx%20Dev%20Plan/Research/2026-05_Landscape_Scan.md#tinker--clarification)
- Our Phase Decision: [Phase_2.76_Decisions.md D185](../../../pmd/Agentryx%20Dev%20Plan/D.Roadmap/Phase_2.76_Lab_and_Strategy_Update_2026_05/Phase_2.76_Decisions.md#d185--thinking-machines--tinker-watching-profile)
