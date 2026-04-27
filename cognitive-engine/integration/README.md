# Cross-Phase Composition Smoke

**Not a phase, not a module — a cross-cutting regression net.** Validates that the 16 A-tier modules across Phases 5-A through 20-A compose end-to-end in a single workspace, with one customer journey, without conflicts.

## Status

**73 assertions pass.** $0 cost. No external API calls. Deterministic. Tmpdir-based; cleans up after itself.

## What this validates that per-module smokes don't

| Validation | Example |
|---|---|
| Data flow correctness across module boundaries | `customer_id` from Phase 19-A flows into Phase 20-A's metering/retention/compliance |
| Storage layout coexistence | Every module's `_*` dir lives in the same workspace without collisions |
| Decoupling preservation | Modules talk through declared interfaces (e.g., 17-A receives 16-A's `renderVoiceoverForPhase17` via injection, not direct import) |
| Lineage preservation | Phase 6-A artifact `parent_ids` survive through Phase 13-A snapshot views |
| Cross-store filter joins | Phase 20-A compliance walks 5 per-tenant stores by `customer_id` |
| Queue → handler payload shape | Phase 14-A job payload includes Phase 19-A submission_id verbatim |

Per-module smokes prove each module works in isolation. This smoke proves they compose.

## The story (16 stages)

```
1. Register customer (Phase 19-A)
2. Customer submits project (Phase 19-A)
3. Enqueue project_intake job → lease → handler → complete (Phase 14-A)
4. Platform transitions submission: submitted → accepted → in_progress (Phase 19-A)
5. Write artifacts during pre_dev with parent_ids lineage (Phase 6-A)
6. Cost-tracker rolls up by project_id (Phase 11-A)
7. Memory-layer records lessons + patterns (Phase 7-A)
8. Verify-integration builds bundle from artifacts + publishes (Phase 9-A)
9. Courier dispatches delivery_ready event with severity routing (Phase 10-A)
10. Training-gen produces all 6 kinds with storyboard parented to voiceover (Phase 16-A)
11. Training-videos renders the voiceover via stub providers (Phase 17-A)
12. Self-improvement extracts proposals from memory observations (Phase 15-A)
13. Marketplace catalogue installs all 15 built-ins (Phase 18-A)
14. Release metering captures usage tied to customer_id (Phase 20-A)
15. Compliance audit + backup snapshot + readiness aggregator (Phase 20-A)
16. Replay run snapshot reconstructs artifact lineage (Phase 13-A)
```

After the 16 stages, a final "cross-module data-flow assertions" section verifies:
- 19-A submission timeline spans the full lifecycle
- 20-A metering tenant_id matches 19-A account customer_id
- 17-A video.script_id references 16-A voiceover TART id
- 6-A artifact lineage preserved via 13-A snapshot view
- 18-A marketplace catalogues every Phase-17-A provider pack
- 20-A compliance finds tenant data across 5 stores
- 9-A verify bundle includes 6-A artifact review items
- 14-A queue fully drained; no orphaned jobs

## How to run

```bash
node cognitive-engine/integration/composition-smoke.js
```

Output is one workspace path + 16 grouped sections of `✓` assertions. Final line: `[smoke] OK — all 16 A-tier modules compose end-to-end`.

Failure mode: any assertion throws → script exits with code 1 + the failed assertion message + stack trace.

## When to run

- Before any phase PR merge that touches a shared boundary (artifact store layout, customer_id shape, queue payload format)
- After any refactor of a public interface in any A-tier module
- As CI regression check alongside per-module smokes
- After a bulk dependency upgrade that could affect filesystem semantics

## Why "integration" lives outside any phase

The 16 modules each ship their own smoke (per-module = unit-level coverage). Composition is a cross-cutting concern that doesn't belong to any one phase. Putting it in `cognitive-engine/integration/` (not in a `Phase_NN_*/` folder) signals it's a regression substrate, not phase work.

## Adding to the smoke when a new module ships

When a new module lands (B-tier or future R1+ phase):

1. Add an import block matching the module's public API
2. Add a numbered section to the story that exercises the module's primary entry point with the workspace's existing data (the customer, the submission, the artifacts already produced)
3. Add at least one cross-module data-flow assertion that proves the new module reads or produces data that another module also touches
4. Update the `[N/M]` step counter and the line "**73 assertions pass**" in this README
5. Re-run; verify all assertions green; commit
