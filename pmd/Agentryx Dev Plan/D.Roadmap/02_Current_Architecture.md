# Current Architecture — YOU ARE HERE (v0.0.1)

**Snapshot date**: 2026-04-24 (Phase 18-A closed)
**Release band**: v0.0.1 (R&D / experimentation, per `Master_Factory_Architect.md` §1)
**Git tip**: `main` at `phase-18a-closed` tag
**Purpose**: this is the *mid-looking* document — what the factory IS today, not what it WILL be (that's `Master_Factory_Architect.md`) and not what to DO next (that's `README.md` + per-phase Plans).

Read this first when joining the project mid-flight.

---

## 1. Release-band position

| Band | Status |
|---|---|
| v0.0.1 | ✅ **In progress** — 14 A-tier modules scaffolded; 0 production wiring (all B-tiers deferred) |
| R1 | ⏳ target week 10 |
| R2 / R3 / R4 / R5 | ⏳ future |

**What "A-tier scaffolding" means**: the library is written, smoke-tested, behind a feature flag defaulted **off**. It does not yet participate in the real factory pipeline. B-tier wiring (graph integration, real external APIs, UI) is deferred per blocker cohort.

**Why this posture**: configurability-first (P1). Each scaffold represents one plug-in interface. When B-tier cohorts clear, the factory gains capabilities one feature flag at a time — each reversible via the flag alone.

---

## 2. Factory at a glance — 14 modules, 683 assertions, $0 spent

```
                  ┌────────────── pipeline (Phases 0-4, production-path) ──────────────┐
                  │                                                                     │
 SRS/FRS/PRD ───▶ Genovi ───▶ PMD agents (Picard, Sisko, Troi, Jane, Spock, Torres,  ─▶ Verify portal
    (intake)    (Phase 3)    Tuvok, Data, Crusher, O'Brien) via pre_dev + dev graphs    (integration = Phase 9-B)
                               │ (Phase 4 registry drives graph construction)
                               │
                               │    ┌── cross-cutting A-tier scaffolds (Phases 5-A → 20-A) ──┐
                               │    │                                                        │
                               ▼    ▼                                                        │
                          │  Phase 5-A   mcp/                 — MCP tool plane substrate     │
                          │  Phase 6-A   artifacts/           — versioned artifact store     │
                          │  Phase 7-A   memory-layer/        — lesson/pattern observations   │
                          │  Phase 8-A   parallel/            — fan-out/join reducers         │
                          │  Phase 9-A   verify-integration/  — bundle+feedback contract     │
                          │  Phase 10-A  courier/             — 8 event × 6 channel routing  │
                          │  Phase 11-A  cost-tracker/        — CostRollup library            │
                          │  Phase 12-A  admin-substrate/     — configs + flags + roles + audit │
                          │  Phase 13-A  replay/              — time-travel executor         │
                          │  Phase 14-A  concurrency/         — FS queue + worker pool        │
                          │  Phase 15-A  self-improvement/    — proposal lifecycle + applier │
                          │  Phase 16-A  training-gen/        — 6 template generators        │
                          │  Phase 17-A  training-videos/     — TTS + capture + stitch       │
                          │  Phase 18-A  marketplace/         — meta-registry of all modules │
                          │  Phase 19-A  customer-portal/     — accounts + submissions + SLA  │
                          │  Phase 20-A  release/             — metering + retention + GDPR   │
                          │                                       compliance + readiness +    │
                          │                                       backup (consolidation phase)│
                          │                                                                │
                          └────────────────────────────────────────────────────────────────┘
                          + cognitive-engine/integration/composition-smoke.js (cross-phase regression net, 73 assertions)
```

**Numbers** (as of Phase 20-A close + cross-phase composition smoke):

| Metric | Value |
|---|---|
| A-tier scaffolds shipped | **16** — 100% coverage ✅ |
| Phases fully closed (Plan+Status+Decisions+Lessons) | 20 of 20 |
| Smoke-test assertions across scaffolds | **947** per-module + **73** cross-phase = **1020 total** |
| LLM spend across all scaffolding | **$0.00** |
| Phase rollback tags on origin | **24** |
| Feature flags registered | **14** (all default off) |
| Decisions logged | D1–D180 |

