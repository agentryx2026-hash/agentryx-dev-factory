# LangChain Deep Agents

**Org / Author**: [LangChain](https://github.com/langchain-ai/deepagents)
**Latest release**: 2026-03 update (date pending verification)
**License**: MIT (Apache-compatible LangChain stack)
**Status**: **exploring**
**Profile owner**: subhash
**Last updated**: 2026-05-09

---

## What it is

LangChain's reference implementation of the "deep agent" pattern: planning + filesystem + subagents + skills, layered on top of LangGraph. Released July 2025; major March 2026 update added the `deepagents deploy` single-command production deploy. NVIDIA AI-Q Blueprint partnership cited.

Deep Agents is closer to the Agentryx mental model than raw LangGraph — explicit planning step, multi-agent subagent dispatch, filesystem-aware reasoning, skill-based capability injection. JS package available alongside the original Python.

## Why we're testing it

Per Phase 2.76 D184 — Deep Agents is a JS-native implementation of the same coordinator+subagent pattern Agentryx builds in Phase 9. Same vendor as our LangGraph runtime; tightly compatible. If Deep Agents satisfies our coordinator needs, Phase 9 might collapse from "design + build" to "configure + extend."

- Gap addressed: **Phase 9** coordinator + subagent dispatch
- Hypothesis: Deep Agents covers ≥70% of Phase 9's planned scope; remaining 30% becomes our own Picard/Sisko/Troi-specific extensions
- Source: [Research/2026-05_Landscape_Scan.md §A](../../../pmd/Agentryx%20Dev%20Plan/Research/2026-05_Landscape_Scan.md#a-multi-agent-orchestrator-state-of-the-field)

## What we plan to adapt

Use Deep Agents as the **Phase 9 reference implementation** for the coordinator pattern. Our Star Trek agents (Picard / Sisko / Troi / etc.) become Deep Agents subagent registrations. The `deepagents deploy` model also informs Phase 16 (production deployment).

## Adaptation strategy

- [x] **Adopt upstream + extend** for Phase 9 — Deep Agents as the harness, our agents as subagent registrations
- [x] **Steal the pattern** of `deepagents deploy` for Phase 16

Rationale: Deep Agents is from the same vendor as our existing runtime, so integration friction is near-zero. The pattern is well-documented and battle-tested. If we built our own coordinator, we'd reinvent what already works.

## Integration sketch

- **DI registry**: `experimental` (will graduate to `handler` when adopted)
- **Feature flag**: `USE_DEEP_AGENTS_COORDINATOR` (default off)
- **Depends on**: Phase 14-A concurrency (Deep Agents subagents run on top of our queue), Phase 5-A MCP (tools), existing LangGraph runtime
- **Phase mapping**: candidate Phase 9-A coordinator implementation

## Test plan

Reference scenario: `cognitive-engine/integration/composition-smoke.js`.

Specific scenarios:
1. **Stable baseline** — no Deep Agents.
2. **Deep Agents as coordinator** — Picard becomes a Deep Agents top-level agent; Sisko/Troi/Jane/Spock/etc. become subagents.
3. **Production deploy** — small `deepagents deploy` run to validate single-command production pattern.

Metrics:
- Wall-clock latency end-to-end
- LLM cost per run
- Subagent dispatch overhead (Deep Agents harness vs hand-rolled LangGraph)
- Pass-rate on composition-smoke

Budget cap: $5 per scenario per month.

## Learnings (running log)

- **2026-05-09** — Profile created. Status `exploring`. No code yet.

## Security findings (parked until v3)

- TBD on first contact. Deep Agents inherits LangGraph's security posture, which is more conservative than Hermes' but still requires audit at v3.

## Decision (when ready)

- **Verdict**: TBD
- **Date**: TBD
- **Cited in**: Phase 2.76 D184
- **Graduates to**: candidate Phase 9-A implementation

## References

- Upstream repo: https://github.com/langchain-ai/deepagents
- Documentation: https://www.langchain.com/deep-agents
- LangChain April 2026 newsletter: https://www.langchain.com/blog/april-2026-langchain-newsletter
- Our Research scan: [Research/2026-05_Landscape_Scan.md](../../../pmd/Agentryx%20Dev%20Plan/Research/2026-05_Landscape_Scan.md)
- Our Phase Decision: [Phase_2.76_Decisions.md D184](../../../pmd/Agentryx%20Dev%20Plan/D.Roadmap/Phase_2.76_Lab_and_Strategy_Update_2026_05/Phase_2.76_Decisions.md#d184--langchain-deep-agents-as-phase-9-coordinator-candidate)
