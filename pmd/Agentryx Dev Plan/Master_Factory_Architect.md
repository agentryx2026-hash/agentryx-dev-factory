# Master Factory Architect — The R4 / R5 Vision

> **Author:** Claude Opus 4.7 (anthropic/claude-opus-4-7), acting as Solution Architect in continuous session with the founder.
> **Drafted:** 2026-04-21
> **Document class:** Long-term architectural vision. This is NOT the build plan — it's the target state we're aiming at, AFTER R1-R3 teach us where the seams are.
> **Sibling to:** `A.Solution Scope/`, `B.Agentryx Edge/`, `C.Project Delivery/`, `D.Roadmap/`.
> **Living document:** rewritten after every major R-release closes, or when significant external-ecosystem shifts force re-evaluation.

---

## 1. Release versioning philosophy

The Agentryx Dev Factory goes through five visible release bands. Each band has a distinct **adoption posture** toward external tools:

| Band | Horizon | Posture | Primary risk |
|---|---|---|---|
| **v0.0.1** (current) | weeks 0-6 | **Exploratory** — install every reasonable tool, compare, decide. Configurability is an absolute principle. | Analysis paralysis; over-speccing |
| **R1** (target: week 10) | weeks 6-12 | **Ecosystem-first** — use proven external tools wherever they exist (Hermes, agentskills, MCP, Paperclip, etc.). Custom-build ONLY where nothing fits. Ship the first real project end-to-end. | External dependencies locking us in |
| **R2** (month 4-6) | months 3-6 | **Production hardening** — multi-tenant, billing, scaling, observability. Same external deps as R1. | Scaling without changing deps |
| **R3** (month 7-9) | months 6-9 | **Selective replacement** — the 1-2 external tools that showed real friction get replaced with our own. Others stay. | Mid-flight architecture changes |
| **R4** (month 10-12) | months 9-12 | **Vertical integration** — most of the brain-layer external deps have our own equivalents. External providers remain for what they uniquely do (LLM inference, compute). | Build-everything syndrome |
| **R5** (month 13+) | year 2+ | **Factory supremacy** — self-hostable stack with zero external SaaS in the control plane. External usage is purely "we outsource what isn't strategic." | Maintenance cost of owning everything |

**Core insight**: we don't skip straight to R4. We **earn the right** to replace an external tool by having suffered its actual failure modes. This document is the contract that describes what we replace it WITH.

---

## 2. Non-negotiable principles (preserved across all bands)

These hold at every release. They're the architectural invariants.

### P1 — Configurability-first
Every external dependency sits behind an interface. Admin UI can select implementation per slot (and, eventually, per project). Cross-band migrations happen one slot at a time, hot-swappable.

### P2 — Artifact-first state
Every factory run produces versioned, typed artifacts (PMD documents, code trees, test reports, training scripts). State lives in the artifact store, not in agent scratch memory. Replay and audit are always possible.

### P3 — Per-call cost visibility
Every LLM call (Phase 2) records `project / phase / agent / task_type / model / tokens / $`. The cost panel sees everything. No hidden spend. **This never changes.**

### P4 — Audit trail for every mutation
User actions (key rotation, config change), agent-driven changes (self-improvement proposals), external-system events (Verify feedback, n8n trigger) all land in structured audit tables. Compliance + forensics + post-mortem feed off the same log.

### P5 — Typed interfaces between layers
Brain ↔ orchestration ↔ provider. Memory ↔ agent. Tools ↔ agent. Every interface is named, versioned, and has schema tests. Swapping an implementation means passing the same contract tests.

### P6 — Rollback posture at every phase boundary
VM snapshots, GitHub tags, and database migrations are reversible. We pay the overhead so mistakes are recoverable.

### P7 — Secrets architectural, not procedural
Keys never touch chat, logs, systemd journals, or plain env files post-rotation. Admin UI → encrypted DB → runtime resolution. This is Phase 2.5 concrete, but the principle persists.

### P8 — Configuration-driven, not code-driven
YAML/JSON configs determine model routing, agent task tiers, memory backend choice, gateway bindings. Code changes require a deploy; config changes are hot. Config is the fast path; code is the considered path.

---

## 3. The seven slots of the brain + orchestration layers

Every version of the factory fills these seven slots. The decision matrix in Phase 2.75 D74 gave the **R1** answer. This section gives the R4/R5 answer.