**Numbers matter** because every claim in this document is backed by an assertion. When a module's README says "138 assertions pass," running that smoke test is the verification. The cross-phase composition smoke at `cognitive-engine/integration/` proves they all work together.

---

## 3. The 16 modules — one-line each + composition

| # | Module (path) | Phase | Category | What it is | Consumed by |
|---|---|---|---|---|---|
| 1 | `mcp/` | 5 | mcp_tool | MCP client + bridge + servers.json catalogue | dev_graph tools (5-B) |
| 2 | `artifacts/` | 6 | artifact_store | FS-backed, sha256-indexed artifact store | every node that emits output (6-B) |
| 3 | `memory-layer/` | 7 | memory_backend | scope-partitioned markdown + index.jsonl | proposer (15-A); LLM prompts (7-E) |
| 4 | `parallel/` | 8 | handler | fan-out proof + 7 reducers | dev_graph (8-B) |
| 5 | `verify-integration/` | 9 | handler | BuildBundle + FeedbackPayload + fix-router | post_dev_graph (9-B) |
| 6 | `courier/` | 10 | handler | 8 event × 6 channel dispatch + routing config | every phase that needs to notify (10-B) |
| 7 | `cost-tracker/` | 11 | handler | CostRollup from artifacts + llm_calls + thresholds | dashboard (11-B); pre-flight gates |
| 8 | `admin-substrate/` | 12 | handler | 7 configs + 14 flags + 4 roles + audit log | every other module's flag lookup |
| 9 | `replay/` | 13 | handler | RunSnapshot + plan builder + executor | self-improvement (15-A evaluator); debugging |
| 10 | `concurrency/` | 14 | handler | FS queue + worker pool + round-robin fairness | every async job (14-B real handlers) |
| 11 | `self-improvement/` | 15 | proposer | proposal state machine + heuristic proposer + applier | factory evolution (15-B LLM proposer) |
| 12 | `training-gen/` | 16 | generator | 6 template generators (incl. voiceover_script) | Verify portal; Phase 17 |
| 13 | `training-videos/` | 17 | provider | TTS × capture × stitcher; beat-level failure isolation | post-project delivery (17-B real backends) |
| 14 | `marketplace/` | 18 | meta | ModuleManifest + installer + catalogue of all 15 above | admin UI (18-B); self-improvement swap |
| 15 | `customer-portal/` | 19 | handler | accounts + submissions + timeline + SLA + portal facade; per-tenant sandbox | factory intake (19-B HTTP+UI); customer billing (20-A metering) |
| 16 | `release/` | 20 | handler | 5-capability consolidation: metering + retention + GDPR compliance + readiness + backup | v1.0 ops cutover (20-B) |

---

## 4. Architectural patterns we converged on (not designed up-front)

These emerged during scaffolding and are now the house style. Every new module should follow them unless there's a phase-specific reason not to.

### 4.1 Dependency-injected registry per category

Every module that offers plug-in variants ships a registry constructor:

- Phase 9-A `fixRouter`
- Phase 13-A `nodeStubs`
- Phase 14-A `handlerRegistry`
- Phase 15-A proposer (DI via factory arg)
- Phase 16-A `createGeneratorRegistry({defaults})`
- Phase 17-A three-category provider registry (`createProviderRegistry`)
- Phase 18-A marketplace (meta-registry wrapping all above)

Tests inject stubs. Production registers real handlers. Phase 18-A formalises this as the module category `ModuleManifest` schema.

### 4.2 Append-only JSONL for every audit-ish data

Unified mental model. Every module uses one of two filesystem conventions:
- **`index.jsonl`** — newest-last content manifest (artifacts, memory observations, training outputs)
- **`audit.jsonl`** or equivalent — append-only events (admin substrate, self-improvement, marketplace, concurrency per-state dirs)

Why: debuggable with `cat` + `jq`; reconstructable after crash; auditable without DB.

### 4.3 Atomic write = temp-file + rename

