/**
 * Architect proposer — converts findings into Phase 15-A Proposals (D192).
 *
 * Three architect-owned proposal kinds (Phase 21-A D190, extending 15-A):
 *
 *   - tool_adoption     change.target = "tool:<scope>:<tool-id>"  (scope: stable | playground)
 *                       Founder-gated.
 *   - kb_update         change.target = "kb:<class>:<id>"          (class: target | gap | finding)
 *                       Auto-approve eligible (low-stakes).
 *   - research_finding  change.target = "kb:findings:F-<seq>"       (always low-stakes)
 *                       Auto-approve.
 *
 * The proposer here is a thin classifier + builder. It does NOT call LLMs;
 * it inspects findings and turns them into proposal drafts. The store
 * (Phase 15-A) then runs the lifecycle.
 */

import { isValidFindingKind } from "./types.js";

const FINDING_KIND_TO_PROPOSAL = Object.freeze({
  // Each finding kind maps to a default proposal kind. Architect
  // can override per-finding by providing meta.proposal_kind.
  "info":              "research_finding",
  "upgrade-available": "tool_adoption",
  "new-tool":          "tool_adoption",
  "deprecation":       "tool_adoption",
  "security":          "research_finding",   // recorded but founder-reviewed via portal
});

/**
 * @param {Object} init
 * @param {Object} init.proposalStore       Phase 15-A store (createProposalStore output)
 * @param {Object} init.kb                   architect KB
 * @param {string} [init.created_by="proposer:architect"]
 */
export function createArchitectProposer(init) {
  if (!init?.proposalStore) throw new Error("architect.proposer: init.proposalStore required");
  if (!init?.kb) throw new Error("architect.proposer: init.kb required");
  const createdBy = init.created_by || "proposer:architect";

  function classify(finding) {
    if (!isValidFindingKind(finding.kind)) return "research_finding";
    return FINDING_KIND_TO_PROPOSAL[finding.kind] || "research_finding";
  }

  function buildToolAdoptionProposal(finding) {
    const slug = (finding.target_name || "unknown").toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
    const scope = finding.kind === "deprecation" ? "stable" : "playground";
    return {
      kind: "tool_adoption",
      change: {
        target: `tool:${scope}:${slug}`,
        from: finding.target_id || "(none)",
        to: `${finding.target_name || slug} — ${finding.kind}`,
      },
      rationale: {
        summary: finding.kind === "upgrade-available"
          ? `Upgrade available for ${finding.target_name || slug}`
          : finding.kind === "new-tool"
            ? `New tool surfaced: ${finding.target_name || slug}`
            : `Deprecation flagged for ${finding.target_name || slug}`,
        supporting_observations: [finding.id],
        meta: {
          finding_kind: finding.kind,
          priority_area: finding.priority_area,
          sources: finding.sources || [],
          target_category: finding.target_category,
        },
      },
      created_by: createdBy,
    };
  }

  function buildKbUpdateProposal(finding) {
    return {
      kind: "kb_update",
      change: {
        target: `kb:findings:${finding.id}`,
        from: "",
        to: finding.content.slice(0, 500),
      },
      rationale: {
        summary: `Architect findings observed in area "${finding.priority_area}"`,
        supporting_observations: [finding.id],
        meta: { sources: finding.sources || [], finding_kind: finding.kind },
      },
      created_by: createdBy,
    };
  }

  function buildResearchFindingProposal(finding) {
    return {
      kind: "research_finding",
      change: {
        target: `kb:findings:${finding.id}`,
        from: "",
        to: finding.content.slice(0, 500),
      },
      rationale: {
        summary: `Research finding (${finding.kind}) in area "${finding.priority_area}"`,
        supporting_observations: [finding.id],
        meta: {
          sources: finding.sources || [],
          finding_kind: finding.kind,
          priority_area: finding.priority_area,
        },
      },
      created_by: createdBy,
    };
  }

  /**
   * Convert a list of findings to Proposals via Phase 15-A's store.create.
   *
   * @param {Array<import("./types.js").Finding>} findings
   * @returns {Promise<{ proposals: Array, by_kind: Record<string, number> }>}
   */
  async function fromFindings(findings) {
    if (!Array.isArray(findings)) throw new Error("proposer.fromFindings: array required");
    const proposals = [];
    const byKind = { tool_adoption: 0, kb_update: 0, research_finding: 0 };

    for (const f of findings) {
      const kind = classify(f);
      let draft;
      if (kind === "tool_adoption") draft = buildToolAdoptionProposal(f);
      else if (kind === "kb_update") draft = buildKbUpdateProposal(f);
      else draft = buildResearchFindingProposal(f);

      const created = await init.proposalStore.create(draft);
      proposals.push(created);
      byKind[kind] = (byKind[kind] || 0) + 1;
    }

    return { proposals, by_kind: byKind };
  }

  return { classify, fromFindings };
}

/**
 * Architect-side applier hook. Routed via Phase 15-A's applyProposal when
 * ctx.architectApplier is provided. Handles tool_adoption / kb_update /
 * research_finding by writing to the KB and (for tool_adoption) optionally
 * registering a marketplace experimental profile.
 */
export function createArchitectApplier({ kb, marketplace } = {}) {
  if (!kb) throw new Error("architectApplier: kb required");

  return {
    async apply(proposal /*, ctx */) {
      switch (proposal.kind) {
        case "research_finding":
          // Already recorded as a Finding when the pass ran; the proposal
          // itself is the audit trail. Nothing extra to do.
          return {
            kind: "research_finding",
            audited_only: true,
            finding_ref: proposal.change.target,
          };
        case "kb_update": {
          const summary = {
            kind: "kb_update",
            target: proposal.change.target,
            recorded_at: new Date().toISOString(),
          };
          // Future: parse target and write to kb.addTarget / kb.addGap / etc.
          return summary;
        }
        case "tool_adoption": {
          // Phase 21-A applies by registering (or noting) a marketplace
          // experimental profile. Phase 21-B will actually fetch + install.
          const marker = {
            kind: "tool_adoption",
            target: proposal.change.target,
            recorded_at: new Date().toISOString(),
          };
          if (marketplace?.has?.(proposal.change.target.replace("tool:", "playground."))) {
            marker.note = "marketplace already has the experimental profile";
          }
          return marker;
        }
        default:
          throw new Error(`architectApplier: unknown kind "${proposal.kind}"`);
      }
    },
  };
}
