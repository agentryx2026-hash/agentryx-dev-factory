# Agentryx Dev Factory — Task Status Snapshot

**Last updated**: 2026-05-09 (Phase 12-B + 13-B Tier B close + visible-factory sprint — `Sidebar.tsx` zero static mocks)
**Snapshot purpose**: single-page view of every phase's status. Read this first to know exactly what's built, where we are, and what's next. Per-phase detail lives in each `Phase_NN_*/` folder — this doc indexes them.

**How to keep this fresh**: update this file at every phase close (alongside the per-phase `Status.md` and `Lessons.md`). The "Last updated" date and the per-phase status row are the two things that must move. Don't let them drift.

---

## Headline numbers (as of 2026-05-09)

| Metric | Value |
|---|---|
| Total phase entries (incl. 1.5, 2.5, 2.75, 2.76, 21) | 26 |
| Fully closed (foundation band + strategy phases) | **13** (0, 1, 1.5, 2, 2.5, 2.75, 2.76, 3, 4) |
| A-tier scaffolding shipped | **17** — Phase 21-A added autonomous research substrate ✅ |
| Beta Playground active profiles | **5** (4 exploring + 1 watching) |
| Sketch only (not started) | **0** (roadmap complete through Phase 21; Phase 22 placeholder for Action Boundary at v3) |
| B-tier deferred (production wiring) | 16 subphases pending — 12-B closed (full); 13-B partial (Tier B read-only shipped, full LLM-stub waits on OpenRouter) |
| Visible factory surfaces (Dev-Hub) | **11/11 sidebar items real** — 0 static mocks remaining (Memory Layer + Analytics replaced this session; Master Architect + Admin + Replay added) |
| Smoke-test assertions passing | **1038** per-module (948 + 87 architect + 3 self-improvement extension) + **73** cross-phase = **1111 total** |
| Lab baseline assertions (composition-smoke via runner.js) | 73 |
| LLM spend across all scaffolding + Lab + architect | **$0.00** (architect ships with stub dispatcher) |
| Phase tags on origin (rollback anchors) | 26 (after `phase-21a-closed` lands) |
| Decisions logged | D1–D204 (Phase 21-A.1 added D200-D204) |
| Master Factory Architect revision | r0.5 (2026-05-09) |