### Slot 1 — Pipeline agent runtime
**R1**: LangGraph (JavaScript). We own prompts, roles, topology. 10+ named agents (Picard, Sisko, Troi, Jane, Spock, Torres, Tuvok, Data, Crusher, O'Brien, Genovi, Courier, ...).

**R4/R5**: Probably LangGraph still, unless we hit one of two failure modes:
- **Failure mode A**: LangGraph state serialization becomes a performance bottleneck at 100+ concurrent projects → custom graph engine with lazy state restoration.
- **Failure mode B**: We want deterministic replay/fuzz-testing of pipeline graphs, LangGraph's model invocations are non-trivial to mock → custom DSL where every node declaration is a pure function spec.

Neither is visible in R1. Defer.

**Configurability hook**: `agent_runtime` setting per project. Values: `langgraph` (default), `custom` (when built).

### Slot 2 — LLM router + cost telemetry
**R1**: Our own router (Phase 2). LiteLLM + OpenRouter dual backend, DB-backed keys, budget caps, cost capture to `llm_calls`.

**R4/R5**: Same. The router is already ours, already proven. No reason to replace.

**Evolution**: add routing policies by *quality* as well as cost — "for code tasks where downstream tests pass 95% of the time on Sonnet-4.6 but 92% on Haiku-4.5, route to Haiku to save $0.30/call; escalate to Sonnet on retry." This is Phase 15 self-improvement material.

### Slot 3 — Tool plane
**R1**: MCP directly (Phase 5). `@modelcontextprotocol/sdk` in cognitive-engine. Consumes community MCP servers (filesystem, git, github, postgres, browser, slack).

**R4/R5**: Same (MCP is an open protocol). We become a PRODUCER of MCP servers for agentryx-specific tools — our Verify portal becomes an MCP server, our cost panel does too. Factory reuses them internally and publishes them to the broader MCP ecosystem.

**Configurability hook**: per-task tool whitelist (admin decides which MCP servers each task-type can invoke).

### Slot 4 — Memory layer
**R1**: Custom implementation of the Hermes pattern — SQLite FTS5 + LLM summarization + optional Honcho. Per-project SQLite file; persistent across sessions.

**R4**: Same mechanism, but **artifact-aware memory**. Instead of "what messages happened in this session," the memory primitive becomes "what artifacts does this project have, how do they relate, what have agents said about them." Graph structure (like Graphiti) inside each project's memory DB.

**R5**: Cross-project learning — the factory remembers "last time an agent hit error E on task T, the fix was F" and proposes F when the pattern recurs. This is where Phase 15 self-improvement intersects memory.

**Configurability hook**: `memory_backend` per project. Values: `hermes-pattern-sqlite` (R1 default), `letta-managed`, `graphiti-temporal`, `custom-graph` (R4), `null` (no persistent memory).

### Slot 5 — Self-improvement loop
**R1**: Not built. Referenced as "future" in Phase 15 sketch.

**R2**: Stub. Agents propose changes to their OWN prompts based on Verify feedback. Super Admin approves/rejects.

**R3**: Tinker-Atropos pattern — RL trajectory collection from real factory runs. Offline training loop proposes prompt/model/topology improvements.

**R4**: Self-improving *graph topology*. When the same task repeatedly fails on the Torres→Tuvok handoff, the factory proposes inserting a Spock-review step. Super Admin approves → graph mutates (versioned).

**R5**: Self-improving *agent roster*. Factory notices it's always spawning subagents for "architecture-diagram" work → proposes a dedicated diagram-agent. Super Admin approves → new named agent with assigned task tier.

Throughout: human-in-the-loop gate on all improvements. Factory proposes, Super Admin disposes.

**Configurability hook**: `self_improvement_level` global setting. Values: `off`, `propose-only` (R2), `trajectory-collect` (R3), `graph-mutate-gated` (R4), `agent-roster-gated` (R5).

### Slot 6 — External communications (Courier / Phase 10)
**R1**: Hermes in `gateway` mode. Leverages 6 messaging integrations (Slack/Discord/Telegram/WhatsApp/Signal/Email) and GitHub PR ops.

**R2/R3**: Same, plus our own events → Hermes adapter matures. Event taxonomy formalized (`project.pr_opened`, `cost.budget_exceeded`, etc. — see Phase 10 Plan).

**R4**: Our own messaging adapter layer, IF Hermes shows cost/control/customization issues. At this scale we may need per-tenant Slack apps, which Hermes might not handle cleanly. If it does, stay on Hermes.

**R5**: Irrelevant — by then our messaging adapter is mature. Adapter is swappable; Hermes stays as *one* option for tenants who want its quirks (broader platform support).

**Configurability hook**: `comms_backend` per tenant. Values: `hermes-gateway` (R1), `custom-messaging-adapter` (R4+), `null` (email-only mode).

### Slot 7 — Skills catalog / pipeline module marketplace (Phase 18)
**R1**: `agentskills.io` (Nous Research community). 67+ curated skills. Consumed via Hermes's skill-loading mechanism where the skill format supports our cognitive-engine.

**R2**: Our own curation layer on top. We whitelist skills per project. Cost-and-safety review for each.

**R3**: We publish our own custom skills (Agentryx-specific: "run-pre-dev-pipeline", "generate-pmd-doc", etc.) to our private catalog.

**R4**: Our private catalog becomes a first-class marketplace. Internal-to-factory agents publish skills they've learned. Skills become versioned, tested, dependency-managed.

**R5**: Federation — agentryx catalog + agentskills + industry-specific catalogs form a graph. Discovery via semantic search.

**Configurability hook**: `skills_catalog` ordered list. Values: `["agentryx-private", "agentskills-community"]` etc. Resolution order left-to-right.

---

## 4. Slot-to-phase mapping — what gets built when

Each slot goes through stages over the R-bands. This table is the cross-cut of slot × band:

```
                 v0.0.1     R1          R2           R3              R4                R5
                 (R&D)                                                                  
Slot 1 Agents    LangGraph  LangGraph   LangGraph    LangGraph       LangGraph         possible custom
Slot 2 Router    ours (Ph2) ours        + quality    + quality       + quality         + cross-provider
                             routing    learning                      learning           arbitrage
Slot 3 Tools     custom.js  MCP SDK     MCP + we     MCP producer    MCP hub             MCP hub + fed
                 (Ph5)                  publish 1                     
Slot 4 Memory    empty      Hermes      + artifact   + artifact      + cross-project    + learned
                            pattern      awareness    graph           memory              fix patterns
Slot 5 Self-imp  none       none        propose-only trajectory-coll graph-mutate        agent-roster
                                         (prompts)   (Tinker-Atr)    (gated)             (gated)
Slot 6 Comms     none       Hermes      Hermes +     Hermes +        custom             custom + Hermes
                            gateway      our events   maturity        messaging-adapter   optional
Slot 7 Skills    none       agentskills + curation   + our private   private primary    federation
```

---

## 5. What R1 teaches us that shapes R4/R5

Five research questions that R1 must answer for R4 design to be informed:

1. **Where is the cost bottleneck?** If 80% of spend is on architect-tier models, R4's self-improvement priorities demoting that tier where possible. If 80% is on memory summarization, R4 considers a local summarization model.

2. **Which slot is operationally painful?** External deps that we found ourselves fighting (custom patches, wrapper scripts, upstream breakages) are R3/R4 replacement candidates. Deps that "just worked" stay.

3. **What's the real distribution of tasks?** 10 agents designed uniformly might actually be 2-3 agents doing 80% of the work. R3/R4 rebalances agent roster + model assignments.

4. **What's the Verify rejection pattern?** If humans reject at the same step 40% of the time, that step needs redesign. R3's self-improvement loop fires on this data.

5. **How long is a real project end-to-end?** If it's 2 hours, real-time feedback UX is feasible. If 2 days, we need async notification infrastructure (Hermes gateway → operator Slack → approval flow). That changes Phase 10 and Phase 14 priorities.

Without R1 data, these questions are architecture astronomy. Ship R1, instrument it, let the data write R4.

---

## 6. The configurability escape hatch — concrete mechanics

Every slot's "configurability hook" (above) routes through the same mechanism:

```
┌──────────────────────────────────────────────────────────────┐
│  admin UI (Phase 12 — B7 admin module)                       │
│  ──────                                                      │
│  Super Admin sees: slot × current-implementation × status    │
│  Actions: swap impl (hot), A/B-compare impls, rollback       │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Postgres `slot_configurations` table                        │
│  ──────────────────────────────────                          │
│   slot_name, project_id (nullable), implementation_name,     │
│   active_since, deprecated_on, parameters JSONB              │
│  — NULL project_id means factory-wide default                │
│  — Non-NULL overrides default for that project               │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Factory runtime (cognitive-engine, paperclip dispatcher)    │
│  ────────────────                                            │
│  At task-start: `getActiveImpl(slot, project_id)` →          │
│  returns implementation identifier + config                  │
│  → agent uses that for this task                             │
└──────────────────────────────────────────────────────────────┘
```

**This means**: at R4, when our custom memory service is ready, we don't need a redeploy. We add a row saying `("memory", project-xyz, "custom-graph-r4")` and that project alone switches. If it works, we flip the factory default. If it breaks, we revert the row.

**This is the same pattern as Phase 2's `LLM_ROUTER_BACKEND` env var — generalized.**

---

## 7. Patterns we are REFUSING to lock in, even at R1

To preserve optionality:

- ❌ **No "magical" inter-agent communication.** Every agent → agent handoff is a typed artifact + a graph edge, not in-memory objects. Enables language-agnostic reimplementation later.
- ❌ **No hidden global state in agent nodes.** Every decision is recoverable from inputs + code.
- ❌ **No vendor-specific model features** in the critical path (e.g. we don't depend on Anthropic's prompt caching for correctness — only for cost optimization).
- ❌ **No monolithic agent image.** Each agent is independently testable. Pipeline is composition, not baked-in flow.
- ❌ **No non-versioned configs in production.** Configs live in git + postgres; no "edit once, forget." 
- ❌ **No synchronous dependency on external SaaS** in critical paths. If agentskills.io goes down, our private catalog keeps the factory running. If Hermes gateway goes down, email fallback exists.

---

## 8. R5 north star (not a build target, a test of architecture)

A team of 3 could spin up an Agentryx Dev Factory on a single GCP VM + 1 Postgres + 1 LLM API key in under 4 hours. The factory would:

- Accept a scope document (SRS/FRS/PRD) via the dashboard.
- Produce 25-30 PMD standard documents.
- Generate code + tests + docs + training materials in parallel.
- Publish to a Verify portal.
- Receive human feedback, fix, re-publish.
- Deliver the finished project with versioned artifacts.
- Cost: < $50 per small project, < $500 per medium, < $5000 per large.
- Time: hours for small, days for medium, 1-2 weeks for large.
- SLA: observable at every phase via the cost panel, Hermes gateway notifications, and verify portal progress bars.
- Completely self-hostable; no mandatory external SaaS beyond LLM inference.

**If the architecture we ship at R1 can't be evolved into that north star without breaking changes, we've already failed.** This document exists to force that test upfront.

---

## 9. Document revision log

| Rev | Date | Author (model id) | Trigger | Sections touched |
|---|---|---|---|---|
| r0.1 | 2026-04-21 | claude-opus-4-7 | Initial draft — first architectural vision document after Phase 2.75 verdict | all |

Future revisions expected at:
- End of Phase 20 (R1 close) — will rewrite §5 with actual data
- Every 6-month boundary — architectural drift check
- On any external-ecosystem shift that changes slot options (new Hermes competitor, MCP supersession, etc.)

---

## 10. Relationship to other docs

- **`D.Roadmap/README.md`** — the tactical 20-phase plan that gets us to R1. This doc assumes that roadmap executes roughly as planned.
- **`D.Roadmap/00_Architectural_Principles.md`** — the principles list for R&D / v0.0.1. Principles P1-P8 above extend and harden those for all R-bands.
- **`D.Roadmap/01_Agent_Delegation_Model.md`** — cost-tier routing patterns. Complementary; this doc sets the slot-level architecture, that doc sets per-agent model assignments.
- **`B.Agentryx Edge/B7_Admin_Operations_Module.md`** — the mandated admin module spec. Phase 12 builds it. This doc's §6 (the configurability escape hatch) is its architectural justification.
- **`A.Solution Scope/A2_Solution_Architecture.md`** — point-in-time architecture. This doc is the *target* architecture that A2 converges toward.

---

*End of document. This is a living plan. The factory teaches us what's right; the text changes to match.*
