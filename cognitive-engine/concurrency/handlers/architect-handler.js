/**
 * Phase 21-B.2 — `architect_research` queue handler.
 *
 * Wraps Phase 21-A's architect orchestrator (`createArchitect.runPass`)
 * so it can run as a Phase 14-A queue job instead of inline inside
 * the cadence daemon's setInterval tick.
 *
 * Why move the work into the queue:
 *   - **Crash resilience**: a long-running cadence pass (real LLM
 *     dispatcher, ~minutes) used to run inside the daemon's tick. If
 *     the daemon process restarted mid-pass, the work was lost. As a
 *     queue job, the lease timeout (Phase 14-A) re-enqueues an orphaned
 *     in-flight job on the next boot.
 *   - **Concurrency safety**: the daemon ticks every minute. Three
 *     cadences (daily/weekly/monthly) firing close together used to
 *     serialize inside the same tick. As queue jobs, the worker pool
 *     (parallelism=2 default) lets monthly and weekly cycles overlap
 *     without blocking each other.
 *   - **Observability**: in-flight architect cycles show up in the
 *     Admin · Configuration → Queue panel alongside pipeline jobs.
 *     Same UI surface, same status transitions.
 *
 * Why a flag (USE_ARCHITECT_QUEUE) gates the switch:
 *   - The inline path is battle-tested in Phase 21-A.1. The enqueue
 *     path is new. Default off → cadence daemon keeps running passes
 *     inline. Flip on per environment when comfortable.
 *
 * This module deliberately re-implements the same report-synthesis
 * logic that telemetry.mjs's `runCadencePass` used inline. When 21-B.2
 * is the only path (USE_ARCHITECT_QUEUE permanently true), the inline
 * body in telemetry.mjs can be deleted entirely.
 *
 * Phase 16-B / 17-B / 19-B's eventual handlers register on the same
 * registry. The pattern (one module per handler kind) keeps the
 * queue substrate unaware of any specific work type — same as D139.
 */

/**
 * Run one architect pass and optionally synthesize a cycle report.
 * Pure function — does NOT touch telemetry or the queue. Tests inject
 * stubs for every dependency.
 *
 * @param {object} args
 * @param {object} args.A                       result of loadArchitect()
 * @param {object} args.kb                      knowledge base (already constructed)
 * @param {object} args.proposalStore           Phase 15-A proposal store (already constructed)
 * @param {string} args.cadenceKind             "daily" | "weekly" | "monthly"
 * @param {object} args.cadenceConfig           cadence config from Standing Orders
 * @param {Function} args.pickDispatcher        (A, dispatcherKey) → dispatcher instance
 * @returns {Promise<{ pass: object, report?: object }>}
 */
export async function runArchitectPass({ A, kb, proposalStore, cadenceKind, cadenceConfig, pickDispatcher }) {
  if (!A?.createArchitect) throw new Error("runArchitectPass: A.createArchitect required");
  if (!kb?.writeReport) throw new Error("runArchitectPass: kb required");
  if (typeof pickDispatcher !== "function") throw new Error("runArchitectPass: pickDispatcher required");

  const proposer = A.createArchitectProposer({ proposalStore, kb });
  const researcher = A.createResearcher({
    dispatchSubagent: pickDispatcher(A, cadenceConfig.dispatcher || "stub"),
    budget_usd_per_pass: cadenceConfig.budget_usd ?? 1.5,
  });
  const architect = A.createArchitect({ kb, researcher, proposer });
  const result = await architect.runPass(cadenceKind, {
    cadence: cadenceKind,
    cadence_config: cadenceConfig,
  });

  if (!cadenceConfig.report_enabled) {
    return { pass: result.pass };
  }

  const findings = await kb.listFindings({ pass_id: result.pass?.id, limit: 200 });
  const sections = [
    {
      heading: `${cadenceKind[0].toUpperCase()}${cadenceKind.slice(1)} cycle summary`,
      kind: "narrative",
      body: `Cadence \`${cadenceKind}\` ran at ${new Date(result.pass?.completed_at || Date.now()).toISOString()}. Produced ${result.findings_count ?? 0} findings, ${result.proposals_count ?? 0} candidate proposals at $${(result.cost_usd ?? 0).toFixed(2)} cost. ${result.cost_usd === 0 ? "_(stub dispatcher — synthetic findings; flip to sonnet/opus for real research.)_" : ""}`,
    },
  ];
  if (findings.length) {
    sections.push({
      heading: "Findings by priority area",
      kind: "list",
      body: findings.map(f => `- **[${f.priority_area || "untagged"}]** ${f.content || "(no content)"}`).join("\n"),
    });
  }
  if (cadenceKind === "monthly") {
    sections.push({
      heading: "Criteria health check",
      kind: "criteria-health",
      body: `_(stub)_ Architect should review the priority-area set against shipped modules and propose adding/removing/renaming areas. Real dispatcher fills this with substance.`,
    });
  }
  const report = await kb.writeReport({
    kind: "cycle",
    cadence: cadenceKind,
    pass_id: result.pass?.id,
    title: `${cadenceKind[0].toUpperCase()}${cadenceKind.slice(1)} cycle — ${new Date().toISOString().slice(0, 10)}`,
    summary: `Architect ${cadenceKind} cycle: ${result.findings_count ?? 0} findings, ${result.proposals_count ?? 0} proposals.`,
    sections,
    linked_findings: findings.map(f => f.id),
    linked_proposals: [],
    cost_usd: result.cost_usd ?? 0,
  });
  return { pass: result.pass, report };
}

