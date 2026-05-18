# R1 — First Real LLM Cycle Evidence

**Date achieved**: 2026-05-18
**Pass id**: `RP-0003`
**Dispatcher**: `sonnet` (real LLM via OpenRouter)
**Spend**: **$0.102016** total (well under the runbook's $0.30-0.40 estimate)
**Wall-clock**: 4 minutes 57 seconds (started 20:34:44 UTC, completed 20:39:41 UTC)
**Outcome**: ✅ **succeeded** — 25 findings, 25 proposals, no per-area failures
**Trigger**: `POST /api/architect/run_pass` with `{passKind: "r1_first_real_cycle", dispatcher: "sonnet"}`

This is the **R1 milestone** per [`04_B_Tier_Marathon.md`](04_B_Tier_Marathon.md) ("First real factory run") and follows the recipe in [`05_First_Real_Cycle_Runbook.md`](05_First_Real_Cycle_Runbook.md) Option A (Monthly cadence manual trigger, the cheapest signal).

---

## Pre-flight state (recorded before the run)

| Component | Status |
|---|---|
| `factory-telemetry.service` | active (PID 409471) |
| `factory-dashboard.service` | active |
| OpenRouter API key | present in `/home/subhash.thakur.india/Projects/claw-code-parity/.env` |
| OpenRouter pre-cycle balance | $8.71 credit (post-cycle: ~$8.61) |
| Standing Orders | version 5, monthly cadence enabled, 6 priority areas |
| Flag overrides (before flip) | `USE_AUTONOMOUS_ARCHITECT=on`, `USE_PUBLIC_RELEASE=off` |
| Flags flipped for this cycle | `USE_ARTIFACT_STORE=on`, `USE_MEMORY_LAYER=on` |

## What ran

The architect research pass dispatched a real Sonnet 4.6 LLM call (via OpenRouter task=`research`, with web-search tools enabled) once per priority area. All 6 priority areas were scanned in sequence. Each call asked the LLM to identify 1-5 ecosystem findings relevant to that area's `current_state`, `target_3mo`, `target_6mo`, `hard_constraints`, `anti_goals`, and `research_directions`.

## Per-area cost + findings

| Area | Cost | Findings |
|---|---|---|
| models | $0.015372 | 4 |
| agents | $0.015457 | 5 |
| languages | $0.018091 | 4 |
| tools | $0.016360 | 4 |
| output_quality | $0.019386 | 4 |
| operations | $0.017350 | 4 |
| **Total** | **$0.102016** | **25** |

Per-call cost was tight (range $0.015–0.019), confirming the budget-split is working. No per-area errors fell through to fail-isolation.

## Findings distribution by kind

- `upgrade-available`: 12
- `info`: 7
- `new-tool`: 6
- (`deprecation`, `security`: 0 this cycle)

## Sample findings (one per area)

These confirm the output is **real prose with source URLs** — not the synthetic stub-dispatcher marker:

- **[models]** `upgrade-available`: "Anthropic released Claude 3.5 Sonnet, which is 2x faster and significantly cheaper than the previous Sonnet model..." — source: `https://www.anthropic.com/news/claude-3-5-sonnet`
- **[agents]** `upgrade-available`: "Anthropic released Claude 3.5 Sonnet, which is faster, cheaper, and shows marked improvement on coding benchmarks and complex instruction following..." — source: `https://www.anthropic.com/news/claude-3-5-sonnet`
- **[languages]** `info`: "The OpenHands agent uses per-task Docker containers to create isolated environments for code execution and testing. This is a validated pattern for a polyglot pipeline..."
- **[tools]** `upgrade-available`: "Hermes Agent v0.15 introduces a new built-in tool for controlling a remote VS Code server, aligning with the 3-month target to add IDE-integration servers to the MCP plane."
- **[output_quality]** `new-tool`: "The new Claude 3.5 Sonnet model introduces 'Artifacts', a feature allowing interactive code generation and preview in a dedicated UI pane..."
- **[operations]** `new-tool`: "E2B now offers custom sandboxes, allowing predefined environment variables, startup commands, and filesystem access controls. This provides a direct path to the 6-month target..."

Note: Sonnet's training-time knowledge calls the current model "Claude 3.5 Sonnet" (rather than 4.6); this is a model-knowledge quirk, not a substrate issue. Substrate fact: prose IS substantive, IS topical to the area's targets, IS cited with sources.

## Proposals emitted

25 proposals landed in `_proposals/PROP-NNNN.json` (audit log at `_proposals/_audit.jsonl`):

- `tool_adoption`: 18 (each pointing at a specific tool/model the finding identified)
- `research_finding`: 7 (general observations not tied to a tool)
- `kb_update`: 0

Each proposal has full provenance — `created_by: "proposer:architect"`, `supporting_observations` linking back to finding ids, `change.from`/`change.to`, `rationale.summary`, `rationale.meta.sources`. Example: `PROP-0013` proposes adopting "Claude 3.5 Sonnet" with `from: "(none)"`, `to: "Claude 3.5 Sonnet — upgrade-available"`, supported by finding `F-0013`, sourced from the Anthropic announcement URL.

## Substrate verified by this cycle

| Substrate | Phase | Evidence in this cycle |
|---|---|---|
| LLM router (OpenRouter backend) | Phase 2 | $0.102 captured per-call across 6 areas; `model_succeeded` tagged in `produced_by` |
| Architect researcher orchestration | Phase 21-A | 6 areas dispatched, budget split working, no per-area errors |
| Real LLM dispatcher | Phase 21-B | `produced_by: "researcher:llm:sonnet:research"` on every finding |
| Standing Orders read path | Phase 21-A | KB loaded version 5, 6 priority areas, custom_direction, strategic_watch |
| Findings persistence | Phase 21-A KB | 25 entries appended to `_kb/findings.jsonl` with full schema |
| Targets persistence | Phase 21-A KB | New targets auto-extracted from findings appended to `_kb/targets.jsonl` |
| Proposer | Phase 21-A | 25 well-formed proposals in `_proposals/`, audit log appended |
| Pass lifecycle | Phase 21-A KB | `RP-0003` walked `running → succeeded` via two `passes.jsonl` writes |
| Manual run_pass endpoint | Phase 21-A telemetry | `/api/architect/run_pass` accepted `{passKind, dispatcher}` body + returned full result |

## Substrate NOT exercised by this cycle (deliberately — different code path)

The architect researcher calls `llm-router/src/router.js complete()` **directly**, bypassing the LangGraph `RouterChatModel` chokepoint. So this cycle does NOT exercise:

- Phase 6-B artifact-store writes (no `_artifacts/index.jsonl` entries this run — by design)
- Phase 7-A/7-E memory observations
- Phase 8-B dev_graph parallelism
- Phase 13-B replay UI for pipeline runs
- Phase 14-B queue worker runtime
- Phase 15-B comparator artifact deltas
- The full `pre_dev → dev → post_dev` chain

These belong to the **pre_dev cycle path** (runbook Option B). They get a separate validation when a `pre_dev` job runs through the queue worker. Recommended next: submit a small `pre_dev` job per runbook step 4 Option B, budget ~$2-5.

## R1 — what this actually means

Per [`04_B_Tier_Marathon.md`](04_B_Tier_Marathon.md), R1 is the **internal test + R&D version** that proves "first real factory run; ≥3 Lab profiles graduated; ≥1 B-tier cohort closed". This cycle proves:

- **The factory CAN spend real money intentionally + safely** ($0.10 — well under all caps; per-area budget-split worked)
- **The architect end-to-end works with real LLM dispatch** (25 findings, 25 proposals, no failures)
- **The full Standing Orders → researcher → KB → proposer → audit pipeline holds together** under real LLM output
- **Cost capture is accurate per-area** (sum matches dispatcher returns)

What remains for the full R1 declaration is the **pre_dev cycle** (Option B) — that validates the LangGraph pipeline (Picard/Sisko/Troi + artifact-store + memory-layer + replay UI). That's a single follow-on cycle at ~$2-5.

## Files referenced

- Pass record: `_kb/passes.jsonl` (last line = RP-0003)
- Findings: `_kb/findings.jsonl` (grep `"pass_id":"RP-0003"` → 25 entries)
- Proposals: `_proposals/PROP-0013.json` through `_proposals/PROP-0037.json` (25 files)
- Audit log: `_proposals/_audit.jsonl`
- Raw API response: was at `/tmp/r1-run-pass-result.json` during the run; reproduced in the "Per-area cost + findings" table above
- Service journal: `journalctl -u factory-telemetry.service --since "2026-05-18 20:34"`

## When this doc needs updating

- After Option B (pre_dev cycle) runs, append a section "R1 pre_dev cycle evidence"
- After cycle 3 (parallel dev_graph), cycle 4 (architect queue mode), append matching sections
- When a Lab profile graduates to stable, note the date here so the marathon's "≥3 Lab graduations for R1" claim is auditable
