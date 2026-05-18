/**
 * Researcher — dispatches research subagents with priority-weighted prompts.
 *
 * Phase 21-A ships the orchestration layer (which areas get scanned, how
 * the budget splits, what the prompt template looks like). The actual
 * subagent dispatch is dependency-injected via `init.dispatchSubagent`.
 *
 * Reads `custom_direction.priority_areas` for the weighted dispatch and
 * `baseline.daily_budget_usd` (when provided by the caller) for the total
 * pass budget. Per-area budget = total × (weight / Σ weights).
 *
 * Phase 21-B wires the real subagent dispatch (Sonnet via OpenRouter, with
 * web-search tools). For 21-A smoke tests, a stub dispatcher returns
 * deterministic findings.
 */

import { isValidPriorityArea, computeAttentionBudget, nowIso } from "./types.js";

const DEFAULT_BUDGET_USD_PER_PASS = 1.5;

/**
 * @param {Object} init
 * @param {(args: object) => Promise<object>} init.dispatchSubagent
 * @param {number} [init.budget_usd_per_pass=1.5]
 */
export function createResearcher(init) {
  if (!init?.dispatchSubagent) throw new Error("researcher: init.dispatchSubagent required");
  const fallbackBudget = init.budget_usd_per_pass ?? DEFAULT_BUDGET_USD_PER_PASS;

  return {
    /**
     * Run a full research pass split across priority areas.
     *
     * @param {Object} args
     * @param {string} args.pass_id
     * @param {object} [args.standing_orders]   full Standing Orders blob (optional)
     * @param {object} args.custom_direction    custom_direction section with priority_areas
     * @param {object} [args.baseline]           baseline section with daily_budget_usd
     * @param {Array} [args.watch]               typically custom_direction.strategic_watch
     * @param {Object} args.kb_summary           result of kb.summary()
     */
    async runPass({ pass_id, custom_direction, baseline, watch, kb_summary }) {
      if (!pass_id) throw new Error("researcher.runPass: pass_id required");
      if (!custom_direction?.priority_areas?.length) {
        throw new Error("researcher.runPass: custom_direction.priority_areas required");
      }

      // Use baseline budget if provided; fall back to constructor default
      const totalBudget = typeof baseline?.daily_budget_usd === "number"
        ? baseline.daily_budget_usd
        : fallbackBudget;

      const budget = computeAttentionBudget({ custom_direction });
      if (!budget) throw new Error("researcher.runPass: priorities have invalid weight set");

      const t0 = Date.now();
      const allFindings = [];
      const byArea = {};
      let totalCost = 0;

      for (const area of custom_direction.priority_areas) {
        if (!isValidPriorityArea(area.id)) continue;
        const fraction = budget[area.id] || 0;
        const areaBudget = Math.round(totalBudget * fraction * 1_000_000) / 1_000_000;

        let result;
        try {
          result = await init.dispatchSubagent({
            area: area.id,
            weight: area.weight,
            current_state: area.current_state,
            target_3mo: area.target_3mo,
            target_6mo: area.target_6mo,
            hard_constraints: area.hard_constraints || [],
            anti_goals: area.anti_goals || [],
            directions: area.research_directions || [],
            watch: (watch || []).filter(w => !w.priority_area || w.priority_area === area.id),
            budget_usd: areaBudget,
            research_depth: baseline?.research_depth,
            kb_summary,
          });
        } catch (err) {
          byArea[area.id] = { findings_count: 0, cost_usd: 0, error: err?.message || String(err) };
          continue;
        }

        const findings = (result?.findings || []).map(f => ({
          ...f,
          priority_area: area.id,
          produced_by: result.produced_by || "researcher:subagent",
          produced_at: nowIso(),
        }));
        const cost = result?.cost_usd || 0;
        totalCost += cost;
        byArea[area.id] = { findings_count: findings.length, cost_usd: cost };
        allFindings.push(...findings);
      }

      return {
        pass_id,
        total_cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
        total_duration_ms: Date.now() - t0,
        total_findings: allFindings.length,
        by_area: byArea,
        findings: allFindings,
      };
    },
  };
}

/**
 * Stub dispatcher for Phase 21-A smoke. Produces deterministic findings
 * keyed off the priority area id so tests can assert specific behavior
 * without burning real LLM/research budget.
 *
 * Phase 21-B replaces this with a Sonnet-backed web-search subagent.
 */
export function createStubDispatcher({ findings_per_area = 1 } = {}) {
  return async ({ area, weight, directions, watch, budget_usd }) => {
    const findings = [];
    for (let i = 0; i < findings_per_area; i++) {
      findings.push({
        content: `Stub finding ${i + 1} for area "${area}" (weight=${weight}, budget=$${budget_usd}). Directions sampled: ${(directions || []).slice(0, 2).join("; ") || "none"}.`,
        sources: ["https://example.invalid/stub"],
        kind: "info",
        target_name: `Stub-${area}-${i + 1}`,
        target_category: area,
      });
    }
    return {
      findings,
      cost_usd: 0,
      duration_ms: 1,
      produced_by: "researcher:stub",
    };
  };
}
