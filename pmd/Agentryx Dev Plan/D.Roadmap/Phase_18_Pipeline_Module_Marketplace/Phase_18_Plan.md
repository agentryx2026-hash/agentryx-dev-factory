# Phase 18 — Pipeline Module Marketplace

**One-liner**: Install / swap pipeline modules (agents, tools, memory backends, output formats) as packages with a manifest. Foundation for community-contributed modules in v1.0+.

**Updated 2026-04-21 after Phase 2.75 evaluation**:

`agentskills.io` is a live community marketplace of 67+ skills curated by Nous Research's Hermes community. When Phase 18 becomes active:

1. **Option A (preferred)**: Use `agentskills.io` directly — integrate its skill catalog API into our factory. Don't build our own marketplace.
2. **Option B (if A has limitations)**: Our own marketplace, but cross-reference agentskills for skills we don't re-implement.

Saves ~1-2 weeks vs custom marketplace build.

Integration question: can we consume an agentskills "skill" from cognitive-engine's LangGraph directly, or does it require Hermes runtime? Investigate during Phase 18.

**Configurability hook** (per `Master_Factory_Architect.md` §6): the skills catalog ships behind a `SkillsCatalog` interface. Implementations:
- `agentskills-community` — R1 default, community catalog via agentskills.io
- `agentryx-private` — R3 addition, our own curated catalog
- Federation mode (R5): ordered list of catalogs, resolution left-to-right

Admin UI sets `skills_catalog` as an ordered list per project. First catalog with a matching skill wins.

*(sketch — expanded when phase becomes active)*
