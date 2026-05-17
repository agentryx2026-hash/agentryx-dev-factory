/**
 * Phase 21-B.2 smoke test for the architect_research queue handler.
 *
 *   node cognitive-engine/concurrency/handlers/architect-handler.smoke.js
 *
 * Tests the wrapper + the registered handler with stub architect / kb /
 * proposalStore — no real LLM, no real filesystem KB, no queue daemon.
 * The intent is to prove the contract: payload validated, runPass
 * invoked with the right shape, report synthesized when configured,
 * onReportProduced fired once.
 */

import assert from "node:assert/strict";
import { runArchitectPass, registerArchitectResearchHandler, ARCHITECT_RESEARCH_KIND } from "./architect-handler.js";

let passed = 0, failed = 0;
function check(label, actual, expected) {
  try { assert.deepEqual(actual, expected); console.log(`  ✓ ${label}`); passed += 1; }
  catch { console.log(`  ✗ ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`); failed += 1; }
}
function ok(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); passed += 1; }
  else      { console.log(`  ✗ ${label}`); failed += 1; }
}
function group(name) { console.log(`\n[${name}]`); }

// ─── stubs ──────────────────────────────────────────────────────────────────

function buildStubs() {
  const calls = { runPass: [], writeReport: [], listFindings: [], onReport: [] };
  const stubKb = {
    listFindings: async (filter) => {
      calls.listFindings.push(filter);
      // Return a couple findings for the report-section path.
      return [
        { id: "FND-1", priority_area: "models",  content: "Sonnet 4.6 is cost-competitive vs 4.5." },
        { id: "FND-2", priority_area: "agents",  content: "Spock dossier quality improves with web-search MCP." },
      ];
    },
    writeReport: async (r) => {
      calls.writeReport.push(r);
      return { id: "REP-9001", ...r };
    },
  };
  const stubProposalStore = {}; // proposer only constructs against it; not invoked in this test path

  // Architect harness — mimics the runPass call signature + minimal shape.
  const A = {
    createArchitectProposer: () => ({ /* unused inside this stub */ }),
    createResearcher: ({ dispatchSubagent, budget_usd_per_pass }) => {
      calls.researcherInit = { dispatcher: dispatchSubagent?.kind || "unknown", budget: budget_usd_per_pass };
      return { dispatchSubagent };
    },
    createArchitect: ({ kb, researcher, proposer }) => ({
      runPass: async (cadenceKind, opts) => {
        calls.runPass.push({ cadenceKind, opts });
        return {
          pass: { id: `PASS-${cadenceKind}-1`, completed_at: new Date().toISOString() },
          findings_count: 2,
          proposals_count: 1,
          cost_usd: 0,
        };
      },
    }),
  };

  const pickDispatcher = (_A, key) => ({ kind: key });

  return { A, kb: stubKb, proposalStore: stubProposalStore, pickDispatcher, calls };
}

// ─── runArchitectPass — direct path ────────────────────────────────────────

group("runArchitectPass — report_enabled");
{
  const s = buildStubs();
  const result = await runArchitectPass({
    A: s.A,
    kb: s.kb,
    proposalStore: s.proposalStore,
    cadenceKind: "monthly",
    cadenceConfig: { dispatcher: "sonnet", budget_usd: 2.5, report_enabled: true },
    pickDispatcher: s.pickDispatcher,
  });

  ok("returned a pass", !!result.pass?.id);
  ok("returned a report", !!result.report?.id);
  check("runPass called once", s.calls.runPass.length, 1);
  check("runPass got cadenceKind", s.calls.runPass[0].cadenceKind, "monthly");
  check("writeReport called once", s.calls.writeReport.length, 1);
  check("report.cadence = monthly", s.calls.writeReport[0].cadence, "monthly");
  check("report.kind = cycle", s.calls.writeReport[0].kind, "cycle");
  ok("report has Findings section",   s.calls.writeReport[0].sections.some(x => x.heading.includes("Findings")));
  ok("monthly cycle has Criteria section", s.calls.writeReport[0].sections.some(x => x.heading.includes("Criteria")));
  check("dispatcher passed through to researcher", s.calls.researcherInit.dispatcher, "sonnet");
  check("budget passed through", s.calls.researcherInit.budget, 2.5);
}

group("runArchitectPass — report_enabled=false → no writeReport");
{
  const s = buildStubs();
  const result = await runArchitectPass({
    A: s.A, kb: s.kb, proposalStore: s.proposalStore,
    cadenceKind: "daily",
    cadenceConfig: { report_enabled: false },
    pickDispatcher: s.pickDispatcher,
  });
  ok("returned pass", !!result.pass?.id);
  ok("returned NO report", !result.report);
  check("writeReport NOT called", s.calls.writeReport.length, 0);
}

group("runArchitectPass — weekly cadence omits Criteria section");
{
  const s = buildStubs();
  await runArchitectPass({
    A: s.A, kb: s.kb, proposalStore: s.proposalStore,
    cadenceKind: "weekly",
    cadenceConfig: { report_enabled: true },
    pickDispatcher: s.pickDispatcher,
  });
  ok("weekly report has Findings section", s.calls.writeReport[0].sections.some(x => x.heading.includes("Findings")));
  ok("weekly report has NO Criteria section", !s.calls.writeReport[0].sections.some(x => x.heading.includes("Criteria")));
}

