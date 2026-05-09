# Research/

External-landscape research artifacts that inform architectural decisions but are not themselves ratified plans.

## What lives here

Each file is a **dated landscape scan** or **focused research dossier** answering a specific architectural question — usually delegated to a research subagent (Sonnet via the `general-purpose` agent) so the main architect session preserves context budget.

These docs feed `Phase_NN_Decisions.md` files and `Master_Factory_Architect.md` revisions, but they are not themselves binding. A scan documents what the field looks like at a moment in time; the Decisions log captures what the factory actually adopts.

## Index

| Date | File | Topic | Source count | Action items raised |
|---|---|---|---|---|
| 2026-05-09 | [2026-05_Landscape_Scan.md](2026-05_Landscape_Scan.md) | 2026 multi-agent orchestrator landscape (Hermes deep dive) | 65 | 3 top recommendations (Hermes Kanban patterns into Phase 9; Honcho memory as Phase 7-E; Hermes hardened-config gate before Phase 10 ships) + 4 quick wins (AGENTS.md, SOUL.md, Curator pattern, /goal Ralph-loop) |

## When to commission a new scan

- Field has visibly moved (a major framework hit 1.0; a new orchestrator broke through; a security incident reframed risk)
- A specific roadmap decision needs evidence (e.g., "is Mastra ready as a LangGraph fallback yet?")
- Quarterly architectural drift check (per `Master_Factory_Architect.md` §12 revision log policy)
- Founder explicitly asks for one

## How to commission

1. Brief a research subagent (general-purpose, Sonnet) with: project context + specific 7-slot architecture description + the question + output format + budget guidance (search count, page fetches)
2. Have it write the scan as a markdown report with cited sources
3. Save to this folder with the date prefix
4. Update this index
5. Cross-link from `Master_Factory_Architect.md` §10 if the scan recommends architectural changes
6. If recommendations are adopted, formalize in a `Phase_NN_Decisions.md` (e.g. `Phase_2.76_Landscape_Update_2026_05/`) — the scan is *evidence*, the Decision is *action*

## Conventions

- **Filename**: `YYYY-MM_Topic_Name.md` — month precision is enough; sortable
- **Sources cited inline** — every claim backed by at least one URL
- **Honest limits section** — what wasn't accessible, what's directional vs. measured
- **Methodology section** — who did the research, search budget spent, date weighting
- **Plain markdown** — no special schemas; readers are humans + future LLM sessions
