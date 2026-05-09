import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createKnowledgeBase } from "./kb.js";
import { createScheduler } from "./scheduler.js";
import { createResearcher, createStubDispatcher } from "./researcher.js";
import { createArchitectProposer, createArchitectApplier } from "./proposer.js";
import { createArchitect } from "./architect.js";
import { createFounderPortal } from "./portal.js";
import {
  PRIORITY_AREAS, PASS_KINDS, validateStandingOrders,
  computeAttentionBudget, isValidPriorityArea, applyBaselineDefaults,
  DEFAULT_BASELINE,
} from "./types.js";
import { createProposalStore } from "../self-improvement/store.js";
import { applyProposal } from "../self-improvement/applier.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

async function setupTmpRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "architect-"));
}

const SAMPLE_STANDING_ORDERS = Object.freeze({
  version: 1,
  baseline: {
    cron_schedule: { hour_utc: 0, minute_utc: 0 },
    daily_budget_usd: 1.5,
    research_depth: "standard",
    research_dispatcher: "stub",
    auto_watch_enabled: true,
    auto_watch_disabled_ids: [],
  },
  custom_direction: {
    effective_period: {
      start_date: "2026-05-09",
      end_date: "2026-08-09",
      horizon_label: "Q3 2026 — internal testing band",
    },
    overall_stance: {
      risk_appetite: "experimental",
      quality_vs_speed: "balanced",
      cost_sensitivity: "medium",
      change_tolerance: "gradual",
    },
    priority_areas: [
      { id: "models", weight: 5, current_state: "Sonnet/Haiku/OpenRouter.", target_3mo: "Hermes 4.", target_6mo: "Tinker specialist." },
      { id: "agents", weight: 4, current_state: "11 named agents.", target_3mo: "Picard 95% Tuvok.", target_6mo: "Add Q debug." },
      { id: "languages", weight: 2, current_state: "TS first.", target_3mo: "Python pilot.", target_6mo: "Rust if demand." },
      { id: "tools", weight: 4, current_state: "MCP 5 servers.", target_3mo: "MCP > 10.", target_6mo: "IDE-MCP." },
      { id: "output_quality", weight: 4, current_state: "Tuvok ~80%.", target_3mo: "Tuvok 95%.", target_6mo: "Auto-rubric." },
      { id: "operations", weight: 3, current_state: "Single-VM.", target_3mo: "Single-cmd deploy.", target_6mo: "Multi-tenant." },
    ],
    strategic_watch: [
      { id: "anthropic", kind: "org", name: "Anthropic", importance: "high", url: "https://anthropic.com", watch_frequency: "weekly" },
      { id: "thinking-machines", kind: "org", name: "Thinking Machines Lab", importance: "high", url: "https://thinkingmachines.ai", watch_frequency: "weekly" },
    ],
    notes: "Sample for smoke testing.",
  },
});

function clone() { return JSON.parse(JSON.stringify(SAMPLE_STANDING_ORDERS)); }