group("runArchitectPass — argument validation");
{
  let t = 0;
  try { await runArchitectPass({}); } catch { t += 1; }
  try { await runArchitectPass({ A: {}, kb: { writeReport: () => {} } }); } catch { t += 1; }
  try { await runArchitectPass({ A: { createArchitect: () => {} }, kb: { writeReport: () => {} } }); } catch { t += 1; }
  ok("3 missing-arg variants all throw", t === 3);
}

// ─── registered handler — full job-shape contract ───────────────────────────

function makeRegistry() {
  const handlers = new Map();
  return {
    register: (kind, fn) => { handlers.set(kind, fn); },
    get: (kind) => handlers.get(kind),
    has: (kind) => handlers.has(kind),
    list: () => [...handlers.keys()],
  };
}

group(`registerArchitectResearchHandler — registers '${ARCHITECT_RESEARCH_KIND}'`);
{
  const s = buildStubs();
  const reg = makeRegistry();
  registerArchitectResearchHandler(reg, {
    A: s.A, kb: s.kb, proposalStore: s.proposalStore, pickDispatcher: s.pickDispatcher,
    onReportProduced: (r) => { s.calls.onReport.push(r); },
  });
  ok("handler registered under architect_research", reg.has(ARCHITECT_RESEARCH_KIND));
  ok(`list() includes '${ARCHITECT_RESEARCH_KIND}'`, reg.list().includes(ARCHITECT_RESEARCH_KIND));
}

group("handler — valid job → runs, writes report, fires onReportProduced");
{
  const s = buildStubs();
  const reg = makeRegistry();
  registerArchitectResearchHandler(reg, {
    A: s.A, kb: s.kb, proposalStore: s.proposalStore, pickDispatcher: s.pickDispatcher,
    onReportProduced: (r) => s.calls.onReport.push(r),
  });
  const result = await reg.get("architect_research")({
    id: "JOB-77",
    payload: {
      cadence_kind: "weekly",
      cadence_config: { dispatcher: "stub", report_enabled: true },
    },
  });
  check("onReportProduced fired once", s.calls.onReport.length, 1);
  check("returned pass_id",     result.pass_id,    "PASS-weekly-1");
  check("returned report_id",   result.report_id,  "REP-9001");
  check("returned cadence_kind",result.cadence_kind, "weekly");
  check("returned dispatcher",  result.dispatcher,  "stub");
}

group("handler — report_enabled=false → onReportProduced NOT fired");
{
  const s = buildStubs();
  const reg = makeRegistry();
  registerArchitectResearchHandler(reg, {
    A: s.A, kb: s.kb, proposalStore: s.proposalStore, pickDispatcher: s.pickDispatcher,
    onReportProduced: (r) => s.calls.onReport.push(r),
  });
  const result = await reg.get("architect_research")({
    id: "JOB-78",
    payload: { cadence_kind: "daily", cadence_config: { report_enabled: false } },
  });
  check("onReportProduced NOT fired", s.calls.onReport.length, 0);
  check("report_id is null", result.report_id, null);
  check("pass_id still returned", result.pass_id, "PASS-daily-1");
}

group("handler — missing payload fields → throws");
{
  const s = buildStubs();
  const reg = makeRegistry();
  registerArchitectResearchHandler(reg, {
    A: s.A, kb: s.kb, proposalStore: s.proposalStore, pickDispatcher: s.pickDispatcher,
  });
  const fn = reg.get("architect_research");
  let threwNoKind = false;
  try { await fn({ id: "JOB-79", payload: { cadence_config: {} } }); } catch { threwNoKind = true; }
  ok("throws on missing cadence_kind", threwNoKind);

  let threwNoConfig = false;
  try { await fn({ id: "JOB-80", payload: { cadence_kind: "daily" } }); } catch { threwNoConfig = true; }
  ok("throws on missing cadence_config", threwNoConfig);
}

group("handler — onReportProduced throwing does NOT fail the job");
{
  const s = buildStubs();
  const reg = makeRegistry();
  registerArchitectResearchHandler(reg, {
    A: s.A, kb: s.kb, proposalStore: s.proposalStore, pickDispatcher: s.pickDispatcher,
    onReportProduced: () => { throw new Error("simulated UI hook crash"); },
  });
  const result = await reg.get("architect_research")({
    id: "JOB-81",
    payload: { cadence_kind: "monthly", cadence_config: { report_enabled: true } },
  });
  ok("job still returned a result", !!result.pass_id);
  // The throw is swallowed + warned; if it had propagated, this test would have failed in the assert above.
}

group("registerArchitectResearchHandler — dep validation");
{
  const reg = makeRegistry();
  let t = 0;
  try { registerArchitectResearchHandler(); }                              catch { t += 1; }
  try { registerArchitectResearchHandler(reg);  }                          catch { t += 1; }
  try { registerArchitectResearchHandler(reg, { A: {} }); }                catch { t += 1; }
  try { registerArchitectResearchHandler(reg, { A: {}, kb: {} }); }        catch { t += 1; }
  try { registerArchitectResearchHandler(reg, { A: {}, kb: {}, proposalStore: {} }); } catch { t += 1; }
  ok("5 missing-dep variants all throw", t === 5);
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
