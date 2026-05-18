/**
 * Founder Proposal Portal — read-only listing for the founder review surface.
 *
 * Phase 21-A ships the API; Phase 12-B admin UI (or 21-B's dedicated portal
 * UI) consumes it. The portal sits on top of:
 *   - Phase 15-A proposal store (the proposals themselves)
 *   - Architect KB (findings + targets + priorities for context)
 *   - Phase 14-A queue (recent pass log if available; not required here)
 */

export function createFounderPortal(init) {
  if (!init?.proposalStore) throw new Error("portal: init.proposalStore required");
  if (!init?.kb) throw new Error("portal: init.kb required");

  return {
    /**
     * Headline counts for the portal home page.
     */
    async overview() {
      const proposals = await init.proposalStore.list();
      const kbSummary = await init.kb.summary();
      const standingOrders = await init.kb.readStandingOrders();
      const passes = await init.kb.listPasses({ limit: 5 });

      const byKind = {};
      const byState = {};
      for (const p of proposals) {
        byKind[p.kind] = (byKind[p.kind] || 0) + 1;
        byState[p.state] = (byState[p.state] || 0) + 1;
      }

      return {
        priorities_version: standingOrders?.version || null,
        priorities_horizon: standingOrders?.custom_direction?.effective_period?.horizon_label || null,
        proposal_count: proposals.length,
        proposals_by_kind: byKind,
        proposals_by_state: byState,
        kb_summary: kbSummary,
        recent_passes: passes,
      };
    },

    /**
     * List proposals filterable by kind / state / priority_area.
     */
    async listProposals({ kind, state, priority_area, limit = 50 } = {}) {
      const all = await init.proposalStore.list({ kind, state });
      let out = all;
      if (priority_area) {
        out = out.filter(p => p.rationale?.meta?.priority_area === priority_area);
      }
      // newest first
      out.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      return out.slice(0, limit);
    },

    /**
     * Single proposal + linked findings + target context.
     */
    async getProposalDetail(proposalId) {
      const p = await init.proposalStore.get(proposalId);
      if (!p) return null;
      const findingIds = p.rationale?.supporting_observations || [];
      const findings = [];
      for (const fid of findingIds) {
        const all = await init.kb.listFindings({ limit: 1000 });
        const found = all.find(f => f.id === fid);
        if (found) findings.push(found);
      }
      let target = null;
      if (p.kind === "tool_adoption") {
        const slug = p.change.target.replace(/^tool:[^:]+:/, "");
        const targets = await init.kb.listTargets();
        target = targets.find(t =>
          (t.name || "").toLowerCase().replace(/[^a-z0-9.-]+/g, "-") === slug
        ) || null;
      }
      return { proposal: p, findings, target };
    },

    /**
     * Founder approve action. Thin wrapper over Phase 15-A store.
     */
    async approve(proposalId, { reviewer, note } = {}) {
      return init.proposalStore.approve(proposalId, { reviewer, note });
    },

    /**
     * Founder reject action.
     */
    async reject(proposalId, { reviewer, note } = {}) {
      return init.proposalStore.reject(proposalId, { reviewer, note });
    },
  };
}
