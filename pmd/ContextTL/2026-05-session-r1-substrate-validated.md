# Session handoff — R1 substrate validated + 19-B notification taxonomy closed + UI catch-up

**Session date**: 2026-05-18 → 2026-05-24
**Closing snapshot version**: v1.0.0 (R1) + v1.1.0 (R1+) in progress
**Where the next session should start**: read this, then `_roadmap/` tab in Dev-Hub, then pick from "next moves" below.

---

## What this session accomplished

**12 PRs merged to main** (#76 → #88), grouped by track:

### Track 1 — Phase 19-B customer-portal completion (D227 → D233)
- **D227** back-feed wrapper (`pre_dev → delivered` transition) — PR #70 · tag `phase-19-b-backfeed-wrapper`
- **D228** SLA breach scanner daemon — PR #71 · tag `phase-19-b-sla-scanner`
- **D229** hotfix — scanner injects customer_id (caught by live test) — PR #72
- **D230** portal notifier + SLA-scanner Courier wiring — PR #73 · tag `phase-19-b-portal-notifier-scanner`
- **D231** notifier HTTP /submit + /cancel wirings (+ bonus customer-flow E2E on real LLM) — PR #76 · tag `phase-19-b-notifier-d231-submit-cancel`
- **D232 + D233** notifier intake/back-feed/admin reject + UI Reject button — PR #86 · tag `phase-19-b-notifier-complete`
  - All 6 customer.* notification sources now wired end-to-end

### Track 2 — R1 substrate validation (real LLM cycles)
- **Cycle 1 (architect)** — `RP-0003`, sonnet dispatcher, $0.102, 25 findings + 25 proposals — PR #74 · tag `r1-first-real-cycle`
- **Cycle 2 (pre_dev)** — `JOB-0005`, $1.664, 7 artifacts (Opus + Haiku via OpenRouter) — PR #75 · tag `r1-complete`
- **Bonus customer-flow E2E** — `JOB-0007`, $1.591, full HTTP /submit → delivered chain on real LLM (caught by D231 verify)
- **Cycle 3 (dev parallel)** — `JOB-0008`, $1.434, 9 artifacts, **all 3 model tiers in one cycle** (Haiku + Sonnet + Opus), **Phase 8-B parallel proven** (Tuvok ∥ Data 1.9s apart after 38s Torres) — PR #87 · tag `r1-cycle-3-dev`
- **Total R1 spend**: $4.79 · **OpenRouter remaining**: ~$3.92
- **R1 substrate fully validated** across 4 code paths (architect / pre_dev / customer-flow / dev parallel)

### Track 3 — UI catch-up (founder feedback: "2 weeks of substrate, UI unchanged")
- **UI-A** Cost Panel rollup bug fix (workspace_root → workspaceRoot) — PR #77
- **UI-B** Sidebar IA reorg into 4 grouped sections + Run Pass dispatcher dropdown + 2 placeholder tabs — PR #78
- **UI-C** Customer Portal tab content + 3 admin endpoints — PR #79
- **UI-D** Notifications panel + Courier history endpoint — PR #80
- **UI-E** Services Health tab (18 services) + 4 embedded tool consoles + IA cleanup — PR #81
- **UI-F** Drop broken iframes (Paperclip/Langfuse/LiteLLM); keep n8n + add /litellm/ nginx proxy — PR #83
- **UI-G** Real basePath fixes for Paperclip + LiteLLM; drop Langfuse — PR #84
- **UI-H** Hermes Agent dashboard embedded via nginx sub_filter — PR #85
- **UI-I** Architecture & Roadmap dashboard — dev plan alive + active — PR #88

### Track 4 — Memory + handoff context
- Saved 5 new cross-session feedback memories this session:
  - `feedback_factory_r1_autonomy.md` (autonomy expansion authorization)
  - `feedback_dont_fabricate_external_state.md` (don't invent budget/cred claims)
  - `feedback_http_submit_is_not_free_test.md` (HTTP /submit costs real LLM money)
  - `feedback_ui_must_track_backend.md` (every substrate ship includes UI touch)
  - `project_factory_release_trajectory.md` (R1→R5 vision)

---

## Where we are right now

**Release state**: R1 substrate validated · R1+ hardening 20% done (2/10 tasks)

**Live dashboard**: https://dev-hub.agentryx.dev/ — sidebar has 5 grouped sections + Architecture & Roadmap at the top (new this session).

**Live data** (from `_roadmap/`):
- 26 phases · 79 tasks · 7 bands (v0.0.1 → R5)
- v0.0.1 100% · R1 100% · R1+ 20% · R2/R3/R4/R5 = 0%

**Services running** (per Dev-Hub → Ops → Services Health):
- All 12 own + infra services UP
- Hermes Agent container running (Phase 2.75 Lab evaluation); dashboard at `/hermes/`
- Honcho NOT deployed (Lab profile, founder bias toward direct-adopt at 7-E)
- ChromaDB running but UNUSED (decision pending: commit or retire)

**Notification taxonomy COMPLETE**: 6 customer.* event types fire end-to-end. Currently all route to fake-backend stdout (founder visible in Notifications panel). Per-customer prefs is 19-C scope.

---

## Open decisions / awaiting founder input

1. **ChromaDB**: been running unused 4 weeks. **Commit to using it as embedding store** behind future memory work, OR **retire the container**. Don't keep running it dark.
2. **Honcho adoption** (T-0023 area): founder bias toward direct-adopt when 7-E opens. Last research session (this session, end) recommended deferring to R2 gate after Obsidian projector slice ships.
3. **Memory pattern**: agent research recommended **Obsidian projector slice** (R1+) over OMI/Hermes-provider-switch. Founder hasn't decided yes/no yet.
4. **Hermes integration into pipeline** (T-0023): conditional on T-0022 (founder hands-on use of Hermes dashboard → adopt/pattern-steal decision).

---

## Top candidate next moves (from `_roadmap/` R1+ + R2 tasks)

Ranked by leverage:

| Task ID | What | Band | Estimated effort |
|---|---|---|---|
| **T-0072 + obsidian-projector** | Auto-trigger 7-E sync on cycle close + Obsidian vault projection of lessons/patterns | R1+ | 2-3 hrs code, $0 LLM |
| **T-0200** | 19-C per-customer notification prefs (account.notification_prefs schema + notifier reads it) | R2 | 1 day, $0 LLM |
| **T-0201** | React customer dashboard (sign-up + submission form + status page) | R2 | 3-5 days React work |
| **T-0240** | Fix dev_graph project naming bug (sanitize `state.userRequest` before setProjectDir) | R1+ | 1 hr |
| **T-0241** | Fix Cost Panel rollup for dev_graph runs (project_id field on artifacts) | R1+ | 2-3 hrs |
| **T-0162** | Generate first real training script via Phase 16-B (validate substrate end-to-end) | R1+ | $2-5 LLM |
| **T-0223** | Flip USE_ARCHITECT_QUEUE=true + Cycle 4 of runbook (queue-mode architect) | R2 | 30 min + cycle |
| **T-0052** | Flip USE_MCP_TOOLS=true + Cycle 5 of runbook (MCP subprocess validation) | R2 | 1 hr + cycle |

---

## Critical "watch-outs" for next session

- **HTTP /api/customer-portal/submit is NOT a free test path** — auto-enqueues real pre_dev (~$1.50-$2 LLM spend). Use standalone integration scripts in tmpdir for wiring verifies. (Saved as memory.)
- **dev_graph uses raw `state.userRequest` as project dir name** — task text with `/` creates nested filesystem paths. Caught in Cycle 3 (JOB-0008). T-0240 fixes it. Until then, project_id at submit ≠ on-disk dir name → Cost Panel rollup misses these runs.
- **Architect researcher bypasses Phase 6-B chokepoint** — its $0.10 RP-0003 spend isn't captured in cost-tracker. T-0114 fixes it. Until then, Cost Panel under-reports architect cycles.
- **Cost-tracker `_history.jsonl` audit log autotouch**: the roadmap mutations from this session show in `_roadmap/_history.jsonl`; future session can read it for context.

---

## Pointers for next session

- **Read first**: `MEMORY.md` (11 entries; auto-loaded)
- **Then**: open Dev-Hub → 🗺️ Roadmap · Phases · Tasks tab (consolidated state)
- **For decisions**: `pmd/Agentryx Dev Plan/D.Roadmap/06_R1_First_Real_Cycle_Evidence.md` (what R1 actually proved)
- **For specific phase deep-dive**: `pmd/Agentryx Dev Plan/D.Roadmap/Phase_NN_*/Phase_NN_Status.md`
- **For research the last session did but didn't ship**: the Hermes+OMI+Obsidian agent report at end of this session's transcript (delegated agent run, recommended Obsidian projector slice over adopting OMI)

---

## What's NOT captured anywhere durable

- The architectural choices about each PR (those live in the PR descriptions on GitHub)
- The Hermes+OMI+Obsidian research conclusion (only in this session's transcript + this handoff doc)
- Conversation tone / what the founder is most excited vs frustrated about

This document is the bridge — fills the gap between structured artifacts (memory + roadmap + per-phase docs) and the conversational narrative that gets lost when the chat session ends.
