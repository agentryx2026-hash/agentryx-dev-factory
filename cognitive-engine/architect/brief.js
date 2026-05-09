/**
 * Founder R&D Brief composer + runner.
 *
 * Phase 21-A.1 (added 2026-05-09 alongside the Platform Evolution Roadmap).
 *
 * A "brief" is a structured prompt the founder submits via the R&D Brief tab
 * — title + role + background + research_question + trigger + constraints +
 * output_format + references + budget. We compose those fields into a
 * standard Anthropic-style research prompt, spawn a `founder_brief` pass via
 * the architect orchestrator, and (when the pass produces findings) write
 * one Report back into the KB tagged `kind: "brief"`.
 *
 * The dispatcher is the same one configured in Standing Orders (today: stub;
 * Phase 21-B: real Sonnet). The brief.js layer only handles composition +
 * pass orchestration — it doesn't know how research is actually performed.
 */

import { nowIso } from "./types.js";

/**
 * Compose the 8-field form into a structured prompt string. Order is
 * deliberate (Anthropic best practice — long context first, instructions
 * second, task last). The returned string is what the dispatcher receives
 * as its `area_prompt` for the founder_brief pass.
 */
export function composeBriefPrompt(brief) {
  const lines = [];
  lines.push(`# Role`);
  lines.push(brief.role || "Senior research analyst specializing in agentic AI infrastructure.");
  lines.push("");

  if (brief.background?.trim()) {
    lines.push(`# Background / Context`);
    lines.push(brief.background.trim());
    lines.push("");
  }

  if (brief.trigger?.trim()) {
    lines.push(`# Why now / Trigger`);
    lines.push(brief.trigger.trim());
    lines.push("");
  }

  if (brief.constraints?.trim()) {
    lines.push(`# Constraints / Scope`);
    lines.push(brief.constraints.trim());
    lines.push("");
  }

  if (Array.isArray(brief.references) && brief.references.length) {
    lines.push(`# Anchors / References`);
    for (const r of brief.references) lines.push(`- ${r}`);
    lines.push("");
  }

  lines.push(`# Output format`);
  lines.push(brief.output_format || "Decision memo (1-page, ranked options + rationale).");
  lines.push("");

  lines.push(`# Research question`);
  lines.push(brief.research_question);
  lines.push("");

  lines.push(`# Deliverable`);
  lines.push("Produce a structured report that directly answers the research question. Use the requested output format. Tie every recommendation to a specific part of our current architecture (named module / phase / decision id) so the founder can act on it without further translation.");
  return lines.join("\n");
}

/**
 * Run a brief: writes the brief to the KB (status=queued), spawns a
 * founder_brief pass, captures findings, generates a brief Report, and
 * marks the brief completed. Returns the final {brief, pass, report}.
 *
 * Dependencies are injected for testability:
 *   - kb            (writeBrief / updateBrief / writeReport)
 *   - architect     (createArchitect — its runPass triggers the dispatcher)
 *   - briefInput    (the 8-field form payload from the UI)
 */
export async function runBrief({ kb, architect, briefInput }) {
  // 1) Persist the brief in queued state
  let brief = await kb.writeBrief({ ...briefInput, status: "queued" });

  // 2) Mark running
  brief = await kb.updateBrief(brief.id, {
    status: "running",
    started_at: nowIso(),
  });

  // 3) Compose the prompt + spawn a founder_brief pass.
  // The architect's runPass currently fans out across all 6 priority areas.
  // For a brief we want SCOPED research — only the priority_area the
  // founder tagged (or "tools" as a sensible default). We pass it as
  // an opts hint; researcher.js falls back to weighted dispatch if absent.
  const composedPrompt = composeBriefPrompt(brief);
  let result;
  try {
    result = await architect.runPass("founder_brief", {
      brief_id: brief.id,
      brief_prompt: composedPrompt,
      brief_area: brief.priority_area || null,
      brief_budget_usd: brief.budget_usd || 3,
    });
  } catch (err) {
    await kb.updateBrief(brief.id, {
      status: "failed",
      error: err?.message || String(err),
      finished_at: nowIso(),
    });
    throw err;
  }

  if (result?.skipped) {
    // Standing Orders missing — brief can't run
    await kb.updateBrief(brief.id, {
      status: "failed",
      error: result.reason || "pass skipped",
      finished_at: nowIso(),
    });
    return { brief: await kb.readBrief(brief.id), pass: null, report: null };
  }

  // 4) Build a Report from the pass result. With the stub dispatcher, the
  // findings are synthetic — but the report SHAPE is correct, so the UI
  // can render it. Phase 21-B replaces the dispatcher; the report shape
  // stays.
  const passId = result?.pass?.id;
  const findingsCount = result?.findings_count ?? 0;
  const proposalsCount = result?.proposals_count ?? 0;
  const costUsd = result?.cost_usd ?? 0;

  // Pull linked findings + proposals (recent ones tagged with this pass)
  const allFindings = await kb.listFindings({ pass_id: passId, limit: 100 });
  const linkedFindings = allFindings.map(f => f.id);

  const sections = [
    {
      heading: "Summary",
      kind: "narrative",
      body: `Architect ran a focused research pass on: "${brief.research_question}". Produced ${findingsCount} findings and ${proposalsCount} candidate proposals at $${costUsd.toFixed(2)} cost. ${result?.cost_usd === 0 ? "_(stub dispatcher — synthetic findings; replace with Phase 21-B real Sonnet for live ecosystem research.)_" : ""}`,
    },
  ];

  if (allFindings.length) {
    sections.push({
      heading: "Findings",
      kind: "list",
      body: allFindings
        .map(f => `- **[${f.priority_area || "untagged"}]** ${f.content || "(no content)"}`)
        .join("\n"),
    });
  }

  if (brief.background) {
    sections.push({
      heading: "Brief context",
      kind: "narrative",
      body: brief.background,
    });
  }

  sections.push({
    heading: "Recommendation",
    kind: "recommendation",
    body: `Review the linked proposals; approve the ones that align with current Standing Orders. Architect-emitted research_finding kinds capture the raw observations; tool_adoption kinds need founder approval before applying.`,
  });

  const report = await kb.writeReport({
    kind: "brief",
    cadence: null,
    pass_id: passId,
    brief_id: brief.id,
    title: brief.title,
    summary: `Brief report: ${brief.title}`,
    sections,
    linked_findings: linkedFindings,
    linked_proposals: [], // store doesn't filter by pass yet — left empty for v1
    cost_usd: costUsd,
  });

  // 5) Mark brief completed + linked
  brief = await kb.updateBrief(brief.id, {
    status: "completed",
    pass_id: passId,
    report_id: report.id,
    finished_at: nowIso(),
  });

  return { brief, pass: result.pass, report };
}
