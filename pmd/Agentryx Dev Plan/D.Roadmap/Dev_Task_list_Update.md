# Agentryx Dev Factory — Task Status Snapshot

**Last updated**: 2026-04-23
**Snapshot purpose**: single-page view of every phase's status. Read this first to know exactly what's built, where we are, and what's next. Per-phase detail lives in each `Phase_NN_*/` folder — this doc indexes them.

**How to keep this fresh**: update this file at every phase close (alongside the per-phase `Status.md` and `Lessons.md`). The "Last updated" date and the per-phase status row are the two things that must move. Don't let them drift.

---

## Headline numbers (as of 2026-04-23)

| Metric | Value |
|---|---|
| Total phase entries (incl. 1.5, 2.5, 2.75) | 24 |
| Fully closed | **11** (0, 1, 1.5, 2, 2.5, 2.75, 3, 4) — foundation band |
| A-tier scaffolding shipped | **11** (5-A, 6-A, 7-A, 8-A, 9-A, 10-A, 11-A, 12-A, 13-A, 14-A, 15-A) |
| Sketch only (not started) | **5** (16, 17, 18, 19, 20) |
| B-tier deferred (production wiring) | 12 subphases pending across phases 5-15 |
| Smoke-test assertions passing | **373** across 11 scaffolded modules |
| LLM spend across all scaffolding | **$0.00** |
| Phase tags on origin (rollback anchors) | 19 |

**Net release-band position**: still in v0.0.1 (R&D / experimentation). All scaffolding phases shipped behind feature flags defaulted off — production behavior is unchanged from Phase 4 close.

---

## Status legend

- ✅ **Closed** — done, merged, tagged, no further work planned in v0.0.1
- 🟡 **Partial (A-tier shipped)** — scaffolding library shipped, B-tier wiring deferred (real LLM, real UI, real integration)
- 📝 **Sketched** — one-line plan only; no code yet
- ⏳ **Deferred** — explicitly waiting on a known blocker (OpenRouter credit, user creds, scale, prior B-tier)

---

## Phase-by-phase status

