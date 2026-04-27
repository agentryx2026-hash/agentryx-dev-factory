# B-Tier Marathon — Path from v0.0.1 to R1

**Snapshot date**: 2026-04-24 (immediately after Phase 20-A close + cross-phase composition smoke)
**Purpose**: the *forward-looking* document. v0.0.1 A-tier substrate is complete; this maps the work between today and R1 cutover.

This is a living doc. Update it after every B-subphase ships.

Read this **after** [02_Current_Architecture.md](02_Current_Architecture.md) (where we are) and [Master_Factory_Architect.md](../Master_Factory_Architect.md) (where we're going). This file is the bridge.

---

## 1. The shape of the marathon

A-tier shipped 16 modules; **17 deferred B-subphases** are what stand between v0.0.1 and R1. They cluster into 4 cohorts by blocker:

| Cohort | Phases | Blocker | Unlock unit | Cost to unlock |
|---|---|---|---|---|
| **C1** | 5-B, 6-B, 7-E, 8-B, 15-B, 16-B, 17-B | OpenRouter credit + TTS credentials | 1 budget top-up + 1 ElevenLabs key | ~$15-40 LLM/TTS validation |
| **C2** | 9-B, 10-B, 11-B, 12-B, 13-B, 14-B, 18-B, 19-B | UI sprint + ops credentials (Slack/GitHub/SMTP) | React dev sprint + per-channel creds | 2-3 dev-weeks |
| **C3** | 7-B, 7-C, 7-D | Scale-dependent (memory backends) | Trigger: 100+ observations / multi-host / semantic-search demand | $0 until demand shows up |
| **C4** | 20-B | Stripe + S3/R2 + external pen-test | Stripe acct + cloud bucket + security budget | ~$5-15K (pen test) + ongoing infra |

Each cohort unlocks independently. Order is a strategy choice, not a technical dependency (with one exception: 14-B handler registration is a soft prereq for 16-B and 17-B, both of which run async via the queue).

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
1. OpenRouter top-up        →  6-B (1 session, ~$3)
2. Then 14-B               →  (1 session)
3. Then 16-B + 17-B        →  (~3 sessions, needs ElevenLabs key)
4. Then 7-E + 8-B + 15-B   →  (~3 sessions)
5. UI sprint               →  C2
6. Stripe + ceremony       →  20-B
```
**Time to first real factory run**: 1 session after credit top-up.
**Time to R1**: ~10-12 weeks elapsed.

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

## 6. Going-public checklist (gate to v1.0)

Before flipping the public-release flag, every box below must be checked:

- [ ] All 17 B-subphases shipped (or explicitly decided to defer past v1.0)
- [ ] Composition smoke (`integration/composition-smoke.js`) passes
- [ ] Per-module smokes all pass (16 modules × respective assertion counts)
- [ ] At least 3 real customer projects run end-to-end (pre_dev → dev → post_dev → delivered)
- [ ] Cost dashboard shows real spend per tenant
- [ ] Verify portal handled at least one round-trip feedback cycle on a real bundle
- [ ] Backup + restore tested (snapshot → drop workspace → restore from manifest → integration smoke passes again)
- [ ] Pen test report received + Sev-1/Sev-2 findings closed
- [ ] CHANGELOG.md generated; migration guide reviewed
- [ ] Marketing site live with link to public sign-up
- [ ] Stripe sandbox green-light + production webhook configured
- [ ] On-call rotation calendar published
- [ ] Public announcement post drafted + reviewed by founder

When all 12 boxes are checked: cut `v1.0.0` tag, post the announcement, watch the cost panel.

---

## 7. Document revision log

| Rev | Date | Trigger | Sections |
|---|---|---|---|
| v1 | 2026-04-24 | Phase 20-A close + cross-phase composition smoke; all 16 A-tier modules shipped | all |

This document should be revised when:
- A B-subphase ships (move it from "missing" to a "shipped" log; update sequencing)
- A new blocker emerges (add to cohort table)
- Pricing changes (revise cost estimates)
- The R1 cutover criteria change (revise §6 checklist)
- A new external dep is adopted (add row to relevant cohort)