**Net release-band position**: v0.0.1 **A-tier complete + Beta Playground active + Master Architect substrate shipped**. All 21 phase slots have substrate; all scaffolding shipped behind feature flags defaulted off — production behavior is unchanged from Phase 4 close. Next band (v1, target ~2-3 months) arrives by resolving B-subphases (now 18, with 21-B added) AND graduating Lab profiles to stable. Production target (v3) is **~5-6 months out** per Phase 2.76 D189; **Phase 22 (Action Boundary Enforcement) lands at v2 → v3 boundary** per D199.

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
| **2.76** | Beta Playground + Strategy Update 2026-05 | ✅ closed | Beta Playground established as permanent capability (D181); Hermes footprint expanded (D182); 5 Lab profiles seeded (hermes-agent, honcho, deep-agents, anthropic-agent-teams, thinking-machines-tinker); marketplace `experimental` category (D188); release-band schedule v0.0.1→v3 ~5-6 months (D189); D181-D189 | Lab promotions (Tier 1 → testing) at next monthly review | None — Lab is operational |
| **3** | Intake (Genovi) | ✅ closed | New first agent. SRS/FRS/PRD → structured requirement extraction (library) | — | — |
| **4** | PMD Template Registry | ✅ closed | 25 PMD docs in `pmd-registry.json`; Genovi integrated into `pre_dev_graph.js`; `PRE_DEV_USE_GRAPH` feature flag | — | — |
| **5** | MCP Tool Plane | 🟡 partial (5-A) | `cognitive-engine/mcp/`: client, bridge, configs, smoke-test (live MCP server spawn proven) | 5-B: graph nodes import from bridge under `USE_MCP_TOOLS` | OpenRouter credit (E2E LLM validation) |
| **6** | Artifact-First State | 🟡 partial (6-A) | `cognitive-engine/artifacts/`: types, store, sha256, monotonic IDs, smoke (3 obs + verify) | 6-B: graph nodes dual-write artifacts under `USE_ARTIFACT_STORE` | OpenRouter credit |
| **7** | Memory Layer v1 | 🟡 partial (7-A + UI surface) | `cognitive-engine/memory-layer/`: 5 obs kinds, scope partition, fs backend (Obsidian-visible), artifact walker. **Dev-Hub Memory Layer page** (renamed from Skill Memory mock) — scope filter + kind filter + observation viewer; auto-refresh; reads via `/api/factory-admin/memory/*` | 7-B sqlite, 7-C postgres, 7-D vector backends; 7-E graph integration | 7-B/C/D scale-dependent; 7-E OpenRouter |
| **8** | Parallel Artifacts | 🟡 partial (8-A) | `cognitive-engine/parallel/`: fan-out/join proof + 7 reducers; **1061ms vs 3000ms sequential** measured | 8-B: rewire `dev_graph.js` to use parallel topology under `USE_PARALLEL_DEV_GRAPH` | OpenRouter credit |
| **9** | Verification Queue | 🟡 partial (9-A) | `cognitive-engine/verify-integration/`: BuildBundle/FeedbackPayload contracts, mock client, feedback receiver writes user_note observations + plans fix-cycle routes | 9-B: real HTTP against `verify-stg.agentryx.dev`, webhook endpoint, real fix-cycle agent invocation | Verify multi-app mode + OpenRouter |
| **10** | Courier (External Comms) | 🟡 partial (10-A) | `cognitive-engine/courier/`: 8 event types × 6 channels × 3 backends (fake/http/null); routing config with severity filter + `$project_id` substitution | 10-B: Hermes container in gateway mode, channel bindings, producer wiring | User creds (Slack/GitHub/email) + Hermes deploy |
| **11** | Cost + Quota Dashboard | 🟡 partial (11-A + read UI) | `cognitive-engine/cost-tracker/`: unified `CostRollup` from artifacts + `llm_calls` DB; `cost-thresholds.json` schema. **Dev-Hub Admin → Cost panel** + Analytics Cost card (rollup view, by-model breakdown via `getRollup`) | 11-B remainder: per-tenant + per-day charts, Courier-wired threshold alerts; lights up with real numbers once OpenRouter dispatcher (21-B) starts producing artifacts | Phase 10 Courier (alert pipe) + per-tenant data |
| **12** | B7 Admin Module v1 | ✅ **closed (12-A + 12-B)** | `cognitive-engine/admin-substrate/`: 7 configs + 15 flags + 4-level roles + atomic CRUD + append-only audit. **Dev-Hub Admin · Configuration page** with 6 sub-tabs (🚦 Flags / ⚙️ Configs / 📦 Modules / 📊 Queue / 💰 Cost / 📋 Audit). Live flag toggles persisted to `_factory_runtime/flag_overrides.json`; config edit forms role-gated via `min_role_edit` (12-B-full); writes are atomic (`writeConfig` temp-file+rename), schema-validated, audited with metadata only (never logs the value). Postgres deferred to v3 — file-backed is fine for v0.0.1 single-VM single-founder. | — | — |
| **13** | Pipeline Replay | 🟡 partial (13-A + 13-B Tier B read-only) | `cognitive-engine/replay/`: collector, planner, executor; replay-from-any-node + substitution mode + cross-snapshot artifact resolution. **Dev-Hub Replay page** (sidebar item 5): list past runs (`listRunIds`), open a run to see chronological artifact timeline, color-coded agent pills, expandable detail per artifact (model / cost / latency / parent_ids). Empty until Phase 6-B (`USE_ARTIFACT_STORE`) flips on — empty state explains exactly that. | 13-B remainder: default LLM stub re-invokes original agent, POST /execute endpoint, cross-pipeline replay, side-by-side diff view | OpenRouter credit (LLM stub) |
| **14** | Multi-Project Concurrency | 🟡 partial (14-A + read UI) | `cognitive-engine/concurrency/`: filesystem-backed queue + worker pool + atomic POSIX rename leasing + round-robin fairness across N projects/workers. **Dev-Hub Admin → Queue panel** (queue depth + worker pool + queued/in-flight job lists, auto-refresh every 5s) | 14-B remainder: real factory handlers (pre_dev/dev/post_dev) registered in queue, HTTP submission, per-project quotas wired to Phase 11-A, crash recovery | Handler implementations + (real submissions need OpenRouter for the LLM-driven graphs) |
| **15** | Self-Improvement Loop | 🟡 partial (15-A) | `cognitive-engine/self-improvement/`: types + proposal store (state machine + audit) + heuristic proposer (3 rules) + replay-driven evaluator harness + applier (config/model/prompt, graph_change refused); 87 smoke assertions; `USE_SELF_IMPROVEMENT` flag | 15-B: LLM proposer, real comparators, scheduled via Phase 14 queue, React UI via Phase 12-B, prompt hot-swap consumer in graph, auto-apply mode | OpenRouter credit (LLM proposer + real comparators) + Phase 6-B graph dual-write (for artifact-level cost/latency) |
| **16** | Training Scripts Generation | 🟡 partial (16-A) | `cognitive-engine/training-gen/`: 6 template generators (user_guide/quick_start/how_to/reference_doc/voiceover_script/video_storyboard) + filesystem store with sha-verified integrity + pipeline (voiceover→storyboard ordering, failure isolation) + renderer with Phase 17 payload (narration/capture_plan/transitions/SRT captions); 102 assertions; `USE_TRAINING_GEN` flag | 16-B: LLM generators, post-dev graph wiring via Phase 14 queue, PMD registry integration, memory personalization, Phase 6-A dual-write, Phase 9 Verify reviewer feedback | OpenRouter credit + Phase 14-B handler registration |
| **17** | Training Videos | 🟡 partial (17-A) | `cognitive-engine/training-videos/`: 3 provider categories (tts/capture/stitcher) × null+stub backends (8 total); reserve/commit video store with atomic manifest + append-only render log; renderer with beat-level failure isolation + progress events; pipeline with E2E through Phase 16-A training-gen; 91 assertions; `USE_TRAINING_VIDEOS` flag | 17-B: real ElevenLabs/OpenAI TTS + real Puppeteer/Playwright + real ffmpeg + Phase 14 handler + Phase 9 Verify + cloud upload + retries + Phase 11 budget gate | OpenRouter credit + TTS credentials + Phase 14-B handler registration |
| **18** | Pipeline Module Marketplace | 🟡 partial (18-A + read UI) | `cognitive-engine/marketplace/`: ModuleManifest schema (9 categories × 3 statuses); installer with 3-kind dependency resolution (module/env/registry); catalogue of 15 built-in manifests covering Phases 5-A through 17-A; store with atomic manifests.jsonl + append-only audit log; query by category / capability / id; 117 assertions; `USE_MODULE_MARKETPLACE` flag. **Dev-Hub Admin → Modules panel** — 15 catalogue entries grouped by category, each card shows id + display_name + version + capabilities + status pill | 18-B remainder: remote fetch + signature verification + version resolution + live swap + Phase 3/4 catalogue entries | Hosting contract + signature verification story |
| **19** | Customer Portal | 🟡 partial (19-A) | `cognitive-engine/customer-portal/`: CustomerAccount + 3-tier SLA policies + opaque bearer tokens (SHA-256 hashed) + per-customer sandbox dirs; 9-state-kind append-only timeline; state-machine-gated submissions (6 statuses); typed error codes (UNAUTHORIZED/FORBIDDEN/QUOTA_EXCEEDED/VALIDATION); 138 assertions; `USE_CUSTOMER_PORTAL` flag | 19-B: Fastify/Express HTTP API, React customer UI, Phase 14 queue handler, Phase 10 Courier notifications, Phase 11 budget gate, Phase 9 Verify linkage, SLA scanner, password auth, rate limiting | UI work + credentials (email/password/Stripe) |
| **20** | Public Release | 🟡 partial (20-A) | `cognitive-engine/release/`: 5-capability consolidation substrate — per-tenant usage metering (day/week/month rollups); retention engine with 7 default policies + dry-run-first apply; GDPR compliance (export/delete/audit) with cross-tenant isolation; readiness aggregator via DI probe registry with 3 statuses + worst-case fold; backup manifests with sha256 tamper detection; 126 assertions; `USE_PUBLIC_RELEASE` flag. **This phase closes 100% A-tier coverage.** | 20-B: Stripe billing, systemd/k8s health probes, cron retention, nightly backup + offsite, security review, load tests, v1.0 release ceremony | UI + credentials (Stripe, S3/R2) + external security review |
| **21** | Master Architect | 🟡 partial (21-A + 21-A.1) | **21-A**: `cognitive-engine/architect/` substrate — types + KB + scheduler + researcher + proposer + applier + portal API; standing_orders schema; 89 assertions; `USE_AUTONOMOUS_ARCHITECT` flag; D190-D199. **21-A.1** (same session): Platform Evolution Roadmap (3 cadences daily/weekly/monthly, hierarchical, IST-aware, embedded daemon in factory-telemetry.service); Founder R&D Brief tab (8-field structured prompt → composer → pass → report); Seven (Tool Evaluator, 12th named agent, first SOUL.md); `tool_evaluation` finding kind; Hermes Lab promoted `exploring → testing`; Master Architect 3-tab UI shipped (Standing Orders & Roadmap / R&D Brief / Reports & Proposals); D200-D204 | 21-B: real Sonnet/Opus dispatcher (replaces stub — Seven + roadmap actually evaluate/research the world), Phase 14-A queue handler integration, Phase 11-A budget gate, Phase 10-A Courier notifications | OpenRouter credit (~$1-2/day target) + 14-B + 10-B + 11-B (12-B is now its own track since 21-A.1 already shipped the architect's UI) |
| **22** | Action Boundary Enforcement | 📝 sketched (D199) | Phase placeholder: tool/egress allowlists, sandbox runtimes, MCP server allowlists, Courier event allowlists, signed-manifest provenance; architect itself becomes subject | Lands at v2 → v3 boundary per D185 + D189 + D199 — concurrent with security hardening pass | v2 → v3 timing; pen test budget; sandbox runtime selection |

---

## Beta Playground (added Phase 2.76, 2026-05-09)

**Permanent capability** (D181): pluggable experimentation against the stable substrate. 5 active profiles. See [`playground/README.md`](../../../playground/README.md).

| # | Profile | Status | Target phase | Latest learning |
|---|---|---|---|---|
| 1 | hermes-agent | exploring | 7-E (Honcho), 9 (Kanban patterns), 10 (Courier), 18-B (Curator) | 2026-05-09: profile created; v0.13 ships durable Kanban |
| 2 | honcho | exploring | Phase 7-E candidate | 2026-05-09: profile created; MIT, separable from Hermes |
| 3 | deep-agents | exploring | Phase 9 candidate | 2026-05-09: profile created; same vendor as LangGraph runtime |
| 4 | anthropic-agent-teams | exploring | Phase 9 alt candidate | 2026-05-09: profile created; experimental in Claude Code |
| 5 | thinking-machines-tinker | watching | Phase 15-C/D (when Tinker GA) | 2026-05-09: profile created; Tinker private beta |

**Cadence** (D187): monthly review (last Friday) + hard re-evaluation at every release-band cut.

**Tier 2 — adding next month**: Inspect AI · Mastra · DSPy + BAML.

**Tier 3 — research-only watching list** (no Lab seat yet): Strands · Vercel AI SDK 6 · A2A · Browser Use / Stagehand · E2B / Daytona / Modal · Spec Kit / BMAD-METHOD / Factory.ai · OpenAI Agents SDK · Cursor 3 · Devin / Aider / OpenHands · OpenSpec · Replit Agent v3 · Lovable.dev · Claude Code as a meta-runtime study.

---

## B-tier deferral cohorts

The 18 deferred B-subphases group into 4 clear blockers. Once a blocker clears, the cohort can ship together. Lab profile graduations run in parallel and may resolve some B-subphases by adoption rather than by hand-rolled implementation.

### Cohort 1 — needs OpenRouter credit / TTS credentials (8 phases)
Each requires running real LLM or TTS pipelines end-to-end to validate.

- **5-B** MCP graph integration (rewire 5 graph files under `USE_MCP_TOOLS`)
- **6-B** Artifact-store dual-write (graph nodes write artifacts after every LLM call)
- **7-E** Memory-layer graph integration (post-LLM observation writes)
- **8-B** Parallel `dev_graph.js` (replace sequential edges with fan-out/join)
- **15-B** LLM proposer + real outcome comparators (depends on 6-B for artifact-level cost/latency signals)
- **16-B** LLM generators for training outputs (voiceover/storyboard prose quality; written guides); depends on 14-B for post-dev handler registration
- **17-B** Real ElevenLabs/OpenAI TTS + Puppeteer/Playwright + ffmpeg for training videos (needs ElevenLabs/OpenAI credentials + ffmpeg binary on VM; depends on 14-B for handler)
- **21-B** Real Sonnet researcher (replaces stub dispatcher) + cron daemon + Phase 14-A queue handler + Phase 12-B portal UI + Phase 11-A budget gate + Phase 10-A Courier notifications (parallelisable with 14-B; runs at ~$1-2/day)

**Cost estimate to clear all 8**: ~$15–40 in LLM + TTS spend on validation runs + ~$1-2/day ongoing for the autonomous architect (or ~$50–100 in validation if using Opus + ElevenLabs Pro tier).

### Cohort 4 — v1.0 release ops (1 phase, new)
- **20-B** Stripe billing + systemd/k8s health probes + cron retention + nightly backup + security review + load tests + v1.0 release ceremony (needs Stripe + S3/R2 creds + external pen-test budget)

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

**Beta Playground active + 100% A-tier coverage achieved + Master Architect substrate shipped.** Phase 21-A closed 2026-05-09 (same session as Phase 2.76). The next moves are parallel:

1. **B-tier marathon** — 18 deferred subphases across 4 cohorts (21-B added)
2. **Lab graduations** — Tier 1 profiles transition `exploring` → `testing` at next monthly review (last Friday of May)
3. **Strategic watching** — Mira Murati / Thinking Machines Lab tracked in `thinking-machines-tinker` profile; Tier 2 profiles added in June. **Architect 21-B will automate this watching** when wired.
4. **Founder edits Standing Orders**: copy `cognitive-engine/architect/standing_orders.example.yaml` → `_kb/standing_orders.json`; refine Tab 2 weights/targets monthly

The B-subphase work lives in 4 cohorts:

- **C1 — OpenRouter + TTS credentials (8 phases, ~\$15-40 LLM spend + \$1-2/day architect)**: 5-B, 6-B, 7-E, 8-B, 15-B, 16-B, 17-B, **21-B**
- **C2 — UI + user creds (8 phases)**: 9-B, 10-B, 11-B, 12-B, 13-B, 14-B, 18-B, 19-B
- **C3 — Scale-dependent (3 phases)**: 7-B, 7-C, 7-D memory backends (activate at 100+ observations / multi-host / semantic-search load)
- **C4 — v1.0 release ops (1 phase)**: 20-B (Stripe + health endpoints + cron + backup + security/load/release ceremony)
- **Phase 22 — Action Boundary Enforcement** (lands at v2 → v3 boundary): tool/egress allowlists, sandbox runtimes, signed-manifest provenance — concurrent with security hardening pass

Best next moves, depending on available inputs:

- **OpenRouter top-up** → Cohort 1 unlocks. Enables the first real end-to-end factory run with real LLM calls, which is the gate for R1.
- **UI sprint** → Cohort 2 unlocks. Admin UI (12-B) is the highest-leverage because it's the surface for every other B-tier's config knobs.
- **Stripe + S3/R2 + pen-test** → Cohort 4 unlocks 20-B and starts v1.0 release-band work.

**Or pause and ship what's built.** All 16 modules are independently consumable as libraries today. Anyone can `import { createCustomerPortal } from "./customer-portal/portal.js"` and use the substrate. The factory pipeline itself is unchanged from Phase 4 close; scaffolds are feature-flagged off.

---

## Working conventions (codified during this session)

- **PR flow** for every change since 5-A. No direct push to `main`. Squash-merge via `gh pr merge --squash --delete-branch`. Branch + tag every phase close. (See `D.Roadmap/README.md` "Git workflow" section for the 7-step sequence.)
- **Pre-phase code survey** is mandatory before scoping any phase (Phase 4 Lesson #1). Catches `memory.js` already exists, `llm_calls` table already exists, etc. Saves rewrites.
- **Beta Playground** (since Phase 2.76, 2026-05-09): pluggable experimentation against the stable substrate. Three-stage pipeline `Research/` → `playground/` → `cognitive-engine/`. Monthly review cadence. See `playground/README.md`.
- **Scaffolding pattern** (proven 16× across 5-A → 20-A, codified in `03_Scaffolding_Pattern.md`):
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
- **Agent delegation model**: `D.Roadmap/01_Agent_Delegation_Model.md` (pipeline + meta agents, cost-tier map)
- **Current architecture (v0.0.1 snapshot)**: `D.Roadmap/02_Current_Architecture.md` — "YOU ARE HERE" narrative of 17 modules, composition, flags, cost posture (rev v4 at 2026-05-09)
- **Scaffolding pattern (14×-proven recipe)**: `D.Roadmap/03_Scaffolding_Pattern.md` — apply to Phase 19 and beyond
- **Long-term R4/R5 vision**: `Master_Factory_Architect.md` (parent dir; r0.5 at 2026-05-09, §11.9 has Master Architect + Continuous Research as a permanent capability)
- **Code modules** (in `agentryx-factory` repo, mirrored from this PMD as needed):
  - Foundation: `cognitive-engine/{tools,memory,graph,*_graph}.js`, `llm-router/`, `factory-dashboard/`, `server/admin-keys.mjs`
  - Phase 5+: `cognitive-engine/{mcp,artifacts,memory-layer,parallel,verify-integration,cost-tracker,courier,admin-substrate,replay,concurrency,self-improvement,training-gen,training-videos,marketplace,customer-portal,release,architect}/`
  - Beta Playground: `playground/{README.md,PROFILE_TEMPLATE.md,runner.js,profiles/,results/}` (since 2026-05-09)
- **Phase tags on origin**: `git tag -l | grep phase-` (26 anchors after `phase-21a-closed` lands)
- **GitHub milestones**: 18 milestones, 8 closed (foundation), 10 open (scaffolded but partial)

---

## Append rules for future updates

When closing a new phase or changing status:

1. Bump the **Last updated** date at the top.
2. Update the affected row in the per-phase table.
3. Update the headline numbers if counts change.
4. If a B-tier cohort blocker clears, reflect it in "What's next."
5. Don't add per-phase narrative here — that belongs in `Phase_NN_Status.md`. This doc is the index, not the encyclopedia.
