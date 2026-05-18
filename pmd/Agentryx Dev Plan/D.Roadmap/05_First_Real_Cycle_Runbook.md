# First Real Cycle Runbook

**Purpose**: concrete steps to validate the v0.0.1 substrate end-to-end with a real LLM cycle. Six phases of substrate (5-B, 8-B, 13-B, 15-B, 21-B, 21-B.2) and three Tier-B handler registrations (14-B, 16-B, 17-B) are dormant until this cycle proves they work together. This document is **the founder action that unlocks v0.0.1 → R1**.

**Audience**: founder (you) or anyone with shell + browser access to the factory VM.
**Time budget**: 15-30 minutes elapsed, $1-10 in OpenRouter spend.
**Pre-state**: All branches at the [stacked-branch list](#stacked-branches-pending-review) merged to main. OpenRouter has ≥$5 balance ([dashboard](https://openrouter.ai/settings/credits)).

---

## 1. Pre-flight (5 min)

### 1.1 Confirm OpenRouter balance
- Open https://openrouter.ai/settings/credits
- Verify balance ≥ $5 AND auto top-up is enabled
- If lower, "Add Credits" → $10 minimum

### 1.2 Confirm factory services are up
```bash
sudo systemctl status factory-telemetry.service factory-dashboard.service
```
Both should be **active (running)**. If not:
```bash
sudo systemctl restart factory-telemetry.service factory-dashboard.service
sudo journalctl -u factory-telemetry.service -n 50 --no-pager
```
Look for these boot lines (added in 2026-05-10 ships):
- `📅 Architect cadence daemon started`
- `📥 Queue worker started — kinds: pre_dev, dev, post_dev[, training_gen, training_video_render, architect_research]`

### 1.3 Open Dev-Hub
- Navigate to https://dev-hub.agentryx.dev/ (or local equivalent)
- Confirm the 8 Admin · Configuration sub-tabs render (Flags / Configs / Modules / Queue / Cost / Verify / Courier / Audit)

---

## 2. Flip the substrate flags (2 min)

In **Admin · Configuration → 🚦 Flags**, toggle ON:

| Flag | Why |
|---|---|
| `USE_ARTIFACT_STORE` | **Most important.** RouterChatModel chokepoint (Phase 6-B) writes every LLM response to the artifact store. Everything downstream (7-E sync, 13-B replay, 15-B comparators) needs this. |
| `USE_MEMORY_LAYER` | Phase 7-A memory observations + 7-E sync populates lessons + patterns |
| `USE_VERIFY_INTEGRATION` | Phase 9 bundle publish + webhook receive path goes live (mock client OK; real Verify-stg comes later) |

**Leave OFF for first cycle** (each has a follow-on cycle):
- `USE_MCP_TOOLS` — flip after first cycle confirms artifact-store works; second cycle proves MCP filesystem ops work
- `USE_PARALLEL_DEV_GRAPH` — flip after second cycle; third cycle proves data's qa-free review quality
- `USE_ARCHITECT_QUEUE` — flip after observing the inline cadence path works once via queue

The flag overrides persist to `_factory_runtime/flag_overrides.json` and survive telemetry restart.

---

## 3. Configure cadence dispatcher (1 min)

In **Dev-Hub → Master Architect → Standing Orders & Roadmap**:

- Click the **Monthly** cadence card
- Change dispatcher from `stub` to **`sonnet`** (Sonnet 4.6, ~$0.30-0.40 per pass at standard depth)
- Set budget cap to `1.5` USD
- Click **Save**

Optionally do the same for Weekly (`sonnet`, $0.50 cap) — Daily can stay on `stub` for the first run; you'll see daily fires every 24h and don't want $3-5 every day before you've validated quality.

---

## 4. First validation cycle — pick ONE option

### Option A: Trigger the Monthly cadence manually (recommended — fastest signal)

In **Master Architect → Standing Orders & Roadmap**:
- Click the **"Run cycle now"** button on the Monthly cadence card

Watch for (in **Master Architect → Reports & Proposals** + Live Trace sidebar):
- `📅 Cadence fired: monthly` Live Trace line
- A new entry under "Reports" within 30-90 seconds (Sonnet research takes that long)
- A new entry under "Proposals" if the architect identified anything actionable

If nothing appears within 2 minutes, check `journalctl -u factory-telemetry.service -n 100` for errors.

**Cost**: ~$0.30-0.40 (single monthly pass at standard depth).

### Option B: Submit a real Pre-Dev job to the queue

In **Admin · Configuration → 📊 Queue → 📥 Submit a job**:
- Kind: `pre_dev`
- project_id: `2026-05-11_runbook_test`
- payload: `{"task": "build a simple note-taking REST API with JWT auth + 3 tests"}`
- Click **Submit**

Watch:
- Queue panel shows the job transition `queued → in-flight → done`
- Live Trace shows `[queue:pre_dev:JOB-XXXX]` lines as Picard / Sisko / Troi run
- Project dir created at `~/Projects/agent-workspace/2026-05-11_runbook_test/`

**Cost**: ~$2-5 (full intake pipeline through three architect-tier agents).

---

## 5. Verify each substrate is live (10 min)

### 5.1 Artifact store is being written (Phase 6-B)
```bash
ls ~/Projects/agent-workspace/*/​_artifacts/index.jsonl | head
wc -l ~/Projects/agent-workspace/2026-05-11_runbook_test/_artifacts/index.jsonl 2>/dev/null
```
Should show >0 lines after option A or option B. Each line is one artifact (one LLM response).

### 5.2 Memory layer has observations (Phase 7-A + 7-E)
**Dev-Hub → Memory Layer**:
- Total observations count > 0
- Click **"🔄 Sync from artifacts"** button
- Expect ≥1 new lesson + ≥1 new pattern observation added

### 5.3 Replay UI shows the run (Phase 13-B Tier B)
**Dev-Hub → Replay**:
- The new run_id appears in the sidebar list
- Click it; timeline shows the artifacts in chronological order, color-coded by agent

### 5.4 Architect report is readable (Phase 21-B real dispatcher)
**Master Architect → Reports & Proposals**:
- Click the new monthly cycle report
- Read the "Findings by priority area" section — confirm content is **substantive** (not the "(stub dispatcher — synthetic findings)" marker)
- If you see the stub marker, the cadence config didn't pick up `sonnet` — go back to step 3

### 5.5 Cost-tracker captured the spend (Phase 11-A + 11-B Tier B)
**Admin · Configuration → 💰 Cost**:
- Today's spend > 0
- "By agent" should show troi / picard / sisko (intake) or the architect role (cadence)
- "By model" should show `openrouter:anthropic/claude-sonnet-4.6` or similar

### 5.6 Queue showed the architect work (Phase 21-B.2 — only if `USE_ARCHITECT_QUEUE` flipped)
*Skip if you haven't flipped this flag yet.* **Admin · Configuration → 📊 Queue**:
- A historical `architect_research` job (status `done`) appears in the in-flight or completed list

---

## 6. Second cycle — flip more flags

Once steps 1-5 pass cleanly, repeat steps 4-5 with these new flags ON:

| Flag | What this cycle validates |
|---|---|
| `USE_MCP_TOOLS` | Phase 5-B graph rewire: filesystem ops now go through `npx -y @modelcontextprotocol/server-filesystem` subprocess. Confirm via `ps -ef \| grep mcp` during cycle. |

A second `pre_dev` submission with the same payload is fine — different project_id (e.g. append `_mcp`).

## 7. Third cycle — parallel dev_graph

Flip `USE_PARALLEL_DEV_GRAPH=true`. Submit a `dev` job (needs a project that already has a Phase 1 spec — use the project from step 4 if it advanced, or run a fresh `pre_dev` first).

Watch:
- Tuvok and Data both fire in Live Trace within a few seconds of each other (not sequentially)
- Wall-clock for the dev cycle should be roughly the **max(tuvok, data) time, not their sum** — a real speedup of 5-15 seconds vs sequential
- Data's `architectReview` shouldn't reference test results (it doesn't see qaReport under parallel mode)

If quality of data's review looks materially weaker, flip back to OFF and file a finding for the next architect cycle.

## 8. Architect queue mode

Flip `USE_ARCHITECT_QUEUE=true`. Wait for the next cadence tick OR click "Run cycle now" again.

Watch:
- Live Trace: `📅 Architect cadence weekly enqueued as JOB-NNNN (queue mode)` (instead of "running inline")
- Admin → Queue panel shows the `architect_research` job in-flight
- Report appears in Master Architect → Reports section after the job completes

The crash-resilience claim (kill telemetry mid-cycle → re-leased on restart) is harder to test casually — defer that to a deliberate test.

## 9. If anything in steps 5-8 fails

1. **Read the Live Trace** in Dev-Hub (sidebar). Most failures emit a `⚠️` line with the cause.
2. **Tail the telemetry log**:
   ```bash
   sudo journalctl -u factory-telemetry.service -n 200 --no-pager | tail -50
   ```
3. **Check the cost-thresholds gate** (Phase 14-B per-project quota): if you see `🚫 Queue: refused` lines, you've hit the `project:_example` cap or a global cap. Edit `configs/cost-thresholds.json` to raise.
4. **Restart cleanly**:
   ```bash
   sudo systemctl restart factory-telemetry.service factory-dashboard.service
   ```

If a flag is the cause, flip it back to OFF in Admin → Flags and file a finding for the architect.

---

## Expected total spend

| Cycle | What | Cost |
|---|---|---|
| Cycle 1 (Monthly cadence with sonnet) | First architect report with real LLM | $0.30-0.40 |
| Cycle 2 (pre_dev submission) | Full intake pipeline (Picard + Sisko + Troi) | $2-5 |
| Cycle 3 (pre_dev with MCP) | Same workload, MCP backend validates | $2-5 |
| Cycle 4 (dev with parallel) | Tuvok + Data in parallel; speedup measurement | $3-8 |
| Cycle 5 (architect via queue) | Same architect cost; just different invocation path | $0.30-0.40 |
| **Total** | **Validation of 9 substrate phases** | **~$8-19** |

Within the `$20/day global` hard-cap threshold (D212) by design. Auto top-up at <$2 means OpenRouter handles refills.

---

## Stacked branches pending review

These are the local branches with shipped work; review and merge in any order. Stacked-on-stacked branches will need rebase after their parent merges — I'll rebase on request.

```
main
 ├─ PR #42 phase/21-a-master-architect       (20 commits — 21-A + 21-B + visible-factory sprint)
 │   ├─ phase/14-b-queue-handlers            (3 commits — Tier B handlers + quotas)
 │   │   ├─ phase/9-b-verify-webhook         (2 commits — webhook + HMAC)
 │   │   │   └─ phase/5-b-mcp-rewire         (1 commit — tool-selector + graphs)
 │   │   ├─ phase/21-b-2-architect-queue     (1 commit — cadence → queue)
 │   │   ├─ phase/16-b-training-gen-handler  (1 commit — training_gen handler)
 │   │   └─ phase/17-b-video-render-handler  (1 commit — training_video_render handler)
 │   └─ phase/13-b-llm-replay                (1 commit — LLM stub + execute endpoint)
 ├─ PR #43 phase/agent-soul-backfill         (1 commit — 10 SOULs + roster)
 ├─ PR #44 phase/hermes-2026-05-11-reeval    (1 commit — Hermes re-eval + 7-E Honcho note)
 └─ phase/8-b-parallel-dev-graph             (1 commit — parallel dev_graph topology)
```

**Suggested merge order** (minimises rebase friction):
1. PR #43 (SOUL backfill — off main, no rebase needed)
2. PR #44 (Hermes re-eval — off main, no rebase needed)
3. PR #42 (Phase 21 — biggest single ship)
4. After #42 merges → push + rebase the 7 stacked branches against main, then merge them in dependency order (14-B → 9-B → 5-B; 14-B → 21-B.2 / 16-B / 17-B; 13-B; 8-B)

If you want a different order, say so and I'll re-plan the rebases.

---

## When this runbook needs updating

This document is **live** — when any of the following happens, update it:
- A new flag becomes meaningful for the first cycle (add to step 2 table)
- A new substrate phase ships that the cycle should validate (add to step 5)
- The cost numbers drift materially (update step "Expected total spend")
- Verify-stg real http client lands (add a step 9 for the real review path)
- Phase 19-B customer portal lands (add a step for customer submission flow)
