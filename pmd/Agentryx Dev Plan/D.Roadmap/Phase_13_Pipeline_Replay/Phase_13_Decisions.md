# Phase 13 — Decisions Log

## D131 — Replay is a separate library; graph files unchanged

**What**: `cognitive-engine/replay/` is a parallel module. Graph files (`pre_dev_graph.js`, `dev_graph.js`, etc.) are not modified.

**Why**:
- **Same scaffolding discipline** as Phases 5-A through 12-A. Library substrate alongside production code; wiring deferred.
- **Replay is read-mostly**: collector + planner are pure-functional over recorded artifacts. Executor writes new artifacts but uses Phase 6-A's existing `writeArtifact()` — no graph code involved.
- **Unblocks Phase 15** (Self-Improvement Loop) without coupling to graph internals. Phase 15 will replay proposed graph changes against past runs to evaluate; that evaluation happens through this library, not by grafting into existing graphs.

## D132 — New run_id format = `<source>.replay.<N>`

**What**: A replay of `run-2026-04-23-abc` produces `run-2026-04-23-abc.replay.1`, `run-2026-04-23-abc.replay.2`, etc.

**Why**:
- **Lineage is in the run_id itself** — no separate join table needed to know "this is a replay of X."
- **Greppable**: `grep "replay" _artifacts/*/index.jsonl` enumerates all replay artifacts.
- **Sortable**: `replay.1`, `replay.2`, `replay.10` need natural-sort care, but `nextReplaySequence` parses ints and handles correctly.
- **Stable across runs**: deriving from source means two operators replaying the same source independently get distinct sequence numbers as long as `existingRunIds` is passed.

**Tradeoff**: replays of replays (`run-abc.replay.1.replay.1`) get awkward names. Acceptable; in practice you replay the original or its first replay, not nested chains.

## D133 — Stubs in 13-A; real LLM execution deferred to 13-B

**What**: `executor.js` invokes user-supplied `nodeStubs[agent]` functions. No default LLM stub.

**Why**:
- **No LLM cost in 13-A.** Smoke tests run free.
- **Stubs make the contract explicit.** `NodeStubInput`/`NodeStubOutput` types document what a node receives and produces. 13-B's default LLM stub is one implementation of this contract; users can register their own for testing.
- **Deterministic tests**: assertions can verify exact lineage and content.
- **Same pattern as Phase 9-A `fixRouter`** dependency injection — caller controls real-vs-stub via parameter, not flag.

**Consequence**: 13-A is unusable for real replays today (no recorded LLM agents to call). 13-B's default stub fixes that with a router-backed re-invocation.

## D134 — Frozen + substitution modes both supported in 13-A

**What**: `buildReplayPlan(snapshot, {replayFromArtifactId, substitutions})` — substitutions optional. Same engine handles both pure replay (frozen-only) and what-if (one or more substitutions).

**Why**:
- **Same dependency walk applies.** Substitution just changes which artifact a parent reference resolves to; the topology is identical.
- **Two modes from one code path** = less code to maintain, fewer surprises across mode boundaries.
- **What-if testing is the highest-value use case** — "what if Spock's spec were better?" answers a real question. Pure replay is mostly for debugging.
- **Substitution targets can come from any project / run** — executor falls back to `getArtifact()` when not in snapshot. (Caught a bug in initial implementation; fixed mid-test.)

## D135 — Replay artifacts written to the same `_artifacts/` store

**What**: Replays produce normal artifacts in the project's existing `_artifacts/` directory. They're tagged `["replay", "source:<run_id>"]` and have `meta.replays_artifact_id` back-pointers, but they're stored alongside originals.

**Why**:
- **Replays are first-class history**, not shadow data. Cost rollups (Phase 11-A), audit views, memory observations should all see them.
- **Tagging is sufficient discrimination.** `listArtifacts(projectDir, {kind: "code_output"})` returns originals + replays; consumers filter by tag if they need to.
- **Avoids two stores to maintain.** Phase 6-A artifact store is mature; building a parallel "replay store" doubles complexity.
- **Cross-replay analysis is easy.** Comparing original to replay is just: load original via `getArtifact(p, ART-0042)`, find descendants tagged `replay` with `meta.replays_artifact_id === ART-0042`.

**Tradeoff**: a workspace's artifact count grows with replays. Cost dashboards (Phase 11-A) should add a "show only original / show all" toggle in 11-B. Track in Phase 11-B's plan.