/**
 * Register the `architect_research` handler on a Phase 14-A registry.
 * Idempotent: re-registering replaces the prior handler.
 *
 * Handler reads `job.payload`:
 *   - `cadence_kind`: "daily" | "weekly" | "monthly"
 *   - `cadence_config`: full cadence object from Standing Orders
 *
 * Side-effects:
 *   - Writes findings + proposals into kb / proposalStore (already
 *     scoped by `runArchitectPass`).
 *   - Writes a cycle report if `cadence_config.report_enabled`.
 *   - Calls `onReportProduced(report)` if a report was created.
 *
 * Sentinel project_id `architect` is what the cadence daemon stamps
 * on enqueue (architect cycles aren't per-project). Quota gate
 * (D212) silently passes when no `project:architect` threshold is
 * configured — which is the v0.0.1 default. Add such a threshold to
 * cap total architect spend if needed.
 *
 * @param {object} registry                        result of createHandlerRegistry()
 * @param {object} deps
 * @param {object} deps.A                          loadArchitect() result
 * @param {object} deps.kb                         constructed KB
 * @param {object} deps.proposalStore              constructed proposal store
 * @param {Function} deps.pickDispatcher           (A, dispatcherKey) → dispatcher
 * @param {(report: object) => void} [deps.onReportProduced]
 *   Called after a report is written (analog of cadence daemon's hook).
 *   The handler intentionally tolerates a missing callback so it works
 *   in test contexts.
 */
export function registerArchitectResearchHandler(registry, deps = {}) {
  if (!registry?.register) throw new Error("registerArchitectResearchHandler: registry required");
  if (!deps.A) throw new Error("registerArchitectResearchHandler: deps.A (loadArchitect result) required");
  if (!deps.kb) throw new Error("registerArchitectResearchHandler: deps.kb required");
  if (!deps.proposalStore) throw new Error("registerArchitectResearchHandler: deps.proposalStore required");
  if (typeof deps.pickDispatcher !== "function") throw new Error("registerArchitectResearchHandler: deps.pickDispatcher required");

  registry.register("architect_research", async (job /*, ctx */) => {
    const cadenceKind = job.payload?.cadence_kind;
    const cadenceConfig = job.payload?.cadence_config;
    if (!cadenceKind) throw new Error(`architect_research job ${job.id}: payload.cadence_kind required`);
    if (!cadenceConfig || typeof cadenceConfig !== "object") {
      throw new Error(`architect_research job ${job.id}: payload.cadence_config required`);
    }

    const result = await runArchitectPass({
      A: deps.A,
      kb: deps.kb,
      proposalStore: deps.proposalStore,
      cadenceKind,
      cadenceConfig,
      pickDispatcher: deps.pickDispatcher,
    });

    if (result.report && deps.onReportProduced) {
      try { deps.onReportProduced(result.report); } catch (err) {
        console.warn(`[architect_research] onReportProduced threw:`, err?.message || err);
      }
    }

    return {
      pass_id: result.pass?.id || null,
      report_id: result.report?.id || null,
      cadence_kind: cadenceKind,
      dispatcher: cadenceConfig.dispatcher || "stub",
    };
  });

  return registry;
}

export const ARCHITECT_RESEARCH_KIND = "architect_research";
