# <Tool name>

**Org / Author**: [link to upstream project]
**Latest release**: vX.Y.Z (date)
**License**: [MIT / Apache 2.0 / commercial / etc.]
**Status**: [watching | exploring | testing | adopting | rejecting | parked]
**Profile owner**: [name / handle]
**Last updated**: YYYY-MM-DD

---

## What it is

[1-paragraph description, the kind of summary that goes into a research scan. Include: the problem it solves, the audience it targets, and the differentiator over comparable tools.]

## Why we're testing it

[Specific gap or hypothesis it addresses. Cite the Research scan or Phase Decision that surfaced it.]

- Gap addressed: [e.g. "Phase 9 multi-agent durability"]
- Hypothesis: [e.g. "Hermes Kanban heartbeat + zombie-reclaim pattern obviates the need for a custom durability layer"]
- Source: [link to Research scan or Phase Decision]

## What we plan to adapt

[What we'd take into the stable substrate if testing validates the hypothesis. Be specific about which `cognitive-engine/<module>/` it would graduate to.]

## Adaptation strategy

Pick one (or more):
- [ ] **Adopt upstream**: install the tool as-is, wrap behind our DI registry
- [ ] **Fork**: take a snapshot, diverge on our own roadmap
- [ ] **Steal the pattern**: build our own implementation; reference upstream as design inspiration
- [ ] **Wrap + extend**: keep upstream as core; layer our own additions on top
- [ ] **Complement**: keep upstream and a custom alternative side-by-side; let users pick per project

Rationale:
[Why this strategy over the others.]

## Integration sketch

[How the tool slots into our pipeline. Be concrete:]
- DI registry it plugs into: [`provider` | `handler` | `proposer` | `generator` | `experimental` | etc.]
- Feature flag that gates it: `USE_<TOOL>` (default off, registered in admin-substrate)
- Other modules it depends on: [e.g. "Phase 7-A memory-layer" or "Phase 18-A marketplace"]
- Anti-dependencies (modules that should NOT touch it): [if any]

## Test plan

Reference scenario: `cognitive-engine/integration/composition-smoke.js` (cross-phase composition smoke).

Specific scenarios:
1. [e.g. "Stable baseline run — establishes our reference numbers"]
2. [e.g. "Same scenario with Hermes Kanban replacing Phase 14-A FS queue"]
3. [e.g. "Same scenario with Hermes Kanban + Honcho memory both swapped in"]

Metrics to measure:
- Wall-clock latency per stage
- Total LLM cost per run (when LLM calls involved)
- Assertion pass-rate
- Tool-specific metric: [e.g. "Hermes heartbeat frequency", "Honcho cost per recall"]

Budget cap (if real LLM calls): $X per run, $Y per month total.

## Learnings (running log)

> Append-only. Each entry dated. Never edit prior entries — add new ones.

- **YYYY-MM-DD** — [observation, with metric or quote]
- **YYYY-MM-DD** — [observation]

## Security findings (parked until v3)

> Per Phase 2.76 D185, security observations are recorded but don't gate Lab work during v0.0.1 → v2. Aggregated for the v3 hardening pass.

- [e.g. "Default config is ALLOW-ALL; persistent skill-poisoning vector unfixed (upstream Issue #7826)"]

## Decision (when ready)

> Filled when status moves to `adopting` or `rejecting`.

- **Verdict**: [adopt-upstream | fork | steal-pattern | reject]
- **Date**: YYYY-MM-DD
- **Cited in**: `Phase_NN_Decisions.md` D[xxx]
- **Graduates to**: [`cognitive-engine/<new-module-name>/` if adopting]
- **Rationale**: [1-paragraph summary]

## References

- Upstream repo: [link]
- Documentation: [link]
- Latest release notes: [link]
- Our Research scan: [link to landscape scan that surfaced this]
- Our Phase Decision: [link to Phase_NN_Decisions.md entry that authorised the profile]
