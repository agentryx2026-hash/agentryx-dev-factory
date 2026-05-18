# B-Tier Marathon — Path from v0.0.1 to v3 production

**Snapshot date**: 2026-05-18 (15 PRs merged today — Cohort 1 substrate fully closed in main; Cohort 2 substrate ~90% in main; only 19-B HTTP/UI + ops credentials remain)
**Purpose**: the *forward-looking* document. v0.0.1 A-tier substrate is complete; this maps the work between today and v3 production cutover (~5-6 months).

## 2026-05-18 update — all substrate PRs landed in main ✅

In one session, **15 PRs merged** to main + **9 phase-close tags** pushed. The 2026-05-11 substrate sweep that lived across 14 open PRs is now fully integrated. Stack depth: 0.

**Cohort 1 — all substrate in main**
- **5-B** ✅ in main (#63) — `tool-selector.js` + 5 graphs rewired under `USE_MCP_TOOLS`. Tag `phase-5-b-closed`.
- **6-B** ✅ in main (via #42) — RouterChatModel chokepoint
- **7-E** ✅ in main (via #42) — sync-from-artifacts
- **8-B** ✅ in main (#46) — `dev_graph.js` parallel topology under `USE_PARALLEL_DEV_GRAPH`. Tag `phase-8-b-closed`.
- **15-B** 🟡 proposer in main (via #42); comparators still need real artifact deltas (founder cycle)
- **16-B Tier B** ✅ in main (#60) — `training_gen` handler. Tag `phase-16-b-tier-b`.
- **17-B Tier B** ✅ in main (#61) — `training_video_render` handler with all-null defaults. Tag `phase-17-b-tier-b`.

**Cohort 2 — UI sprint + handlers in main**
- **9-B substrate** ✅ in main (#62 = read UI from #42 + webhook + HMAC). Tag `phase-9-b-substrate-closed`. Remainder: real http client + auto-routed fix cycle (Verify-stg deploy + cycle).
- **10-B** 🟡 read UI in main (#42). Remainder: real backends (Slack/SMTP/GitHub creds).
- **11-B** 🟡 read UI in main (#42). Remainder: per-tenant charts + threshold alerts via 10-B Courier.
- **12-B** ✅ full done in main (#42) — 8 Admin sub-tabs.
- **13-B substrate** ✅ in main (#64 = read UI from #42 + LLM-stub + execute endpoint). Tag `phase-13-b-substrate-closed`. Remainder: side-by-side diff UI + cross-pipeline UI + first real cycle.
- **14-B** ✅ in main (#56 = Tier B + quotas) + (#57 = orphan reaper). Tag `phase-14-b-closed`. Remainder: legacy-path retirement + 19-B handler.
- **18-B** 🟡 catalogue read UI in main (#42). Remainder: remote fetch + signature verification.
- **19-A** ✅ in main since 2026-04-24 — customer-portal substrate, 138 smoke assertions. **19-B**: project_intake queue handler (#66, D224) + HTTP surface (D225, 6 endpoints under `/api/customer-portal/*` with bearer auth + auto-enqueue) both shipped 2026-05-18. **What remains**: React customer dashboard + pre_dev→delivered back-feed + SLA breach scanner + admin auth (Phase 22).

**Cohort 3** — unchanged (scale-gated). **Cohort 4** — unchanged (v3 release work).

**New phase ships in main**
- **Phase 21** ✅ (#42) — Master Architect (autonomous research) + 21-A.1 + 21-B + visible-factory sprint. Tag `phase-21-closed`.
- **Phase 21-B.2** ✅ in main (#58) — Architect cadence → Phase 14-A queue under `USE_ARCHITECT_QUEUE`. Tag `phase-21-b-2-closed`.

**Doc + governance ships**
- 10 named-agent SOULs + roster README (#43)
- Hermes 2026-05-11 re-evaluation + 7-E Honcho-direct-adopt note (#44)
- Marathon update + first-real-cycle runbook (#45)
- Graceful shutdown hook (#55)
- Telemetry merge-marker hotfix (#59)

**What's now LIVE on the running telemetry**:
- Queue worker registers 6 kinds: `pre_dev, dev, post_dev, architect_research, training_gen, training_video_render`
- Architect cadence daemon runs (inline by default; `USE_ARCHITECT_QUEUE=true` switches to queue mode)
- Orphan reaper sweeps stale in-flight jobs on every boot
- Graceful SIGTERM/SIGINT shutdown closes MCP connections + HTTP server with 8s grace

**Lab profile updates**
- Hermes re-evaluated 2026-05-11 → PASS for now, RE-EVALUATE 2026-06-10. Roadmap adjustment: when 7-E opens (Cohort 3 trigger), prefer **direct Honcho adoption** over pattern-steal.

**See also**: [`05_First_Real_Cycle_Runbook.md`](05_First_Real_Cycle_Runbook.md) for the founder action to validate the substrate end-to-end.

This is a living doc. Update it after every B-subphase ships, after every Lab profile graduation, and at every release-band cut.

Read this **after** [02_Current_Architecture.md](02_Current_Architecture.md) (where we are) and [Master_Factory_Architect.md](../Master_Factory_Architect.md) (where we're going). This file is the bridge between A-tier complete and v3 production.

## Release-band schedule (per Phase 2.76 D189)

| Version | Maps to architectural band | Target | What happens here |
|---|---|---|---|
| **v0.0.1** | pre-R1 | now (2026-05-09) | A-tier complete + Beta Playground active; internal R&D |
| **v1** | R1 | mid-2026 (~2-3 months) | First real factory run; ≥3 Lab profiles graduated; ≥1 B-tier cohort closed |
| **v2** | R2 | mid-late 2026 (~4-5 months) | Advanced internal testing; first external pilot users (no production stakes); UI sprint complete |
| **v3** | R3 | **2026-Q4 / 2027-Q1 (~5-6 months)** | **Production-grade; first paid customer projects; security hardening pass; Stripe billing live** |

The B-tier marathon spans v0.0.1 → v3. Lab profile graduations are *parallel* to B-tier work — a Lab graduation closes a roadmap row by adopting an external solution; a B-tier ship closes a row by hand-rolling our own.

---

## 1. The shape of the marathon

A-tier shipped 16 modules. **17 originally-deferred B-subphases** + **5 active Beta Playground profiles** stood between v0.0.1 and v3 production at 2026-05-09. As of 2026-05-11 most C1 + half of C2 substrate has shipped — what stands now is **validation + external credentials + v3 release work**:

| Cohort | Phases | Status (2026-05-11) | Blocker | Cost to unlock |
|---|---|---|---|---|
| **C1** | 5-B, 6-B, 7-E, 8-B, 15-B, 16-B, 17-B | ✅ substrate; 🟡 validation pending | First real LLM cycle (~$5-15 total) | OpenRouter cycle + ElevenLabs key for 17-B real backends |
| **C2** | 9-B, 10-B, 11-B, 12-B, 13-B, 14-B, 18-B, 19-B | ✅ mostly substrate; 🟡 ops creds + 19-B multi-session pending | Slack/GitHub/SMTP creds, Verify-stg deploy, 19-B design | React work for 19-B + Stripe-adjacent decisions |
| **C3** | 7-B, 7-C, 7-D | ⏳ scale-gated | 100+ observations / multi-host / semantic-search demand | $0 until demand shows up |
| **C4** | 20-B | ⏳ v3 release | Stripe + S3/R2 + external pen-test | ~$5-15K (pen test) + ongoing infra |

Each cohort unlocks independently. **Soft prereq satisfied**: 14-B handler registration was the gate for 16-B / 17-B / 19-B handler kinds; 14-B handlers + 16-B + 17-B Tier B all shipped 2026-05-10 / 2026-05-11.

**Beta Playground in parallel** (Phase 2.76, D181): 5 active profiles with Tier 1 (hermes-agent, honcho, deep-agents, anthropic-agent-teams) targeting graduation to stable as `exploring` → `testing` → `adopting` over the next 1-3 monthly reviews. Tier 2 watching profile (thinking-machines-tinker) tracks Mira Murati's lab. **Lab graduations directly resolve B-subphases**: e.g., honcho adoption closes Phase 7-E; deep-agents adoption shapes Phase 9 implementation; hermes-agent capability adoptions slot into 7-E (memory), 9 (Kanban patterns), 10 (Courier), 18-B (Curator).

**See `playground/README.md` for the Lab roster and `pmd/.../Phase_2.76_Lab_and_Strategy_Update_2026_05/` for the formal Decisions (D181-D189) authorising this parallel track.**

---

## 2. Per-subphase punch list

Each row: what's missing, what unlocks it, expected effort, downstream consumers.

### Cohort 1 — needs OpenRouter credit / TTS credentials

#### **5-B — MCP graph integration**
- **What's missing**: rewire 5 graph files (`pre_dev_graph.js`, `dev_graph.js`, `post_dev_graph.js`, `factory_graph.js`, `graph.js`) to route tool calls through `cognitive-engine/mcp/bridge.js` when `USE_MCP_TOOLS=true`
- **Prereq**: OpenRouter credit (to validate tool-using LLM calls work)
- **Effort**: ~1 session
- **Risk**: graph file edits touch shared state; flag-gating discipline + composition smoke catch regressions
- **Downstream**: nothing strictly downstream, but unlocks the "MCP everywhere" capability that 6-B benefits from

#### **6-B — Artifact-store dual-write** ⭐ critical-path
- **What's missing**: graph nodes call `writeArtifact(projectDir, {...})` after every LLM response when `USE_ARTIFACT_STORE=true`. Currently graph state lives only in LangGraph state.
- **Prereq**: OpenRouter credit (to produce real artifacts to capture)
- **Effort**: ~1 session
- **Why critical-path**: the data substrate for **7 downstream phases** (11-B cost dashboard, 13-B replay UI, 15-B LLM proposer comparators, 16-B LLM training-gen, 7-E memory-layer integration, 5-B for tool-call artifacts, 8-B parallel branches need artifact join)
- **Cost estimate**: ~$2-5 in Haiku/Sonnet validation runs

#### **7-E — Memory-layer graph integration**
- **What's missing**: post-LLM hooks in graph nodes call `memory.addObservation({kind, scope, content, refs})` for lessons + patterns observed during a run
- **Prereq**: 6-B (so refs.artifact_ids point at real artifacts)
- **Effort**: ~1 session
- **Downstream**: 15-B LLM proposer reads richer memory; admin UI gains a "what did the factory learn" view

#### **8-B — Parallel `dev_graph.js` rewire**
- **What's missing**: replace sequential edges with `parallelFanOut` from Phase 8-A; fold results via 7 reducers
- **Prereq**: 6-B (parallel branches must produce artifacts that the join reducers can consume)
- **Effort**: ~1 session
- **Validation gate**: real-world speedup measurement (8-A measured 1061ms vs 3000ms in synthetic; 8-B confirms the gain holds with real LLM calls)

#### **15-B — LLM proposer + real comparators**
- **What's missing**: swap heuristic proposer for an LLM-backed one (Opus 4.7 or Sonnet 4.6); replace stub `compareOutcomes` with a real comparator that reads artifact cost/latency/success-rate deltas
- **Prereq**: 6-B (comparators read from artifact store)
- **Effort**: ~2 sessions
- **Cost**: variable — proposer runs as cron; daily cost ~$1-5 depending on observation volume

#### **16-B — LLM training generators**
- **What's missing**: swap 6 template generators for LLM-backed ones (real prose); register `training_gen` queue handler
- **Prereq**: 14-B (queue handler), 6-B (project context), OpenRouter credit
- **Effort**: ~2 sessions
- **Validation**: a published voiceover script that reads naturally, not as template output

#### **17-B — Real ElevenLabs/OpenAI TTS + Puppeteer/Playwright + ffmpeg**
- **What's missing**: real backends for 3 provider categories; register `training_video_render` queue handler
- **Prereq**: 14-B (queue handler), 16-B (LLM-quality voiceover scripts to render); ElevenLabs/OpenAI credentials; ffmpeg binary on factory VM
- **Effort**: ~2 sessions
- **Cost**: ~$0.30-1.00 per rendered minute of video at ElevenLabs rates

**Cohort 1 critical path**: `6-B → {7-E, 8-B, 15-B}` and `14-B → {16-B → 17-B}`. 6-B and 14-B are the two unlock keys; everything else fans out from them.

---

### Cohort 2 — UI sprint + ops credentials

#### **9-B — Verify portal real integration**
- **What's missing**: real `VERIFY_URL` HTTP client (not mock); webhook endpoint in `factory-dashboard/server/telemetry.mjs`; multi-app mode in Verify portal
- **Prereq**: Verify portal admin access; `VERIFY_URL` env + auth
- **Effort**: ~2-3 sessions (Verify-side work + factory-side webhook)
- **Validation**: a real customer review approves a build → `delivered` transitions on the customer portal submission

#### **10-B — Courier real backends + Hermes deploy**
- **What's missing**: Hermes container deployed in gateway mode; real Slack bot OAuth + GitHub App install + SMTP creds
- **Prereq**: container infra (already on VM); per-channel admin work
- **Effort**: ~2 sessions (container deploy + per-channel auth setup)
- **Cost**: ongoing minor ($5-20/month per channel)

#### **11-B — Cost dashboard UI**
- **What's missing**: React dashboard pages (per-project, per-tenant, per-day, per-agent, per-model); HTTP endpoint in `factory-dashboard/server/`; threshold-alert wiring via Courier
- **Prereq**: 6-B (real cost data to show), 10-B (alert delivery)
- **Effort**: ~2-3 sessions

#### **12-B — Admin UI** ⭐ high-leverage
- **What's missing**: React admin pages (configs, flags, modules, customers); Postgres `config_settings` migration; runtime flag-toggle endpoint
- **Prereq**: nothing in particular — all data substrate exists
- **Effort**: ~3-4 sessions (Postgres migration + React + role-gating)
- **Why high-leverage**: every other B-tier becomes operator-friendly once admin UI exists. Currently every config edit is a manual JSON file change.

#### **13-B — Replay UI + LLM stub**
- **What's missing**: default `nodeStub` that replays via fresh LLM call (currently stubs are test-injected); React timeline UI; HTTP endpoint
- **Prereq**: 6-B (artifacts to replay)
- **Effort**: ~2-3 sessions

#### **14-B — Concurrency real handlers + UI** ⭐ critical-path for 16-B/17-B
- **What's missing**: register `pre_dev` / `dev` / `post_dev` / `project_intake` / `training_gen` / `training_video_render` handlers in the registry; HTTP submit endpoint; React queue UI; per-project quotas wired to Phase 11-A
- **Prereq**: nothing infrastructural; bench-able as soon as someone codes the handlers
- **Effort**: ~2-3 sessions
- **Why critical-path**: 16-B + 17-B both run async via the queue, so they need 14-B to be live. C2 starting with 14-B unlocks the largest chunk of C1 work.

#### **18-B — Marketplace remote fetch + UI**
- **What's missing**: remote registry contract (GitHub-raw or npm-style); signature verification; admin UI for browse/install/uninstall; boot-time install from `configs/enabled_modules.json`
- **Prereq**: 12-B (admin UI scaffold to extend)
- **Effort**: ~3-4 sessions

#### **19-B — Customer portal HTTP + UI**
- **What's missing**: Fastify routes mapping portal API; React customer dashboard + submission form + status page; password auth (argon2id) + email verification; rate limiting; SLA breach scanner cron
- **Prereq**: 14-B (queue handler for project_intake), 10-B (notifications), 11-B (budget gate)
- **Effort**: ~4-5 sessions

**Cohort 2 critical path**: `14-B → {16-B, 17-B, 19-B}` and `12-B → 18-B`. 14-B unlocks the largest slice of value because three other phases depend on it.

---

### Cohort 3 — scale-dependent (memory backends)

#### **7-B — sqlite FTS5 backend**
- **Trigger**: ~100 observations across the memory layer makes filesystem walks slow
- **Effort**: ~1-2 sessions
- **Defer until**: `summarizeArtifacts` / `recall` query latency exceeds 200ms

#### **7-C — Postgres backend**
- **Trigger**: multi-host factory deployment OR Phase 14 multi-project pressure
- **Effort**: ~2-3 sessions
- **Defer until**: factory runs on >1 VM concurrently

#### **7-D — Vector / embedding backend**
- **Trigger**: keyword-based recall stops returning useful results (~500+ observations)
- **Effort**: ~2 sessions + embedding model selection
- **Defer until**: 15-B's LLM proposer needs semantic recall to find relevant lessons

These three are gated on real factory load that doesn't exist yet at v0.0.1. Don't pre-build.

---

### Cohort 4 — v1.0 release ops

#### **20-B — Stripe + ops automation + v1.0 ceremony**
Five distinct work items bundled into one phase:

1. **Stripe billing** — consume `runDailyMetering` rollups; push usage records; invoicing; webhook for payment events. ~2 sessions + Stripe sandbox testing.
2. **HTTP health endpoints** — `/healthz` (liveness) + `/readyz` (wraps `assembleHealthReport`) in `factory-dashboard/server/`. ~1 session.
3. **Cron retention + nightly backup** — daily dryRun → admin queue; weekly auto-apply; nightly snapshot + S3/R2 upload. ~2 sessions + cloud creds.
4. **Security review** — external pen test ($5-15K typical); threat modeling; dependency audit (`npm audit` + Snyk). ~1-2 weeks of external engagement.
5. **v1.0 release ceremony** — CHANGELOG.md from git log; migration guide; marketing site update; support rotation calendar. ~1 session.

**Total effort**: ~3 weeks elapsed (parallelisable), ~$5-15K external (pen test).

---

## 3. Suggested sequencing

Three viable sequences, depending on what's available:

### Sequence A — credentials-first (fastest path to "factory works end-to-end")
```
1. OpenRouter top-up        →  ✅ done (2026-05-10, $9.91 balance + auto top-up)
2. 14-B substrate           →  ✅ done (Tier B + quotas; PR pending)
3. 6-B chokepoint           →  ✅ done (RouterChatModel.invoke hook; PR #42)
4. 5-B / 7-E / 8-B / 15-B substrate → ✅ done (all PRs pending)
5. 16-B / 17-B Tier B       →  ✅ done (handler registrations; PRs pending)

──── ALL SUBSTRATE NOW SHIPPED ────

6. First real validation cycle  → ⏳ founder action (see [`05_First_Real_Cycle_Runbook.md`](05_First_Real_Cycle_Runbook.md))
7. PR merges + tag closes        → ⏳ founder action
8. Cohort 2 remainder (9-B/10-B/11-B/19-B)  → needs creds + multi-session work
9. Stripe + ceremony (20-B)      → v3 release work
```
**Time to first real factory run**: 1 founder action (flip flags + click "Run cycle now").
**Time to R1**: ~6-8 weeks elapsed from a validated first cycle.

### Sequence B — UI-first (operator-friendly path)
```
1. UI sprint starts        →  12-B admin UI (3-4 sessions)
2. Then 14-B               →  (with admin queue tab)
3. OpenRouter top-up       →  6-B + co.
4. Stripe + ceremony       →  20-B
```
**Operator wins faster** — every config knob has a UI before real LLM data shows up.
**Tradeoff**: longer time to first real factory run.

### Sequence C — productize-now (skip R1, ship the foundation band)
```
1. Pause B-tier work
2. Polish docs + add example projects + write blog posts
3. Open-source the factory at v0.0.1 (or keep private)
4. Decide R1 path based on early-adopter feedback
```
**Tradeoff**: lose momentum on the v1.0 vision; gain real-world feedback on the substrate.

---

## 4. Critical path callouts

These two unlock the most downstream work. Resolving them early shortens the marathon disproportionately:

- **6-B (artifact dual-write)** — unlocks 7 downstream phases. ~$3 cost, 1 session.
- **14-B (queue handlers)** — unlocks 3 downstream phases (16-B, 17-B, 19-B). $0 cost, 2-3 sessions.

Doing 6-B and 14-B first means **10 of 17 B-subphases become directly actionable** (7 from 6-B + 3 from 14-B; some overlap).

**Parallel critical path from the Lab**: Honcho adoption (Phase 7-E) is a near-zero-cost win that compresses Phase 7's roadmap. Hermes Kanban pattern adoption shapes Phase 9 to such a degree that we may collapse 9-A scope. Both are gated by Lab graduation timeline, not by credentials or budget.

---

## 5. Decision points along the way

Things to revisit as B-tier ships:

| When | Decision |
|---|---|
| After 6-B | Are real per-call costs in the expected range ($X for an N-token request)? Adjust budget caps in `cost_thresholds` config. |
| After 14-B | Is the in-process worker pool sufficient, or do we need OS-process workers (worker_threads / child_process)? Phase 14-A noted this as a 14-B-or-later concern. |
| After 15-B | Is the LLM proposer worth its cost? Compare proposal acceptance rate × benefit vs. proposer LLM spend. Demote to heuristic if not. |
| After 17-B | Stub costs guessed ElevenLabs at ~$0.00003/char. Real cost may vary. Re-tune. |
| After 19-B | Are tier defaults (free=72h SLA, pro=24h) calibrated to actual factory throughput? May need adjustment. |
| Before 20-B Stripe | What's the per-customer COGS? `runDailyMetering` rollups answer this. Set Stripe pricing accordingly. |

---

## 6. Going-public checklist (gate to v3 production)

Before cutting v3 (first paid customer projects), every box below must be checked. Per Phase 2.76 D189, security hardening lands in this gate (deferred from v0.0.1 → v2 to here).

**Substrate gates**:
- [ ] All 17 B-subphases shipped (or explicitly decided to defer past v3)
- [ ] At least 3 Lab profiles graduated to stable
- [ ] Composition smoke (`integration/composition-smoke.js`) passes
- [ ] Per-module smokes all pass (16+ modules × respective assertion counts)
- [ ] Lab runner produces a comparison report stable vs adopted-experimental for each graduated profile

**Functional gates**:
- [ ] At least 3 real customer projects run end-to-end (pre_dev → dev → post_dev → delivered)
- [ ] Cost dashboard shows real spend per tenant
- [ ] Verify portal handled at least one round-trip feedback cycle on a real bundle
- [ ] Backup + restore tested (snapshot → drop workspace → restore from manifest → integration smoke passes again)

**Security hardening (now lands at v3 per D185+D189)**:
- [ ] Pen test report received + Sev-1/Sev-2 findings closed
- [ ] Hermes hardened config: container backend + WRITE_SAFE_ROOT + explicit allowlists + no YOLO + secrets chmod 600
- [ ] Skill provenance signing wrapper around marketplace installs
- [ ] Audit log every external message + every tool approval (Phase 10/12 substrate already supports)
- [ ] All accumulated PROFILE.md "Security findings" reviewed and addressed or accepted-with-reason

**Release ceremony gates**:
- [ ] CHANGELOG.md generated from git log; migration guide reviewed
- [ ] Marketing site live with link to public sign-up
- [ ] Stripe sandbox green-light + production webhook configured
- [ ] On-call rotation calendar published
- [ ] Public announcement post drafted + reviewed by founder

When all boxes checked: cut `v3.0.0` tag, post the announcement, watch the cost panel.

---

## 7. Document revision log

| Rev | Date | Trigger | Sections |
|---|---|---|---|
| v1 | 2026-04-24 | Phase 20-A close + cross-phase composition smoke; all 16 A-tier modules shipped | all |
| v2 | 2026-05-09 | Phase 2.76 close — Beta Playground established + release-band schedule revised (v0.0.1 → v3 ~5-6 months) | header (release-band table); §1 (Lab parallel track callout); §4 (Lab critical-path additions); §6 (going-public checklist now gates v3 not v1; security hardening section added) |

This document should be revised when:
- A B-subphase ships (move it from "missing" to a "shipped" log; update sequencing)
- A Lab profile graduates to stable (fold its phase row into "shipped"; cite Phase Decision)
- A new blocker emerges (add to cohort table)
- Pricing changes (revise cost estimates)
- The v3 cutover criteria change (revise §6 checklist)
- A new external dep is adopted (add row to relevant cohort)
- Release-band schedule is renegotiated (update header table; bump to next rev)