Every store that needs strong durability uses the Phase 12-A pattern: write to `dest.tmp.<rand>`, then `rename(tmp, dest)`. POSIX guarantees atomicity within the same filesystem.

Used by: admin-substrate config-store, self-improvement proposal store, training-gen store, training-videos manifest commit, marketplace manifests.jsonl.

### 4.4 Per-item asset directory

Long-running multi-asset outputs live under their own directory with a manifest + asset subdirs + append-only log:

```
_jobs/work/JOB-0042/        Phase 14-A
_proposals/                 Phase 15-A (per-proposal JSON + shared audit)
_training/<project>/        Phase 16-A
_videos/<project>/VID-0042/ Phase 17-A
  ├── manifest.json
  ├── render-log.jsonl
  ├── audio/
  └── capture/
```

Rollback = `rm -rf VID-0042/`. No foreign-key cleanup. No orphans.

### 4.5 Beat-level / item-level failure isolation

The renderer, generator, pipeline patterns all tolerate per-item failure:

- Phase 9-A: one feedback item fails → others route successfully
- Phase 14-A: one job's handler throws → other jobs keep processing
- Phase 16-A: one generator fails → other 5 still produce
- Phase 17-A: one beat's TTS fails → 2 of 3 succeed, render marked `degraded`

Never the silent-success-of-wrong-output pattern. Always a typed failure state on the artifact so the reviewer can see what didn't complete.

### 4.6 Dotted two-segment module ids (Phase 18 onwards)

`<module>.<variant>` — e.g., `training-videos.tts-stub-pack`. Enables grep-friendly grouping without a parser. Remote modules (18-B) can add `@org/` npm-style prefix if needed.

### 4.7 Content + metadata split with SHA-256 linkage

Artifact stores keep content in separate files, manifest rows hold SHA-256. Enables `verify()` integrity check; enables filesystem-level tools (`ls -la`, `sha256sum`); keeps renderer decoupled from storage format.

Applied by: Phase 6-A artifacts, Phase 7-A memory-layer, Phase 16-A training-gen, Phase 17-A training-videos.

### 4.8 Zero-LLM A-tier, LLM B-tier

Every A-tier ship runs offline, deterministic, $0. B-tier adds real external calls. Rationale: smoke tests are stable; demos run anywhere; every module ships before credentials are needed.

---

## 5. Feature flag catalog (12 flags, all default OFF)

From `cognitive-engine/admin-substrate/registry.js`:

| Flag | Owning phase | What flipping ON enables |
|---|---|---|
| `PRE_DEV_USE_GRAPH` | Phase 4 | Pre-dev uses real LLM graph (vs template substitution) |
| `USE_MCP_TOOLS` | Phase 5 | Graph nodes route via MCP bridge |
| `USE_ARTIFACT_STORE` | Phase 6 | Graph nodes dual-write artifacts |
| `USE_MEMORY_LAYER` | Phase 7 | Graph + Verify write user_note observations |
| `USE_PARALLEL_DEV_GRAPH` | Phase 8 | dev_graph fan-out/join active |
| `USE_VERIFY_INTEGRATION` | Phase 9 | Bundle publish + feedback webhook active |
| `USE_COURIER` | Phase 10 | Factory events dispatch to channels |
| `USE_COST_TRACKER` | Phase 11 | Dashboard bound + threshold alerts active |
| `USE_SELF_IMPROVEMENT` | Phase 15 | Proposer runs on cadence |
| `USE_TRAINING_GEN` | Phase 16 | post_dev enqueues training_gen jobs |
| `USE_TRAINING_VIDEOS` | Phase 17 | training_video_render jobs dispatch |
| `USE_MODULE_MARKETPLACE` | Phase 18 | Factory boot runs installAllBuiltins |
| `USE_CUSTOMER_PORTAL` | Phase 19 | HTTP API + UI accept customer submissions; queue handler + Courier active |
| `USE_PUBLIC_RELEASE` | Phase 20 | Cron retention + nightly backup + health endpoints + Stripe reporter |

