import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createProposalStore } from "./store.js";
import { createHeuristicProposer, runProposerIntoStore, DEFAULT_RULES } from "./proposer.js";
import { evaluateProposal, aggregateDeltas, evaluateAndStore } from "./evaluator.js";
import { applyProposal, applyAndStore, parseTarget } from "./applier.js";
import {
  SCHEMA_VERSION, PROPOSAL_KINDS, PROPOSAL_STATES,
  canTransition, isValidKind, isValidState,
} from "./types.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

async function setupTmpRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "self-improvement-"));
}

// ---------------------------------------------------------------------------
// Fake memory-layer service — implements just the recall() contract that the
// heuristic proposer reads. Smoke test seeds it with a fixed observation list.
// ---------------------------------------------------------------------------
function createFakeMemory(observations) {
  return {
    async recall(filter = {}) {
      let out = observations;
      if (filter.scope) {
        out = out.filter(o =>
          filter.scope.endsWith(":")
            ? o.scope.startsWith(filter.scope)
            : o.scope === filter.scope
        );
      }
      if (filter.kind) out = out.filter(o => o.kind === filter.kind);
      if (filter.tags?.length) {
        out = out.filter(o => filter.tags.every(t => (o.tags || []).includes(t)));
      }
      return (filter.limit ? out.slice(0, filter.limit) : out);
    },
  };
}

// ---------------------------------------------------------------------------
// Fake configIO — implements Phase 12-A readConfig/writeConfig contract over
// an in-memory object. Smoke test seeds with a couple of known configs.
// ---------------------------------------------------------------------------
function createFakeConfigIO(seed) {
  const store = JSON.parse(JSON.stringify(seed));
  const entries = Object.fromEntries(
    Object.keys(seed).map(id => [id, { id, path: `/virtual/${id}.json` }])
  );
  return {
    async readConfig(id) {
      if (!store[id]) throw new Error(`unknown config id: ${id}`);
      return { entry: entries[id], value: JSON.parse(JSON.stringify(store[id])) };
    },
    async writeConfig(id, value) {
      if (!store[id]) throw new Error(`unknown config id: ${id}`);
      store[id] = JSON.parse(JSON.stringify(value));
      const bytes = Buffer.byteLength(JSON.stringify(value), "utf-8");
      return { ok: true, bytes, sha256: "stub-" + id };
    },
    _dump: () => store,
  };
}

// ---------------------------------------------------------------------------
// Fake replay runner — called by the evaluator. Returns a deterministic
// successful replay result; the stub compareOutcomes then yields small deltas.
// ---------------------------------------------------------------------------
function createFakeReplayRunner() {
  let invocations = 0;
  return {
    async runReplay(plan) {
      invocations += 1;
      return {
        ok: true,
        new_run_id: plan.new_run_id,
        new_artifact_ids: [`ART-fake-${invocations}`],
        produced: [],
        duration_ms: 10,
      };
    },
    get invocations() { return invocations; },
  };
}

// ---------------------------------------------------------------------------
// 1. Types & state machine
// ---------------------------------------------------------------------------
async function testTypesAndStateMachine() {
  console.log("[types & state machine]");
  assert(SCHEMA_VERSION === 1, "schema_version is 1");
  assert(PROPOSAL_KINDS.length === 4, "4 proposal kinds");
  assert(PROPOSAL_STATES.length === 6, "6 proposal states");
  assert(isValidKind("prompt_change"), "prompt_change is a valid kind");
  assert(!isValidKind("bogus"), "bogus is not a valid kind");
  assert(isValidState("draft") && isValidState("applied"), "draft and applied are valid states");

  assert(canTransition("draft", "evaluating"), "draft → evaluating allowed");
  assert(canTransition("evaluating", "ready"), "evaluating → ready allowed");
  assert(canTransition("ready", "approved"), "ready → approved allowed");
  assert(canTransition("approved", "applied"), "approved → applied allowed");
  assert(canTransition("ready", "rejected"), "ready → rejected allowed");
  assert(!canTransition("applied", "draft"), "applied → draft blocked");
  assert(!canTransition("rejected", "applied"), "rejected → applied blocked");
  assert(!canTransition("draft", "approved"), "draft → approved blocked (must evaluate first)");
}

