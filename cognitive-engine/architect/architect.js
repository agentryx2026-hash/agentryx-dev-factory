/**
 * Master Architect orchestrator.
 *
 * On each research pass:
 *   1. read Standing Orders (Tab 1 baseline + Tab 2 custom_direction)
 *   2. start a Pass record in the KB
 *   3. dispatch researcher with priority-weighted budget (from custom_direction)
 *   4. ingest findings into the KB
 *   5. convert findings to Proposals via Phase 15-A's store
 *   6. finish the Pass record
 *
 * The orchestrator is dependency-injected — researcher, KB, proposer, and
 * proposal store are all passed in. This keeps Phase 21-A substrate
 * deterministic (stub researcher; real flow logic).
 */

import { applyBaselineDefaults } from "./types.js";

/**
 * @param {Object} init
 * @param {ReturnType<import("./kb.js").createKnowledgeBase>} init.kb
 * @param {ReturnType<import("./researcher.js").createResearcher>} init.researcher
 * @param {ReturnType<import("./proposer.js").createArchitectProposer>} init.proposer
 */
export function createArchitect(init) {
  if (!init?.kb) throw new Error("architect: kb required");
  if (!init?.researcher) throw new Error("architect: researcher required");
  if (!init?.proposer) throw new Error("architect: proposer required");

  return {
    /**
     * Run a research pass.
     *
     * @param {"boot"|"daily"|"manual"|"founder_priority_update"} passKind
     * @param {Object} [opts]
     * @returns {Promise<{
     *   pass: object, findings_count: number, proposals_count: number,
     *   cost_usd: number, by_area: Record<string, object>,
     * }>}
     */
    async runPass(passKind, opts = {}) {
      const standingOrders = await init.kb.readStandingOrders();
      if (!standingOrders) {
        return {
          pass: null,
          skipped: true,
          reason: "no _kb/standing_orders.json — write one before running passes",
        };
      }
      const customDirection = standingOrders.custom_direction;
      if (!customDirection?.priority_areas?.length) {
        return {
          pass: null,
          skipped: true,
          reason: "standing_orders.custom_direction.priority_areas missing or empty",
        };
      }

      const baseline = applyBaselineDefaults(standingOrders.baseline || {});
      const summary = await init.kb.summary();
      const pass = await init.kb.startPass(passKind, opts);

      let result;
      try {
        result = await init.researcher.runPass({
          pass_id: pass.id,
          standing_orders: standingOrders,
          custom_direction: customDirection,
          baseline,
          watch: customDirection.strategic_watch || [],
          kb_summary: summary,
        });
      } catch (err) {
        await init.kb.finishPass(pass.id, {
          status: "failed",
          error: err?.message || String(err),
        });
        return {
          pass: { ...pass, status: "failed", error: err?.message || String(err) },
          findings_count: 0,
          proposals_count: 0,
          cost_usd: 0,
          by_area: {},
        };
      }

      // Persist findings to KB
      const recordedFindings = [];
      for (const f of result.findings || []) {
        const recorded = await init.kb.appendFinding({
          pass_id: pass.id,
          content: f.content,
          sources: f.sources,
          kind: f.kind,
          target_id: f.target_id,
          priority_area: f.priority_area,
          produced_by: f.produced_by,
        });
        recordedFindings.push({ ...recorded, target_name: f.target_name, target_category: f.target_category });
      }

      // Auto-create Targets for new-tool findings that name a target
      for (const f of recordedFindings) {
        if (f.kind === "new-tool" && f.target_name && !f.target_id) {
          try {
            await init.kb.addTarget({
              name: f.target_name,
              category: f.target_category || "external_tool",
              status: "identified",
              priority_area: f.priority_area,
              notes: `Auto-created from finding ${f.id} (${pass.id})`,
            });
          } catch { /* duplicate or other; ignore in 21-A */ }
        }
      }

      // Generate proposals from findings
      let proposalResult;
      try {
        proposalResult = await init.proposer.fromFindings(recordedFindings);
      } catch (err) {
        await init.kb.finishPass(pass.id, {
          status: "partial",
          findings_count: recordedFindings.length,
          proposals_emitted: 0,
          cost_usd: result.total_cost_usd,
          error: `proposer failed: ${err?.message || String(err)}`,
        });
        return {
          pass: { ...pass, status: "partial" },
          findings_count: recordedFindings.length,
          proposals_count: 0,
          cost_usd: result.total_cost_usd,
          by_area: result.by_area,
        };
      }

      const finished = await init.kb.finishPass(pass.id, {
        status: "succeeded",
        findings_count: recordedFindings.length,
        proposals_emitted: proposalResult.proposals.length,
        cost_usd: result.total_cost_usd,
      });

      return {
        pass: finished,
        findings_count: recordedFindings.length,
        proposals_count: proposalResult.proposals.length,
        proposals_by_kind: proposalResult.by_kind,
        cost_usd: result.total_cost_usd,
        by_area: result.by_area,
      };
    },
  };
}
