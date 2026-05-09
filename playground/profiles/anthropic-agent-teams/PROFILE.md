# Anthropic Agent Teams (Claude Code)

**Org / Author**: [Anthropic](https://code.claude.com/docs/en/agent-teams)
**Latest release**: experimental; ships inside Claude Code (live as of May 2026)
**License**: proprietary (consumed via Claude Code)
**Status**: **exploring**
**Profile owner**: subhash
**Last updated**: 2026-05-09

---

## What it is

Anthropic's built-in multi-agent orchestration inside Claude Code — `parent_tool_use_id` + experimental Agent Teams primitive. Lets Claude Code spawn subagents that coordinate via a shared `parent_tool_use_id`; subagents have their own context window but share the orchestration state.

This is meaningful for Agentryx because Claude Code is the meta-agent SDK we already use to build the factory itself. If Agent Teams is mature enough to power a production factory pipeline, we'd be running on the same SDK we develop against — minimal impedance mismatch.

## Why we're testing it

Per Phase 2.76 D186 — the cheapest possible head-to-head: we already use Claude Code daily; testing Agent Teams costs nothing. If it works for the factory's coordination story, half of Phase 9 might be replaceable with native SDK primitives.

- Gap addressed: **Phase 9** multi-agent coordination
- Hypothesis: Agent Teams + Claude Code SDK is a serviceable Phase 9 runtime — possibly preferable to LangGraph or Deep Agents because the development environment IS the runtime
- Source: [Research/2026-05_Landscape_Scan.md §A](../../../pmd/Agentryx%20Dev%20Plan/Research/2026-05_Landscape_Scan.md) + Anthropic Claude Code documentation

## What we plan to adapt

If Agent Teams matures past `experimental`: use it as an **alternative Phase 9 coordinator** behind a feature flag. Run side-by-side with LangGraph and Deep Agents during v0.0.1 → v2; pick a default at v3.

## Adaptation strategy

- [x] **Adopt upstream** if Agent Teams becomes stable
- [x] **Steal the pattern** of `parent_tool_use_id` for trace lineage even if we don't adopt the runtime

Rationale: Anthropic-native multi-agent has the lowest integration cost because Agentryx already runs on Claude Code. Risk: Agent Teams is `experimental`; Anthropic could remove it or change the API. Mitigation: keep LangGraph and Deep Agents in the Lab roster as fallbacks.

## Integration sketch

- **DI registry**: `experimental`
- **Feature flag**: `USE_ANTHROPIC_AGENT_TEAMS` (default off)
- **Depends on**: Claude Agent SDK (already a runtime dependency for development)
- **Phase mapping**: alternative Phase 9 coordinator implementation

## Test plan

Reference scenario: `cognitive-engine/integration/composition-smoke.js`.

Specific scenarios:
1. **Stable baseline** — current state.
2. **Agent Teams coordinator** — Picard runs as a Claude Code parent agent; subagents dispatched via `parent_tool_use_id`.
3. **Three-way comparison** — same scenario through LangGraph (current), Deep Agents (Tier 1 profile), and Agent Teams. Measure all three.

Metrics:
- Wall-clock latency
- LLM cost per run
- Coordination overhead (cost of spawning + collecting subagent results)
- Quality delta vs baseline

Budget cap: $5 per scenario per month.

## Learnings (running log)

- **2026-05-09** — Profile created. Status `exploring`. No code yet.

## Security findings (parked until v3)

- Anthropic's safety posture is the strongest of the candidates evaluated — generally lower v3 hardening burden.
- `experimental` status means API can change without notice; pin to a known-good version at v3 boundary.

## Decision (when ready)

- **Verdict**: TBD
- **Date**: TBD
- **Cited in**: Phase 2.76 D186
- **Graduates to**: alternative Phase 9 coordinator (if matured)

## References

- Upstream docs: https://code.claude.com/docs/en/agent-teams
- Claude Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Our Research scan: [Research/2026-05_Landscape_Scan.md](../../../pmd/Agentryx%20Dev%20Plan/Research/2026-05_Landscape_Scan.md)
- Our Phase Decision: [Phase_2.76_Decisions.md D186](../../../pmd/Agentryx%20Dev%20Plan/D.Roadmap/Phase_2.76_Lab_and_Strategy_Update_2026_05/Phase_2.76_Decisions.md#d186--anthropic-agent-teams-as-third-coordinator-candidate)