| # | Phase | Status | What's shipped | Pending in this phase | Blocker for the rest |
|---|---|---|---|---|---|
| **0** | GitHub setup | ✅ closed | Repo, structure, labels, milestones, Project board | — | — |
| **1** | Restore + Observe | ✅ closed | Pipeline alive on VM, instrumented, restore.sh | — | — |
| **1.5** | Rename + Monorepo | ✅ closed | `agentryx-dev-factory` rename; `factory-dashboard` + `cognitive-engine` folded in; sidebar links + Paperclip UI exposed | — | — |
| **2** | LLM Router | ✅ closed | LiteLLM + OpenRouter switchable, fallback chains, per-call $ capture, compare mode, cost panel | — | — |
| **2.5** | Key Console (B7-lite) | ✅ closed | Browser key mgr, AES-256-GCM at rest, audit log; eliminated 7-leak chat-paste pattern | — | — |
| **2.75** | Hermes Evaluation | ✅ closed | Hybrid-adoption verdict (D74): Hermes for Courier (Ph10) + skills (Ph18); patterns for Memory (Ph7) + Self-improve (Ph15) | — | — |
| **3** | Intake (Genovi) | ✅ closed | New first agent. SRS/FRS/PRD → structured requirement extraction (library) | — | — |
| **4** | PMD Template Registry | ✅ closed | 25 PMD docs in `pmd-registry.json`; Genovi integrated into `pre_dev_graph.js`; `PRE_DEV_USE_GRAPH` feature flag | — | — |
| **5** | MCP Tool Plane | 🟡 partial (5-A) | `cognitive-engine/mcp/`: client, bridge, configs, smoke-test (live MCP server spawn proven) | 5-B: graph nodes import from bridge under `USE_MCP_TOOLS` | OpenRouter credit (E2E LLM validation) |
| **6** | Artifact-First State | 🟡 partial (6-A) | `cognitive-engine/artifacts/`: types, store, sha256, monotonic IDs, smoke (3 obs + verify) | 6-B: graph nodes dual-write artifacts under `USE_ARTIFACT_STORE` | OpenRouter credit |
| **7** | Memory Layer v1 | 🟡 partial (7-A) | `cognitive-engine/memory-layer/`: 5 obs kinds, scope partition, fs backend (Obsidian-visible), artifact walker | 7-B sqlite, 7-C postgres, 7-D vector backends; 7-E graph integration | 7-B/C/D scale-dependent; 7-E OpenRouter |
| **8** | Parallel Artifacts | 🟡 partial (8-A) | `cognitive-engine/parallel/`: fan-out/join proof + 7 reducers; **1061ms vs 3000ms sequential** measured | 8-B: rewire `dev_graph.js` to use parallel topology under `USE_PARALLEL_DEV_GRAPH` | OpenRouter credit |
| **9** | Verification Queue | 🟡 partial (9-A) | `cognitive-engine/verify-integration/`: BuildBundle/FeedbackPayload contracts, mock client, feedback receiver writes user_note observations + plans fix-cycle routes | 9-B: real HTTP against `verify-stg.agentryx.dev`, webhook endpoint, real fix-cycle agent invocation | Verify multi-app mode + OpenRouter |
| **10** | Courier (External Comms) | 🟡 partial (10-A) | `cognitive-engine/courier/`: 8 event types × 6 channels × 3 backends (fake/http/null); routing config with severity filter + `$project_id` substitution | 10-B: Hermes container in gateway mode, channel bindings, producer wiring | User creds (Slack/GitHub/email) + Hermes deploy |
| **11** | Cost + Quota Dashboard | 🟡 partial (11-A) | `cognitive-engine/cost-tracker/`: unified `CostRollup` from artifacts + `llm_calls` DB; `cost-thresholds.json` schema | 11-B: React UI, HTTP endpoint, alert wiring via Courier | Phase 10 Courier (alert pipe) + UI work |
| **12** | B7 Admin Module v1 | 🟡 partial (12-A) | `cognitive-engine/admin-substrate/`: 7 configs + 8 flags catalogued, atomic CRUD, 4-level roles, append-only audit | 12-B: HTTP routes, React Admin pages, Postgres `config_settings` migration, runtime flag-toggle | UI work + DB migration |
| **13** | Pipeline Replay | 🟡 partial (13-A) | `cognitive-engine/replay/`: collector, planner, executor; replay-from-any-node + substitution mode + cross-snapshot artifact resolution | 13-B: default LLM stub re-invokes original agent, HTTP endpoint, React timeline UI, cross-pipeline replay | OpenRouter credit + UI work |
| **14** | Multi-Project Concurrency | 🟡 partial (14-A) | `cognitive-engine/concurrency/`: filesystem-backed queue + worker pool + atomic POSIX rename leasing + round-robin fairness across N projects/workers | 14-B: real factory handlers (pre_dev/dev/post_dev), HTTP submission, React UI, per-project quotas, crash recovery | UI work + handler implementations |
| **15** | Self-Improvement Loop | 🟡 partial (15-A) | `cognitive-engine/self-improvement/`: types + proposal store (state machine + audit) + heuristic proposer (3 rules) + replay-driven evaluator harness + applier (config/model/prompt, graph_change refused); 87 smoke assertions; `USE_SELF_IMPROVEMENT` flag | 15-B: LLM proposer, real comparators, scheduled via Phase 14 queue, React UI via Phase 12-B, prompt hot-swap consumer in graph, auto-apply mode | OpenRouter credit (LLM proposer + real comparators) + Phase 6-B graph dual-write (for artifact-level cost/latency) |
| **16** | Training Scripts Generation | 📝 sketched | One-liner plan only | All | — |
| **17** | Training Videos | 📝 sketched | One-liner plan only | All | — |
| **18** | Pipeline Module Marketplace | 📝 sketched | One-liner plan only | All | — |
| **19** | Customer Portal | 📝 sketched | One-liner plan only | All | — |
| **20** | Public Release | 📝 sketched | One-liner plan only | All | — |

---

## B-tier deferral cohorts

The 11 deferred B-subphases group into 3 clear blockers. Once a blocker clears, the cohort can ship together.

### Cohort 1 — needs OpenRouter credit (5 phases)
Each requires running real LLM pipelines end-to-end to validate.

- **5-B** MCP graph integration (rewire 5 graph files under `USE_MCP_TOOLS`)
- **6-B** Artifact-store dual-write (graph nodes write artifacts after every LLM call)
- **7-E** Memory-layer graph integration (post-LLM observation writes)
- **8-B** Parallel `dev_graph.js` (replace sequential edges with fan-out/join)
- **15-B** LLM proposer + real outcome comparators (depends on 6-B for artifact-level cost/latency signals)

**Cost estimate to clear all 5**: ~$5–20 in LLM spend on Haiku/Sonnet validation runs (or ~$25–50 on Opus).