// ---------------------------------------------------------------------------
async function testTypes() {
  console.log("[types]");
  assert(PRIORITY_AREAS.length === 6, "6 priority areas (D194)");
  assert(PRIORITY_AREAS.every(a => isValidPriorityArea(a)), "all 6 valid");
  assert(PASS_KINDS.length === 4, "4 pass kinds");
  assert(PASS_KINDS.includes("boot") && PASS_KINDS.includes("daily") && PASS_KINDS.includes("founder_priority_update"), "core pass kinds present");

  const errs = validateStandingOrders(clone());
  assert(errs.length === 0, `valid sample passes validation (got ${errs.length}: ${errs.join("|")})`);

  // Loose validator: missing baseline is OK
  const noBaseline = clone(); delete noBaseline.baseline;
  assert(validateStandingOrders(noBaseline).length === 0, "missing baseline is OK (loose 21-A)");

  // Strict requirements: 6 priority_areas
  const fiveAreas = clone();
  fiveAreas.custom_direction.priority_areas = fiveAreas.custom_direction.priority_areas.slice(0, 5);
  assert(validateStandingOrders(fiveAreas).length > 0, "5-area priorities rejected");

  // Strict: weight 1-5
  const badWeight = clone();
  badWeight.custom_direction.priority_areas[0].weight = 9;
  assert(validateStandingOrders(badWeight).some(e => /weight/.test(e)), "weight > 5 rejected");

  // Soft: invalid stance value still produces error (validates if present)
  const badStance = clone();
  badStance.custom_direction.overall_stance.risk_appetite = "yolo";
  assert(validateStandingOrders(badStance).some(e => /risk_appetite/.test(e)), "invalid risk_appetite flagged");

  // No custom_direction → required
  const noCD = clone(); delete noCD.custom_direction;
  assert(validateStandingOrders(noCD).some(e => /custom_direction/.test(e)), "missing custom_direction rejected");

  // No version → rejected
  const noVer = clone(); delete noVer.version;
  assert(validateStandingOrders(noVer).some(e => /version/.test(e)), "missing version rejected");

  // applyBaselineDefaults
  const def = applyBaselineDefaults({});
  assert(def.daily_budget_usd === DEFAULT_BASELINE.daily_budget_usd, "default daily_budget_usd");
  assert(def.research_depth === "standard", "default research_depth");
  assert(def.cron_schedule.hour_utc === 0, "default cron hour");

  const partial = applyBaselineDefaults({ daily_budget_usd: 5 });
  assert(partial.daily_budget_usd === 5, "partial baseline preserves passed value");
  assert(partial.research_depth === "standard", "partial baseline fills missing");

  // Attention budget
  const budget = computeAttentionBudget(SAMPLE_STANDING_ORDERS);
  assert(budget && Object.keys(budget).length === 6, "attention budget for 6 areas");
  const sum = Object.values(budget).reduce((a, x) => a + x, 0);
  assert(Math.abs(sum - 1.0) < 0.005, `attention budget sums to ~1.0 (got ${sum})`);
  assert(budget.models > budget.languages, "weight 5 > weight 2 share");
}