// ---------------------------------------------------------------------------
// 2. Store basics + state machine enforcement
// ---------------------------------------------------------------------------
async function testStoreBasics() {
  console.log("[store basics]");
  const root = await setupTmpRoot();
  try {
    const store = createProposalStore(root);
    const p1 = await store.create({
      kind: "config_change",
      change: { target: "config:cost_thresholds", from: "", to: '{"schema_version":1,"threshold":100}' },
      rationale: { summary: "raise cost threshold" },
      created_by: "proposer:heuristic",
    });
    assert(p1.id === "PROP-0001", "first id is PROP-0001");
    assert(p1.state === "draft", "initial state is draft");

    const p2 = await store.create({
      kind: "prompt_change",
      change: { target: "agent:troi.system_prompt", from: "", to: "be more concise" },
      rationale: { summary: "troi verbose" },
      created_by: "proposer:heuristic",
    });
    assert(p2.id === "PROP-0002", "second id is PROP-0002");

    const fetched = await store.get("PROP-0001");
    assert(fetched.rationale.summary === "raise cost threshold", "roundtrip rationale intact");

    try {
      await store.create({ kind: "bogus", change: { target: "x", to: "y" }, rationale: { summary: "z" }, created_by: "me" });
      throw new Error("should reject bad kind");
    } catch (e) { assert(/invalid kind/.test(e.message), "bad kind rejected"); }

    try {
      await store.create({ kind: "config_change", rationale: { summary: "x" }, created_by: "me" });
      throw new Error("should reject missing change");
    } catch (e) { assert(/change\.target/.test(e.message), "missing change.target rejected"); }

    const all = await store.list();
    assert(all.length === 2, "list returns 2");
    const stats = await store.stats();
    assert(stats.by_state.draft === 2, "stats: 2 drafts");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testStoreTransitions() {
  console.log("[store transitions & audit]");
  const root = await setupTmpRoot();
  try {
    const store = createProposalStore(root);
    const p = await store.create({
      kind: "config_change",
      change: { target: "config:cost_thresholds", to: "new" },
      rationale: { summary: "tune" },
      created_by: "proposer:heuristic",
    });

    await store.transition(p.id, "evaluating", { actor: "evaluator" });
    const afterEval = await store.transition(p.id, "ready", {
      actor: "evaluator",
      patch: { evaluation: { sample_size: 3, cost_delta_usd: -0.05, latency_delta_ms: 0, success_rate_delta: 0, evaluated_at: new Date().toISOString() } },
    });
    assert(afterEval.state === "ready", "state is ready");
    assert(afterEval.evaluation?.sample_size === 3, "evaluation patched onto proposal");

    try {
      await store.transition(p.id, "applied", { actor: "admin" });
      throw new Error("should not skip approved");
    } catch (e) { assert(/illegal/.test(e.message), "ready → applied skip blocked"); }

    const approved = await store.approve(p.id, { reviewer: "subhash", note: "ok ship it" });
    assert(approved.state === "approved", "approved");
    assert(approved.reviewer === "subhash", "reviewer stamped");
    assert(approved.review_note === "ok ship it", "review_note stamped");

    const applied = await store.transition(p.id, "applied", {
      actor: "applier", patch: { apply_result: { kind: "stub" } },
    });
    assert(applied.state === "applied", "applied terminal");
    assert(applied.applied_at, "applied_at set");

    try {
      await store.transition(p.id, "rejected", { actor: "admin" });
      throw new Error("terminal should be terminal");
    } catch (e) { assert(/illegal/.test(e.message), "applied → rejected blocked"); }

    const audit = await store.readAudit({ target: p.id });
    assert(audit.length === 5, `5 audit entries (got ${audit.length})`);
    assert(audit[audit.length - 1].action === "create", "oldest entry is create");
    assert(audit[0].to === "applied", "newest entry is applied");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testStoreReject() {
  console.log("[store reject path]");
  const root = await setupTmpRoot();
  try {
    const store = createProposalStore(root);
    const p = await store.create({
      kind: "prompt_change",
      change: { target: "agent:troi.system_prompt", to: "be brief" },
      rationale: { summary: "troi rambling" },
      created_by: "proposer:heuristic",
    });
    // reject from draft (skipping evaluation) is allowed
    const rejected = await store.reject(p.id, { reviewer: "subhash", note: "not a real issue" });
    assert(rejected.state === "rejected", "rejected from draft");
    assert(rejected.review_note === "not a real issue", "rejection note recorded");
    try {
      await store.approve(p.id, { reviewer: "subhash" });
      throw new Error("approve after reject should fail");
    } catch (e) { assert(/illegal/.test(e.message), "rejected is terminal"); }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 3. Heuristic proposer
// ---------------------------------------------------------------------------
async function testHeuristicProposer() {
  console.log("[heuristic proposer]");
  const observations = [
    // Troi lessons clustered under "auth" → should emit prompt_change
    { id: "OBS-0001", kind: "lesson", scope: "agent:troi", content: "missed CORS in auth setup", tags: ["auth", "react"], produced_at: "2026-04-01T00:00:00Z" },
    { id: "OBS-0002", kind: "lesson", scope: "agent:troi", content: "forgot session token refresh in auth flow", tags: ["auth"], produced_at: "2026-04-05T00:00:00Z" },
    { id: "OBS-0003", kind: "lesson", scope: "agent:troi", content: "login redirect lost on auth refresh", tags: ["auth"], produced_at: "2026-04-10T00:00:00Z" },
    // One lesson on a different agent — shouldn't trigger
    { id: "OBS-0010", kind: "lesson", scope: "agent:data", content: "schema inference flaky on nested JSON", tags: ["data"], produced_at: "2026-04-02T00:00:00Z" },
    // Patterns on spock tagged cost_high (≥2) → should emit model_change
    { id: "OBS-0020", kind: "pattern", scope: "agent:spock", content: "spock opus calls exceed $0.50/run", tags: ["cost_high"], produced_at: "2026-04-03T00:00:00Z" },
    { id: "OBS-0021", kind: "pattern", scope: "agent:spock", content: "opus overkill for config edits", tags: ["cost_high"], produced_at: "2026-04-08T00:00:00Z" },
    // Decisions on a registered config (≥2) → should emit config_change
    { id: "OBS-0030", kind: "decision", scope: "global", content: "bump warn threshold to 120", tags: ["threshold_tuned", "config:cost_thresholds"], produced_at: "2026-04-11T00:00:00Z" },
    { id: "OBS-0031", kind: "decision", scope: "global", content: "move hard cap to 200", tags: ["threshold_tuned", "config:cost_thresholds"], produced_at: "2026-04-12T00:00:00Z" },
  ];
  const memory = createFakeMemory(observations);
  const proposer = createHeuristicProposer({ minSupport: 2 });
  const registry = {
    CONFIG_ENTRIES: [
      { id: "cost_thresholds" }, { id: "llm_routing" }, { id: "pmd_registry" },
    ],
  };

  const drafts = await proposer.propose({ memory, registry });
  const byKind = drafts.reduce((acc, d) => ((acc[d.kind] = (acc[d.kind] || 0) + 1), acc), {});
  assert(drafts.length === 3, `3 drafts emitted (got ${drafts.length})`);
  assert(byKind.prompt_change === 1, "1 prompt_change draft");
  assert(byKind.model_change === 1, "1 model_change draft");
  assert(byKind.config_change === 1, "1 config_change draft");

  const promptDraft = drafts.find(d => d.kind === "prompt_change");
  assert(promptDraft.change.target === "agent:troi.system_prompt", "prompt target names troi");
  assert(promptDraft.rationale.supporting_observations.length === 3, "3 supporting observations on prompt draft");

  const modelDraft = drafts.find(d => d.kind === "model_change");
  assert(modelDraft.change.target === "task:spock.primary_model", "model target names spock");
  assert(modelDraft.rationale.meta.direction === "cheaper_tier", "direction is cheaper_tier");

  // Low support → no proposals
  const weakProposer = createHeuristicProposer({ minSupport: 5 });
  const weak = await weakProposer.propose({ memory, registry });
  assert(weak.length === 0, "minSupport=5 yields 0 drafts");
}

async function testRunProposerIntoStore() {
  console.log("[proposer → store wiring + dedupe]");
  const root = await setupTmpRoot();
  try {
    const observations = [
      { id: "OBS-0100", kind: "lesson", scope: "agent:troi", content: "missed CORS", tags: ["auth"], produced_at: "2026-04-01T00:00:00Z" },
      { id: "OBS-0101", kind: "lesson", scope: "agent:troi", content: "session lost", tags: ["auth"], produced_at: "2026-04-02T00:00:00Z" },
    ];
    const memory = createFakeMemory(observations);
    const proposer = createHeuristicProposer({ minSupport: 2 });
    const store = createProposalStore(root);

    const created1 = await runProposerIntoStore({ proposer, store, ctx: { memory, registry: { CONFIG_ENTRIES: [] } } });
    assert(created1.length === 1, "1 proposal created first run");

    // Run again over the same memory — should dedupe (non-terminal existing) → 0 new
    const created2 = await runProposerIntoStore({ proposer, store, ctx: { memory, registry: { CONFIG_ENTRIES: [] } } });
    assert(created2.length === 0, "dedupe: second run creates 0");

    // Reject the first proposal, run again → deduped drafts from non-terminal match the rejected entry by key, so it would re-emit. Guard: dedupe uses non-terminal only, so rejected is skipped from the blocklist.
    await store.reject(created1[0].id, { reviewer: "subhash" });
    const created3 = await runProposerIntoStore({ proposer, store, ctx: { memory, registry: { CONFIG_ENTRIES: [] } } });
    assert(created3.length === 1, "after rejection, same draft is re-emitted (rejected not in dedupe set)");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 4. Evaluator
// ---------------------------------------------------------------------------
async function testEvaluatorAggregation() {
  console.log("[evaluator aggregation]");
  const empty = aggregateDeltas([]);
  assert(empty.sample_size === 0, "empty deltas → sample_size 0");

  const deltas = [
    { cost_delta_usd: -0.10, latency_delta_ms: 100, success_rate_delta: 0.2 },
    { cost_delta_usd: -0.20, latency_delta_ms: 200, success_rate_delta: 0.1 },
    { cost_delta_usd: 0.00,  latency_delta_ms: 300, success_rate_delta: 0.0 },
  ];
  const agg = aggregateDeltas(deltas);
  assert(agg.sample_size === 3, "sample_size=3");
  assert(Math.abs(agg.cost_delta_usd - (-0.10)) < 1e-9, "mean cost_delta_usd correct");
  assert(Math.abs(agg.latency_delta_ms - 200) < 1e-9, "mean latency_delta_ms correct");
  assert(Math.abs(agg.success_rate_delta - 0.1) < 1e-9, "mean success_rate_delta correct");
}

async function testEvaluatorFullCycle() {
  console.log("[evaluator full cycle with fake replay]");
  const root = await setupTmpRoot();
  try {
    const store = createProposalStore(root);
    const p = await store.create({
      kind: "prompt_change",
      change: { target: "agent:troi.system_prompt", to: "be more explicit about auth" },
      rationale: { summary: "multiple auth lessons" },
      created_by: "proposer:heuristic",
    });

    const snapshots = [
      {
        run_id: "R-alpha", project_id: "alpha",
        artifacts: [
          { id: "A1", kind: "spec", run_id: "R-alpha", agent: "genovi", parent_ids: [], produced_at: "2026-04-01T00:00:00Z" },
          { id: "A2", kind: "code", run_id: "R-alpha", agent: "troi", parent_ids: ["A1"], produced_at: "2026-04-01T00:01:00Z" },
        ],
      },
      {
        run_id: "R-beta", project_id: "beta",
        artifacts: [
          { id: "B1", kind: "spec", run_id: "R-beta", agent: "genovi", parent_ids: [], produced_at: "2026-04-02T00:00:00Z" },
          { id: "B2", kind: "code", run_id: "R-beta", agent: "troi", parent_ids: ["B1"], produced_at: "2026-04-02T00:01:00Z" },
        ],
      },
    ];
    const runner = createFakeReplayRunner();

    // Custom comparator to prove the non-stub hook works
    const compareOutcomes = (snapshot, replayResult) => ({
      cost_delta_usd: -0.05,
      latency_delta_ms: 50,
      success_rate_delta: 0.1,
      comparison_note: `compared ${snapshot.run_id} vs ${replayResult.new_run_id}`,
    });

    const readyProposal = await evaluateAndStore({
      proposal: p, store,
      ctx: { snapshots, runReplay: runner.runReplay.bind(runner), compareOutcomes },
    });
    assert(readyProposal.state === "ready", "after evaluateAndStore, state=ready");
    assert(readyProposal.evaluation.sample_size === 2, "2 samples evaluated");
    assert(readyProposal.evaluation.cost_delta_usd === -0.05, "mean cost delta from comparator");
    assert(runner.invocations === 2, "replay runner called once per snapshot");
    assert(readyProposal.evaluation.per_sample.every(s => s.ok), "both samples successful");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testEvaluatorReplayFailure() {
  console.log("[evaluator tolerates replay failures]");
  const root = await setupTmpRoot();
  try {
    const store = createProposalStore(root);
    const p = await store.create({
      kind: "config_change",
      change: { target: "config:cost_thresholds", to: '{"schema_version":1,"threshold":200}' },
      rationale: { summary: "raise cap" },
      created_by: "proposer:heuristic",
    });
    const snapshots = [
      { run_id: "R-1", project_id: "p", artifacts: [{ id: "X1", kind: "spec", run_id: "R-1", agent: "g", parent_ids: [], produced_at: "2026-04-01T00:00:00Z" }] },
      { run_id: "R-2", project_id: "p", artifacts: [{ id: "X2", kind: "spec", run_id: "R-2", agent: "g", parent_ids: [], produced_at: "2026-04-02T00:00:00Z" }] },
    ];
    let called = 0;
    const runReplay = async () => {
      called += 1;
      if (called === 1) return { ok: false, error: "transient replay failure" };
      return { ok: true, new_run_id: "replay-2", new_artifact_ids: ["X-new"], produced: [], duration_ms: 5 };
    };
    const result = await evaluateProposal(p, { snapshots, runReplay });
    assert(result.sample_size === 1, "1 successful sample (the other failed)");
    assert(result.per_sample.length === 2, "per_sample still tracks both");
    assert(result.per_sample[0].ok === false, "first sample marked !ok");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 5. Applier
// ---------------------------------------------------------------------------
async function testApplierTargetParsing() {
  console.log("[applier target parsing]");
  assert(parseTarget("config:cost_thresholds").kind === "config", "config: parsed");
  assert(parseTarget("config:cost_thresholds").config_id === "cost_thresholds", "config_id extracted");
  assert(parseTarget("config:courier_routing.rules.default").key_path === "rules.default", "nested key_path extracted");
  assert(parseTarget("agent:troi.system_prompt").agent_id === "troi", "agent id extracted");
  assert(parseTarget("task:spock.primary_model").agent === "spock", "task agent extracted");
  try { parseTarget("whatever"); throw new Error("should fail"); }
  catch (e) { assert(/malformed/.test(e.message), "malformed target rejected"); }
}

async function testApplierConfigChange() {
  console.log("[applier config_change]");
  const root = await setupTmpRoot();
  try {
    const store = createProposalStore(root);
    const configIO = createFakeConfigIO({
      cost_thresholds: { schema_version: 1, warn_usd: 100, hard_cap_usd: 500 },
    });

    const p = await store.create({
      kind: "config_change",
      change: { target: "config:cost_thresholds.warn_usd", from: "100", to: 150 },
      rationale: { summary: "raise warn threshold" },
      created_by: "proposer:heuristic",
    });
    await store.transition(p.id, "evaluating", { actor: "evaluator" });
    await store.transition(p.id, "ready", { actor: "evaluator", patch: { evaluation: { sample_size: 1 } } });
    await store.approve(p.id, { reviewer: "subhash" });
    const approved = await store.get(p.id);

    const applied = await applyAndStore({
      proposal: approved, store, ctx: { configIO },
    });
    assert(applied.state === "applied", "final state is applied");
    assert(applied.apply_result.target_config_id === "cost_thresholds", "apply_result recorded");
    const state = configIO._dump();
    assert(state.cost_thresholds.warn_usd === 150, "warn_usd actually updated on disk");
    assert(state.cost_thresholds.hard_cap_usd === 500, "other keys unchanged");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testApplierModelChange() {
  console.log("[applier model_change]");
  const root = await setupTmpRoot();
  try {
    const store = createProposalStore(root);
    const configIO = createFakeConfigIO({
      llm_routing: { schema_version: 1, tasks: { spock: { primary_model: "opus-4-7" } } },
    });
    const p = await store.create({
      kind: "model_change",
      change: { target: "task:spock.primary_model", from: "opus-4-7", to: "haiku-4-5" },
      rationale: { summary: "cost-high patterns" },
      created_by: "proposer:heuristic",
    });
    await store.transition(p.id, "evaluating", { actor: "evaluator" });
    await store.transition(p.id, "ready", { actor: "evaluator" });
    await store.approve(p.id, { reviewer: "subhash" });
    const approved = await store.get(p.id);
    await applyAndStore({ proposal: approved, store, ctx: { configIO } });
    const state = configIO._dump();
    assert(state.llm_routing.tasks.spock.primary_model === "haiku-4-5", "model_change updates llm_routing");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testApplierPromptChange() {
  console.log("[applier prompt_change]");
  const root = await setupTmpRoot();
  try {
    const store = createProposalStore(root);
    const p = await store.create({
      kind: "prompt_change",
      change: { target: "agent:troi.system_prompt", from: "", to: "be more explicit" },
      rationale: { summary: "verbose troi" },
      created_by: "proposer:heuristic",
    });
    await store.transition(p.id, "evaluating", { actor: "evaluator" });
    await store.transition(p.id, "ready", { actor: "evaluator" });
    await store.approve(p.id, { reviewer: "subhash" });
    const approved = await store.get(p.id);
    const applied = await applyAndStore({
      proposal: approved, store, ctx: { workspaceRoot: root },
    });
    assert(applied.apply_result.override_file.includes("_prompt-overrides/troi.jsonl"), "override file path correct");
    const content = await fs.readFile(applied.apply_result.override_file, "utf-8");
    assert(content.includes("be more explicit"), "override content written");
    assert(content.includes(p.id), "proposal id recorded in override entry");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testApplierGraphChangeRejected() {
  console.log("[applier graph_change rejected]");
  const root = await setupTmpRoot();
  try {
    const store = createProposalStore(root);
    const p = await store.create({
      kind: "graph_change",
      change: { target: "graph:dev_graph.node.reviewer", to: "(insert new reviewer node)" },
      rationale: { summary: "add reviewer step" },
      created_by: "human:subhash",
    });
    await store.transition(p.id, "evaluating", { actor: "evaluator" });
    await store.transition(p.id, "ready", { actor: "evaluator" });
    await store.approve(p.id, { reviewer: "subhash" });
    const approved = await store.get(p.id);
    try {
      await applyProposal(approved, {});
      throw new Error("should have rejected");
    } catch (e) {
      assert(/graph_change rejected/.test(e.message), "graph_change rejected by applier (D145)");
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testApplierRequiresApproved() {
  console.log("[applier requires approved state]");
  const root = await setupTmpRoot();
  try {
    const store = createProposalStore(root);
    const p = await store.create({
      kind: "prompt_change",
      change: { target: "agent:troi.system_prompt", to: "x" },
      rationale: { summary: "test" },
      created_by: "proposer:heuristic",
    });
    // Still draft → applier refuses
    try {
      await applyProposal(p, { workspaceRoot: root });
      throw new Error("should have refused non-approved");
    } catch (e) { assert(/not in approved state/.test(e.message), "non-approved refused"); }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 6. End-to-end lifecycle
// ---------------------------------------------------------------------------
async function testFullLifecycle() {
  console.log("[full lifecycle: memory → propose → evaluate → approve → apply]");
  const root = await setupTmpRoot();
  try {
    const observations = [
      { id: "OBS-L1", kind: "lesson", scope: "agent:troi", content: "missed CORS", tags: ["auth"], produced_at: "2026-04-01T00:00:00Z" },
      { id: "OBS-L2", kind: "lesson", scope: "agent:troi", content: "session lost", tags: ["auth"], produced_at: "2026-04-02T00:00:00Z" },
    ];
    const memory = createFakeMemory(observations);
    const proposer = createHeuristicProposer({ minSupport: 2 });
    const store = createProposalStore(root);

    const drafts = await runProposerIntoStore({ proposer, store, ctx: { memory, registry: { CONFIG_ENTRIES: [] } } });
    assert(drafts.length === 1, "lifecycle: 1 draft from memory");

    const runner = createFakeReplayRunner();
    const compareOutcomes = () => ({
      cost_delta_usd: -0.02, latency_delta_ms: 10, success_rate_delta: 0.05,
      comparison_note: "favourable",
    });
    const snapshots = [{
      run_id: "R-X", project_id: "demo",
      artifacts: [{ id: "X1", kind: "code", run_id: "R-X", agent: "troi", parent_ids: [], produced_at: "2026-04-01T00:00:00Z" }],
    }];
    const readyProp = await evaluateAndStore({
      proposal: drafts[0], store,
      ctx: { snapshots, runReplay: runner.runReplay.bind(runner), compareOutcomes },
    });
    assert(readyProp.state === "ready", "lifecycle: ready after evaluation");
    assert(readyProp.evaluation.success_rate_delta === 0.05, "lifecycle: positive improvement signal");

    const approved = await store.approve(readyProp.id, { reviewer: "subhash", note: "let's try it" });
    assert(approved.state === "approved", "lifecycle: approved");

    const applied = await applyAndStore({
      proposal: approved, store, ctx: { workspaceRoot: root },
    });
    assert(applied.state === "applied", "lifecycle: applied");

    const audit = await store.readAudit({ target: drafts[0].id });
    const actions = audit.map(e => e.action).reverse();
    assert(actions[0] === "create", "audit: create first");
    assert(audit.length === 5, `audit: 5 entries (create + 4 transitions) for full flow (got ${audit.length})`);

    const overrideFile = path.join(root, "_prompt-overrides", "troi.jsonl");
    const contents = await fs.readFile(overrideFile, "utf-8");
    assert(contents.includes(drafts[0].id), "lifecycle: override file written with proposal id");

    const stats = await store.stats();
    assert(stats.by_state.applied === 1, "lifecycle: stats show 1 applied");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  try {
    await testTypesAndStateMachine(); console.log("");
    await testStoreBasics();            console.log("");
    await testStoreTransitions();       console.log("");
    await testStoreReject();            console.log("");
    await testHeuristicProposer();      console.log("");
    await testRunProposerIntoStore();   console.log("");
    await testEvaluatorAggregation();   console.log("");
    await testEvaluatorFullCycle();     console.log("");
    await testEvaluatorReplayFailure(); console.log("");
    await testApplierTargetParsing();   console.log("");
    await testApplierConfigChange();    console.log("");
    await testApplierModelChange();     console.log("");
    await testApplierPromptChange();    console.log("");
    await testApplierGraphChangeRejected();  console.log("");
    await testApplierRequiresApproved(); console.log("");
    await testFullLifecycle();
    console.log("\n[smoke] OK");
  } catch (e) {
    console.error(`\n[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