### Cohort 2 — needs user creds + UI work (6 phases)
Each requires ops setup and React UI development.

- **9-B** Verify integration (Verify multi-app mode + auth choice + webhook)
- **10-B** Courier (Slack bot OAuth, GitHub App install, SMTP, Hermes container deploy)
- **11-B** Cost dashboard (depends on 10-B for alert pipe; React + HTTP)
- **12-B** B7 admin UI (extends `admin-keys.mjs`, React Admin pages, Postgres migration)
- **13-B** Replay UI (LLM stub + HTTP + timeline view + side-by-side diff)
- **14-B** Concurrency UI (queue depth + worker pool + per-project quotas)

**Natural ordering**: 10-B unblocks 11-B; 12-B is pre-req for ops-friendly admin of all the others; 9-B / 13-B / 14-B can ship in any order after.

### Cohort 3 — scale-dependent (3 phases)
Won't matter until factory operates at higher volume.

- **7-B** SQLite FTS5 backend for memory (worth it at 100+ observations)
- **7-C** Postgres backend (cross-host factory or Phase 14 multi-project pressure)
- **7-D** Vector / embedding backend (semantic recall when keyword no longer enough)

---

## What's next

Phase 15-A is shipped (same session arc that closed 14-A). Options branch:

- **Continue scaffolding 16 → 20** — all greenfield, all $0 cost. Mirrors Phases 5-A through 15-A discipline. Phase 16 (Training Scripts) is the natural next (artifact-producer; no brain required).
- **Ship a B-tier cohort** when one of the blockers clears (OpenRouter top-up → 5 phases unlock including 15-B; UI sprint → 6 phases unlock).
- **Pause + use the factory** — every A-tier scaffolding is feature-flagged off. Real factory pipeline is unchanged. Could productize the foundation band.

---

## Working conventions (codified during this session)

- **PR flow** for every change since 5-A. No direct push to `main`. Squash-merge via `gh pr merge --squash --delete-branch`. Branch + tag every phase close. (See `D.Roadmap/README.md` "Git workflow" section for the 7-step sequence.)
- **Pre-phase code survey** is mandatory before scoping any phase (Phase 4 Lesson #1). Catches `memory.js` already exists, `llm_calls` table already exists, etc. Saves rewrites.
- **Scaffolding pattern** (proven 11× across 5-A → 15-A):
  - `types.js` → `store/service` → `backend(s)` → `smoke-test` → `README` → 4 phase docs
  - Library lives alongside existing code, never replaces it
  - Feature flag with default off — zero regression
  - All deps injected (handler registry, fixRouter, nodeStubs, etc.)
- **Smoke tests assert content, not just shape.** Catches silent-degradation bugs (round-robin → FIFO; substitution → placeholder).
- **JSONL append-only logs** for every audit-ish data: artifacts (`index.jsonl`), memory (`index.jsonl`), queue (`_jobs/{queue,in-flight,done}/`), admin audit (`_admin-audit.jsonl`). Same mental model.

---

## Where things live

- **Roadmap doc**: `D.Roadmap/README.md` (master 20-phase table + git workflow + per-phase folder convention)
- **Per-phase artifacts**: `D.Roadmap/Phase_NN_*/Phase_NN_{Plan,Status,Decisions,Lessons}.md`
- **Architectural principles**: `D.Roadmap/00_Architectural_Principles.md` (P1-P9)
- **Long-term R4/R5 vision**: `Master_Factory_Architect.md` (parent dir)
- **Code modules** (in `agentryx-factory` repo, mirrored from this PMD as needed):
  - Foundation: `cognitive-engine/{tools,memory,graph,*_graph}.js`, `llm-router/`, `factory-dashboard/`, `server/admin-keys.mjs`
  - Phase 5+: `cognitive-engine/{mcp,artifacts,memory-layer,parallel,verify-integration,cost-tracker,courier,admin-substrate,replay,concurrency,self-improvement}/`
- **Phase tags on origin**: `git tag -l | grep phase-` (19 anchors)
- **GitHub milestones**: 18 milestones, 8 closed (foundation), 10 open (scaffolded but partial)

---

## Append rules for future updates

When closing a new phase or changing status:

1. Bump the **Last updated** date at the top.
2. Update the affected row in the per-phase table.
3. Update the headline numbers if counts change.
4. If a B-tier cohort blocker clears, reflect it in "What's next."
5. Don't add per-phase narrative here — that belongs in `Phase_NN_Status.md`. This doc is the index, not the encyclopedia.