async function testKbBasics() {
  console.log("[kb basics]");
  const root = await setupTmpRoot();
  try {
    const kb = createKnowledgeBase(root);

    const written = await kb.writeStandingOrders(SAMPLE_STANDING_ORDERS);
    assert(written.schema_version === 1, "schema_version stamped");
    assert(written.baseline.daily_budget_usd === 1.5, "baseline preserved");
    assert(written.custom_direction.priority_areas.length === 6, "6 priority areas preserved");

    const read = await kb.readStandingOrders();
    assert(read.version === 1, "roundtrip version=1");
    assert(read.custom_direction.priority_areas.length === 6, "roundtrip priorities");

    // baseline accessor (returns DEFAULT when no SO yet)
    const root2 = await setupTmpRoot();
    try {
      const kb2 = createKnowledgeBase(root2);
      const baseline = await kb2.readBaseline();
      assert(baseline.daily_budget_usd === DEFAULT_BASELINE.daily_budget_usd, "readBaseline returns defaults when no SO");
    } finally { await fs.rm(root2, { recursive: true, force: true }); }

    const baseline = await kb.readBaseline();
    assert(baseline.daily_budget_usd === 1.5, "readBaseline returns SO baseline");
    assert(baseline.cron_schedule.hour_utc === 0, "readBaseline includes cron");

    const cd = await kb.readCustomDirection();
    assert(cd.priority_areas.length === 6, "readCustomDirection returns Tab 2");

    // Standing Orders history
    const v2 = clone(); v2.version = 2;
    await kb.writeStandingOrders(v2);
    const history = await kb.readStandingOrdersHistory();
    assert(history.length === 2, "history captures both versions");
    assert(history[0].version === 2, "newest version first");

    // targets
    const t1 = await kb.addTarget({ name: "Hermes Agent", category: "agent_runtime", priority_area: "agents" });
    assert(t1.id === "T-0001", "first target id");
    await kb.addTarget({ name: "Tinker", category: "training_api", priority_area: "models" });
    const all = await kb.listTargets();
    assert(all.length === 2, "list 2 targets");
    const onlyModels = await kb.listTargets({ priority_area: "models" });
    assert(onlyModels.length === 1, "filter by priority_area");

    const updated = await kb.updateTarget("T-0001", { status: "watching" });
    assert(updated.status === "watching", "updateTarget");
    const refreshed = (await kb.listTargets()).find(t => t.id === "T-0001");
    assert(refreshed.status === "watching", "list reflects update");

    try { await kb.updateTarget("T-9999", {}); throw new Error("should fail"); }
    catch (e) { assert(/not found/.test(e.message), "unknown id rejected"); }

    // gaps
    const g1 = await kb.addGap({ description: "no signed-provenance", priority_area: "tools" });
    assert(g1.id === "G-0001" && g1.status === "open", "first gap");
    const resolved = await kb.resolveGap("G-0001", "T-fake");
    assert(resolved.status === "resolved", "gap resolved");
    const open = await kb.listGaps({ status: "open" });
    assert(open.length === 0, "no open gaps after resolve");

    // pass + findings
    const pass = await kb.startPass("manual");
    assert(pass.id === "RP-0001", "first pass id");
    const f1 = await kb.appendFinding({
      pass_id: pass.id, content: "Hermes upgrade", kind: "upgrade-available",
      target_id: "T-0001", priority_area: "agents",
    });
    assert(f1.id === "F-0001", "first finding id");
    const findings = await kb.listFindings({ pass_id: pass.id });
    assert(findings.length === 1, "list findings");
    const finished = await kb.finishPass(pass.id, { findings_count: 1, proposals_emitted: 1, cost_usd: 0.05 });
    assert(finished.status === "succeeded", "pass succeeded");

    const s = await kb.summary();
    assert(s.target_count === 2, "summary targets");
    assert(s.gap_count === 1, "summary gaps");
    assert(s.finding_count === 1, "summary findings");
    assert(s.last_priority_version_seen === 2, "summary tracks SO version");
    assert(s.findings_by_area.agents === 1, "findings_by_area");

    const snap = await kb.writeRoadmapSnapshot({ a_tier_phases: 16, total_assertions: 1021 });
    assert(snap.captured_at, "roadmap snapshot timestamped");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testKbValidation() {
  console.log("[kb validation]");
  const root = await setupTmpRoot();
  try {
    const kb = createKnowledgeBase(root);
    const bad = clone();
    bad.custom_direction.priority_areas = [];
    try { await kb.writeStandingOrders(bad); throw new Error("should reject"); }
    catch (e) { assert(/priority_areas/.test(e.message), "invalid SO rejected"); }

    try { await kb.addTarget({}); throw new Error("should reject"); }
    catch (e) { assert(/name/.test(e.message), "addTarget without name rejected"); }

    try { await kb.addGap({ description: "x", priority_area: "wat" }); throw new Error("should reject"); }
    catch (e) { assert(/priority_area/.test(e.message), "invalid priority_area rejected"); }

    try { await kb.appendFinding({ pass_id: "RP-0001", content: "x", kind: "wat" }); throw new Error("should reject"); }
    catch (e) { assert(/kind/.test(e.message), "invalid finding kind rejected"); }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testScheduler() {
  console.log("[scheduler]");
  let enqueued = [];
  const sched = createScheduler({
    enqueue: async (kind, payload) => { enqueued.push({ kind, payload }); return { ok: true }; },
    readBaselineAndVersion: async () => ({ version: 1, hour_utc: 0, minute_utc: 0 }),
    config: { run_on_boot: true },
  });

  const startResult = await sched.start();
  assert(startResult.boot_enqueued === true, "boot enqueued");
  assert(enqueued.length === 1 && enqueued[0].kind === "boot", "boot pass kind");
  assert(typeof startResult.ms_until_next_daily === "number", "next daily computed");

  const manual = await sched.triggerManual({ note: "founder request" });
  assert(manual?.ok === true, "manual works");
  assert(enqueued.some(e => e.kind === "manual"), "manual enqueued");

  sched.stop();
  enqueued = [];

  const noBoot = createScheduler({
    enqueue: async (k) => { enqueued.push({ kind: k }); },
    config: { run_on_boot: false },
  });
  await noBoot.start();
  assert(enqueued.length === 0, "no-boot mode works");
  noBoot.stop();
}

async function testResearcher() {
  console.log("[researcher with stub]");
  const dispatcher = createStubDispatcher({ findings_per_area: 2 });
  const researcher = createResearcher({ dispatchSubagent: dispatcher, budget_usd_per_pass: 6 });

  const result = await researcher.runPass({
    pass_id: "RP-test",
    custom_direction: SAMPLE_STANDING_ORDERS.custom_direction,
    baseline: SAMPLE_STANDING_ORDERS.baseline,
    watch: SAMPLE_STANDING_ORDERS.custom_direction.strategic_watch,
    kb_summary: {},
  });
  assert(result.total_findings === 12, `12 findings (6 areas × 2), got ${result.total_findings}`);
  assert(Object.keys(result.by_area).length === 6, "by_area 6 entries");
  assert(result.findings.every(f => f.priority_area), "every finding has priority_area");

  // baseline daily_budget_usd flows through
  const budgetCheck = createResearcher({ dispatchSubagent: async ({ budget_usd }) => ({ findings: [{ content: `b=${budget_usd}`, sources: [], kind: "info" }], cost_usd: 0 }), budget_usd_per_pass: 100 });
  const r3 = await budgetCheck.runPass({
    pass_id: "RP-budget",
    custom_direction: SAMPLE_STANDING_ORDERS.custom_direction,
    baseline: { daily_budget_usd: 10 },
    kb_summary: {},
  });
  assert(r3.findings.some(f => /b=/.test(f.content)), "researcher passes per-area budget to dispatcher");

  // failure isolation
  const flaky = async (args) => {
    if (args.area === "languages") throw new Error("simulated");
    return { findings: [{ content: "ok", sources: [], kind: "info" }], cost_usd: 0 };
  };
  const r2 = createResearcher({ dispatchSubagent: flaky });
  const r2Result = await r2.runPass({
    pass_id: "RP-flaky", custom_direction: SAMPLE_STANDING_ORDERS.custom_direction,
    baseline: { daily_budget_usd: 1 }, kb_summary: {},
  });
  assert(r2Result.by_area.languages.error, "failed area captured");
  assert(r2Result.findings.length === 5, "other 5 areas still succeed");
}

async function testProposerAndApplier() {
  console.log("[proposer + applier flow]");
  const root = await setupTmpRoot();
  try {
    const kb = createKnowledgeBase(root);
    await kb.writeStandingOrders(SAMPLE_STANDING_ORDERS);
    const proposalStore = createProposalStore(root);
    const proposer = createArchitectProposer({ proposalStore, kb });

    const pass = await kb.startPass("manual");
    const findings = [];
    findings.push(await kb.appendFinding({
      pass_id: pass.id, content: "Hermes 4 ships tool-calling", kind: "new-tool",
      priority_area: "models", produced_by: "researcher:stub",
    }));
    findings.push(await kb.appendFinding({
      pass_id: pass.id, content: "LangGraph 1.1 patch", kind: "upgrade-available",
      priority_area: "agents", target_id: "T-fake",
    }));
    findings.push(await kb.appendFinding({
      pass_id: pass.id, content: "MCP server count crossed 10K", kind: "info",
      priority_area: "tools",
    }));

    const enriched = findings.map((f, i) => ({
      ...f, target_name: i === 0 ? "Hermes 4" : undefined, target_category: "model",
    }));
    const result = await proposer.fromFindings(enriched);
    assert(result.proposals.length === 3, "3 proposals from 3 findings");
    assert(result.by_kind.tool_adoption === 2, "2 tool_adoption");
    assert(result.by_kind.research_finding === 1, "1 research_finding");

    const toolProp = result.proposals.find(p => p.kind === "tool_adoption");
    assert(toolProp.change.target.startsWith("tool:"), "tool_adoption target shape");

    // Applier wired through Phase 15-A
    const applier = createArchitectApplier({ kb });
    const id = result.proposals[0].id;
    await proposalStore.transition(id, "evaluating", { actor: "evaluator" });
    await proposalStore.transition(id, "ready", { actor: "evaluator" });
    await proposalStore.approve(id, { reviewer: "founder" });
    const approved = await proposalStore.get(id);
    const applied = await applyProposal(approved, { architectApplier: applier });
    assert(applied.ok, "Phase 15-A applier routes via ctx.architectApplier");

    try { await applyProposal(approved, {}); throw new Error("should reject"); }
    catch (e) { assert(/architectApplier/.test(e.message), "applier requires architectApplier ctx"); }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testArchitectOrchestrator() {
  console.log("[architect orchestrator]");
  const root = await setupTmpRoot();
  try {
    const kb = createKnowledgeBase(root);
    await kb.writeStandingOrders(SAMPLE_STANDING_ORDERS);

    const proposalStore = createProposalStore(root);
    const proposer = createArchitectProposer({ proposalStore, kb });
    const dispatcher = createStubDispatcher({ findings_per_area: 1 });
    const researcher = createResearcher({ dispatchSubagent: dispatcher, budget_usd_per_pass: 6 });
    const architect = createArchitect({ kb, researcher, proposer });

    const result = await architect.runPass("boot");
    assert(result.findings_count === 6, `6 findings (1 per area)`);
    assert(result.proposals_count === 6, "6 proposals");
    assert(result.pass.status === "succeeded", "pass succeeded");
    assert(result.cost_usd === 0, "stub costs $0");

    const summary = await kb.summary();
    assert(summary.finding_count === 6, "summary 6 findings");
    assert(summary.target_count === 0, "stub emits info findings (no auto-targets)");

    const passes = await kb.listPasses();
    assert(passes.length === 1, "1 pass in history");

    // No standing orders → graceful skip
    const root2 = await setupTmpRoot();
    try {
      const kb2 = createKnowledgeBase(root2);
      const arch2 = createArchitect({
        kb: kb2, researcher,
        proposer: createArchitectProposer({ proposalStore: createProposalStore(root2), kb: kb2 }),
      });
      const skip = await arch2.runPass("boot");
      assert(skip.skipped === true, "no SO → skipped");
      assert(/standing_orders/.test(skip.reason), "skip reason mentions standing_orders");
    } finally { await fs.rm(root2, { recursive: true, force: true }); }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testFounderPortal() {
  console.log("[founder portal]");
  const root = await setupTmpRoot();
  try {
    const kb = createKnowledgeBase(root);
    await kb.writeStandingOrders(SAMPLE_STANDING_ORDERS);
    const proposalStore = createProposalStore(root);
    const proposer = createArchitectProposer({ proposalStore, kb });
    const researcher = createResearcher({ dispatchSubagent: createStubDispatcher({ findings_per_area: 1 }) });
    const architect = createArchitect({ kb, researcher, proposer });
    await architect.runPass("boot");

    const portal = createFounderPortal({ proposalStore, kb });
    const overview = await portal.overview();
    assert(overview.priorities_version === 1, "overview shows version");
    assert(overview.proposal_count === 6, "overview proposal count");
    assert(overview.kb_summary.finding_count === 6, "overview includes kb summary");
    assert(overview.recent_passes.length === 1, "recent passes");

    const tools = await portal.listProposals({ kind: "tool_adoption" });
    assert(tools.every(p => p.kind === "tool_adoption"), "filter by kind");

    const first = (await proposalStore.list())[0];
    const detail = await portal.getProposalDetail(first.id);
    assert(detail.proposal.id === first.id, "detail returns proposal");
    assert(Array.isArray(detail.findings), "detail has findings");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function main() {
  try {
    await testTypes();              console.log("");
    await testKbBasics();           console.log("");
    await testKbValidation();       console.log("");
    await testScheduler();          console.log("");
    await testResearcher();         console.log("");
    await testProposerAndApplier(); console.log("");
    await testArchitectOrchestrator(); console.log("");
    await testFounderPortal();
    console.log("\n[smoke] OK");
  } catch (e) {
    console.error(`\n[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