**Flag-gating discipline**: turning ON any of the above should be a one-line change with no code edits elsewhere. Turning OFF reverts to pre-flag behavior exactly. This is enforced by keeping B-tier wiring modular — when B-tier writes a graph edge, it's wrapped in a flag check at the edge.

---

## 6. Known blockers (B-tier cohorts)

| Cohort | Phases | Blocker | Cost estimate |
|---|---|---|---|
| C1 — OpenRouter credit / TTS credentials | 5-B, 6-B, 7-E, 8-B, 15-B, 16-B, 17-B | Need OpenRouter top-up + ElevenLabs/OpenAI creds | ~$15–40 Haiku/Sonnet validation runs |
| C2 — UI work + user credentials | 9-B, 10-B, 11-B, 12-B, 13-B, 14-B, 18-B, 19-B | React admin panel + customer UI + Slack/GitHub/SMTP creds | 2-3 dev-weeks |
| C3 — Scale-dependent | 7-B, 7-C, 7-D | Needs 100+ observations or multi-host factory | emerges with load |
| C4 — v1.0 release ops | 20-B | Stripe + S3/R2 + external pen-test budget | ~$5-15K (pen test) + ongoing infra |

**17 B-subphases total** across 4 cohorts. Each unlock is independent — can ship C1 without C2, etc.

**Critical path within cohorts**: 6-B and 14-B together unlock 10 of the 17 B-subphases. See [04_B_Tier_Marathon.md](04_B_Tier_Marathon.md) for full sequencing analysis.

---

## 7. How to navigate this project

**By role**:
- Strategic design → `Master_Factory_Architect.md` (R1-R5 vision)
- Tactical planning → `D.Roadmap/README.md` (20-phase table) + per-phase Plan.md
- Ops status → `D.Roadmap/Dev_Task_list_Update.md` (single-page dashboard)
- Current state → this file
- **B-tier marathon plan → `D.Roadmap/04_B_Tier_Marathon.md` (path from v0.0.1 to R1)**
- Decision archaeology → every phase has `Decisions.md` (D1-D180 so far)
- Post-mortem learnings → every phase has `Lessons.md`

**By question**:
- "Why did we choose X over Y?" → the nearest `Phase_NN_Decisions.md`
- "What surprised us during Phase NN?" → `Phase_NN_Lessons.md`
- "What does module X expose?" → `cognitive-engine/<module>/README.md`
- "How do I add a new module?" → `D.Roadmap/03_Scaffolding_Pattern.md`
- "What's left before R1?" → `Dev_Task_list_Update.md` → "What's next" + cohort tables

**By git**:
- Every phase close is a PR + tag. `git show phase-20a-closed` is the authoritative state snapshot at A-tier completion.
- Every module's smoke test can be rerun: `node cognitive-engine/<module>/smoke-test.js`.
- Full per-module regression: `for m in <list>; do node cognitive-engine/$m/smoke-test.js || exit 1; done`.
- **Cross-phase composition smoke**: `node cognitive-engine/integration/composition-smoke.js` — exercises all 16 A-tier modules in one workspace end-to-end (73 assertions). Run after any change to a shared boundary.

---

## 8. What v0.0.1 is NOT (deliberate absences)

- **Not a running production factory.** All B-tier is deferred. The pipeline that Phase 1 restored (pre_dev / dev / post_dev graphs) still runs the Phase-4-era behavior. Scaffolded modules are libraries waiting to be wired.
- **Not a multi-tenant system.** Single workspace, single admin, no billing (Phase 19/20 territory).
- **Not an external SaaS.** Every module is filesystem-backed. Cloud upload, signed manifests, remote registries are all 18-B / 19 / 20.
- **Not network-dependent.** Every smoke test runs offline with zero external API calls. Deterministic.

---

## 9. Document revision log

| Rev | Date | Trigger | Sections touched |
|---|---|---|---|
| v1 | 2026-04-24 | Post Phase 18-A close; first chronicle of the v0.0.1 scaffold bundle | all |

Future revisions expected at:
- Each new phase close that meaningfully shifts the composition graph (Phase 19 closes, Phase 20 closes)
- R1 cutover — this file gets replaced by a "R1 Current Architecture" equivalent
