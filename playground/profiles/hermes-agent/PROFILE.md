# Hermes Agent

**Org / Author**: [Nous Research](https://github.com/NousResearch/hermes-agent)
**Latest release**: v0.13 "Tenacity" (2026-05-07)
**License**: MIT
**Status**: **exploring**
**Profile owner**: subhash
**Last updated**: 2026-05-09

---

## What it is

Open-source self-improving agent framework launched 2026-02-25 by Nous Research. Ships persistent memory (FTS5 + Honcho + skills-as-procedural-memory), a 20-platform messaging gateway, a durable multi-agent Kanban with heartbeat / zombie reclaim / TTL, the `/goal` Ralph-loop primitive, and an autonomous skill curator. Weekly release cadence with hundreds of merged PRs per release. ~140K GitHub stars in 10 weeks. Distinct from the Hermes-3/4 LLM family (which is a separate product under the same Nous brand).

## Why we're testing it

Per Phase 2.76 D182 — Hermes ships several patterns the Agentryx roadmap has on the wishlist (Phase 9 multi-agent durability, Phase 7 dialectic memory, Phase 18 skill curation, Phase 10 multi-channel courier). Founder's specific call-out (2026-05-09) was "Hermes is on fire — should we expand its footprint?" The 2026-05 landscape scan answered "selectively yes."

- Gap addressed: **multiple** — Phase 9 durability, Phase 7-E dialectic memory, Phase 18 skill governance, Phase 10 courier (already planned in Phase 2.75 D74)
- Hypothesis: Hermes patterns + selected Hermes components reduce the bespoke-engineering burden on Phases 7-E / 9 / 10 / 18 by ≥50%
- Source: [Research/2026-05_Landscape_Scan.md §B](../../../pmd/Agentryx%20Dev%20Plan/Research/2026-05_Landscape_Scan.md)

## What we plan to adapt

| Hermes capability | Target stable module |
|---|---|
| Multi-agent Kanban (heartbeat + zombie-reclaim + circuit-breaker) | Phase 9 durability layer on top of existing Phase 14-A FS queue |
| Honcho dialectic memory backend | Phase 7-E (new) — between current filesystem memory and deferred 7-D vector |
| Curator pattern (skills health background pass) | Phase 18-B marketplace governance |
| `/goal` Ralph-loop primitive | Picard agent's goal-persistence layer |
| `SOUL.md` per-agent identity files | Each Star Trek agent gets one |
| Courier gateway (already planned) | Phase 10-B (per Phase 2.75 D74; reaffirmed) |

## Adaptation strategy

- [x] **Steal the patterns** for Phase 9 Kanban — own implementation on top of LangGraph, no Hermes runtime in the critical path
- [x] **Wrap + extend** Hermes for Phase 10 Courier — Hermes is the gateway, our adapter handles allowlists + audit + signing wrappers
- [x] **Adopt upstream** for Honcho (it's separable from Hermes; MIT)
- [x] **Steal the pattern** for Curator + `/goal` + `SOUL.md` (small; not worth a runtime dependency)
- [ ] ~~Adopt as primary runtime~~ — explicitly REJECTED (D182). LangGraph stays.

Rationale: Hermes is capabilities-rich and ships fast, but its security posture is immature (Issue #7826: 4 critical / 9 high). For an enterprise-direction dev factory, running Hermes as the runtime is too much exposure. Stealing patterns + wrapping selected components captures 80% of the upside with 20% of the risk.

## Integration sketch

- **DI registry**: `experimental` (Phase 18-A marketplace category, D188)
- **Feature flag**: `USE_HERMES_*` family — one per Hermes capability; all default off
  - `USE_HERMES_GATEWAY` (Phase 10 Courier when 10-B lands)
  - `USE_HERMES_KANBAN_PATTERNS` (gates the pattern-steal in Phase 9)
  - `USE_HONCHO_MEMORY` (gates the dialectic memory plug-in)
  - `USE_HERMES_CURATOR` (Phase 18-B)
- **Depends on**: Phase 14-A concurrency (Kanban builds on top); Phase 7-A memory-layer (Honcho extends it); Phase 18-A marketplace (manifest registration)
- **Anti-dependencies**: should not touch dev_graph / pre_dev / post_dev directly — all integration goes through the adapter

## Test plan

Reference scenario: `cognitive-engine/integration/composition-smoke.js`.

Specific scenarios:
1. **Stable baseline** — current state, no Hermes anywhere. Establishes our reference numbers.
2. **Honcho-augmented memory** — swap in Honcho as a memory backend layered over Phase 7-A filesystem store; same scenario.
3. **Kanban-pattern queue** — Phase 14-A queue extended with heartbeat + zombie-reclaim + circuit-breaker; same scenario.
4. **Both** — Honcho memory + Kanban patterns active.
5. **Hermes Courier** — gateway dispatch on a stub channel, comparing latency vs Phase 10-A's mock client.

Metrics:
- Wall-clock latency per stage
- Total LLM cost per run (when LLM calls involved)
- Assertion pass-rate against composition-smoke
- Tool-specific: Honcho recall latency, Kanban heartbeat overhead, Courier gateway dispatch time

Budget cap: $5 per scenario per month (target). Real Hermes runs use stub providers wherever possible.

## Learnings (running log)

> Append-only. Each entry dated.

- **2026-05-09** — Profile created. Status `exploring`. Reference: 2026-05 landscape scan + founder green-light. No code yet.

- **2026-05-11** — **Founder-prompted re-evaluation** ("Hermes has had a lot of development and hype — do we need to expand its role, or is our roadmap good enough until R1?"). Seven-style desk-research pass (no first-hand benchmarks yet; those still wait for Phase 21-B's dispatcher to run a real cycle). Findings:

  - **Releases since last look**: v0.13 "Tenacity" (2026-05-07) shipped Kanban durability + `/goal` Ralph loop + 8 P0 security closures. **v0.14 "Foundation"** (2026-05-16) added xAI Grok OAuth (1M ctx), OpenAI-compatible local proxy (lets Codex/Aider/Cline hit any Hermes OAuth provider), `x_search` first-class X tool, full Microsoft Teams stack. 808 commits / 633 PRs / 545 issues closed in 9 days. Cadence unchanged — blistering.

  - **Adoption signal**: ~140K stars in ~10 weeks; "fastest-growing agent framework of 2026" per multiple landscape scans. **Industry consensus has shifted** from "Hermes vs LangGraph" to *"Hermes 3 + LangGraph aren't competitors — they're layers"* (Hermes 3 as local reasoning engine, LangGraph for state persistence). This directly validates our 2026-05-09 hybrid stance.

  - **Memory plugin model matured**: Honcho is now one of **8 supported memory providers** in Hermes (v0.7+ restored Honcho to plugin parity with profile-scoped host/peer resolution). Means we can adopt Honcho **directly** when Phase 7-E opens, rather than pattern-stealing — saves ~2-3 days of bespoke work. **→ Update Phase 7-E plan when Cohort 3 opens.**

  - **Security trajectory**: improving but not safe yet. v0.13 closed 8 P0s; v0.8 → v0.13 surfaced 2 new CVEs in the meantime (**CVE-2026-6829** path traversal in WebUI, **CVE-2026-7113** missing auth on webhooks). Pattern: each release closes some, exposes others. **Reaffirms Phase 2.76 D185** (security hardening deferred to v2→v3) with a strengthening: **don't expose any Hermes component to public internet until our v3 pen-test pass**. Hermes-as-Courier-gateway stays internal-only until then.

  - **Hermes 3 8B local model** (separate from the framework — separate product under same Nous brand): 91% tool-call accuracy at 8GB VRAM on Ollama is genuinely interesting for **Phase 16-B training-gen** (cheap voice-narration text) and possibly as a fallback in our LLM router. Park for now; revisit when 16-B opens.

  **Verdict (Seven-style, 2026-05-11)**: **PASS for now; RE-EVALUATE at next monthly cadence (~2026-06-10)**. Our hybrid roadmap from 2026-05-09 is still right. Nothing in v0.14 or the May-2026 landscape demands re-architecting before R1.

  **Explicit non-recommendations**:
  - ❌ Switching from LangGraph to Hermes-as-runtime (security surface + pace-of-change risk for production stability).
  - ❌ Bringing forward Hermes gateway adoption ahead of Phase 10-B (entangles scope unnecessarily).
  - ❌ Investing in Hermes 3 8B local routing before 16-B opens (premature; LLM-router is fine for v0.0.1).

  **Single roadmap adjustment captured**: when Phase 7-E gets revisited, prefer **direct Honcho adoption** over the original "pattern-steal" approach.

  Founder direction (this date): "continue development; let's try to complete the entire platform." Following through — re-eval is recorded; substrate ships continue uninterrupted.

  Sources consulted (web search 2026-05-11):
  - Hermes v0.13 + v0.14 release notes (NousResearch/hermes-agent releases)
  - Hermes vs LangChain comparisons (Respan, Hermes-agent.ai/vs/langchain, gurusup multi-agent frameworks 2026)
  - Honcho memory docs + memory-providers comparison (vectorize.io)
  - Security audit issue #7826 + CVE-2026-6829 (SentinelOne) + CVE-2026-7113

  Next concrete action: when 21-B dispatcher runs the first real cycle (founder gates this — flip `USE_ARTIFACT_STORE=on`, set Monthly cadence dispatcher to `sonnet`), Seven should be scheduled the first first-hand benchmark task: Hermes Kanban vs Phase 14-A queue on the composition-smoke scenario, with measurement budget capped at $5.

## Security findings (parked until v3)

> Per Phase 2.76 D185, recorded but non-gating during v0.0.1 → v2.

- Default config is **ALLOW-ALL** (Issue #7826).
- 4 critical findings: unrestricted shell, unrestricted file reading, containerised backends skip approval, persistent skill-poisoning vector.
- 9 high findings: YOLO mode, LLM-based auto-approval bypass, write restrictions bypassed via terminal, opt-in (not opt-out) write sandboxing, arbitrary Python from hooks, unsandboxed plugin loading, regex-only skills validation, unpinned git deps, non-interactive auto-approval.
- v0.13 added "8 critical security fixes" + redaction-by-default — but threat model around skill poisoning, signed provenance, and audit trail still unresolved.
- Aggregated for v2 → v3 hardening pass.

## Decision (when ready)

> Filled when status moves to `adopting` or `rejecting`.

- **Verdict**: TBD
- **Date**: TBD
- **Cited in**: Phase 2.76 D182 (provisional)
- **Graduates to**: per-capability targets above

## References

- Upstream repo: https://github.com/NousResearch/hermes-agent
- Documentation: https://hermes-agent.nousresearch.com/docs/
- v0.13 release notes: https://github.com/NousResearch/hermes-agent/releases
- Security audit (Issue #7826): https://github.com/NousResearch/hermes-agent/issues/7826
- Our Research scan: [Research/2026-05_Landscape_Scan.md §B](../../../pmd/Agentryx%20Dev%20Plan/Research/2026-05_Landscape_Scan.md#b-hermes-deep-dive)
- Our Phase Decision: [Phase_2.76_Decisions.md D182](../../../pmd/Agentryx%20Dev%20Plan/D.Roadmap/Phase_2.76_Lab_and_Strategy_Update_2026_05/Phase_2.76_Decisions.md#d182--hermes-footprint-expansion-via-pattern-steal--selective-adoption)