## D208 — 13-B splits into Tier B (read-only UI) + remainder (LLM stub + execute) (added 2026-05-09)

**What**: Phase 13-B as originally scoped bundled "default LLM stub + HTTP endpoint + React timeline UI + cross-pipeline replay." Closing 13-B Tier B = the read-only visualization (timeline + artifact inspector). The execute path (LLM stub re-invokes the original agent, substitution mode, cross-pipeline) stays deferred under 13-B-remainder.

**Why split**:
- The Tier B read-only surface adds debugging value WITHOUT credentials. Founder can see what each agent did in past runs as soon as artifacts exist.
- The execute path needs OpenRouter credit (LLM stub fires real LLM calls). Bundling it with the UI made the whole phase wait on credentials — meaningless when the substrate is already there.
- Same composition pattern as 12-B Tier B vs 12-B-full: ship the visible read first, layer the write behind credentials.
- Wired-but-empty discipline: Replay returns `[]` today because `USE_ARTIFACT_STORE` is OFF. Empty-state UI explains the next step (flip the flag → pipeline run → populates). When 6-B + OpenRouter land, the surface lights up automatically.

**Tradeoff**: founder might expect to "click Replay → see something" and get an empty list today. Mitigation: the empty-state banner explains exactly what's missing and how to get there.

## D221 — 13-B LLM-stub: re-produce, don't re-decide; dispatcher defaults to in-process stub (added 2026-05-11)

**What**: Phase 13-B ships `cognitive-engine/replay/llm-stub.js` as the default Phase 13-A `NodeStub` implementation for the `POST /api/factory-admin/replay/runs/:id/execute` endpoint. The stub takes the original artifact + resolved parents and asks the LLM to produce a fresh variant *of the same step*. Default dispatcher is an in-process stub (no LLM spend); founder opts into real Sonnet/Opus per-request via `body.dispatcher`.

**Why "re-produce, don't re-decide"**:
- Replay's purpose is to expose sampling variance + the effect of substitutions, not to give the LLM a chance to rethink the architecture. Letting the stub re-decide would make replay results inconsistent with their `parent_ids` lineage — the new artifact would no longer plausibly *be* what was produced at that step.
- Preserves D133's contract from 13-A — same kind, same role, fresh sample.
- Per-agent system prompts (`DEFAULT_AGENT_SYSTEM_PROMPTS`) reinforce this for each named agent (10 of them; unknown agents fall back to a generic "produce a fresh variant" prompt).

**Why default dispatcher is in-process stub**:
- Substrate ship must work at $0 with no credentials. `dispatcher: "stub"` produces a valid `ReplayResult` shape without touching the LLM router — useful for endpoint smoke tests, contract validation, and offline development.
- Real-LLM mode is per-request opt-in (`dispatcher: "sonnet"` or `"opus"`) — mirrors D209's pattern (architect dispatcher is per-cadence, not a global flag). Founder gets to decide whether each replay is worth spending on.
- Dispatcher failure falls open to stub: if `loadArchitect()` + `pickDispatcher()` throws (e.g. llm-router missing), the endpoint still returns a successful replay using the stub. Substrate availability must not depend on LLM infra health.

**Why per-agent system prompts (not a single generic prompt)**:
- Each agent role (Picard / Sisko / Spock / etc.) has a distinct "what does this output look like" contract. Generic prompts produce generic outputs; agent-specific prompts let the LLM stay in character even when replaying.
- `DEFAULT_AGENT_SYSTEM_PROMPTS` is exported so callers can override per-agent at instantiation — useful for test ergonomics and for project-specific tuning later.

**Why a separate module (not inline in executor)**:
- Phase 13-A `executor.js` deliberately took `nodeStubs` as a dep (D-implicit-DI) so different consumers can provide different stubs. The LLM stub is one consumer; the smoke-test stubs are another; future "Anthropic agent SDK" stub would be a third. Each lives in its own module.
- Easier to test in isolation: 39 assertions stub the `llmCall` function and exercise every branch of the prompt builder + return-shape contract.

**Tradeoff acknowledged**: the LLM stub doesn't load parent artifact *content* from disk — the executor's `resolveParent` returns artifact records without content. To get content into the prompt, the parents need their content pre-loaded (`_loaded_content` field). Full 13-B may add a content-loading helper that the executor calls before passing parents to the stub; today the stub gracefully handles missing content by saying "(content not loaded)" in the prompt.
