import path from "node:path";
import { listArtifacts } from "../artifacts/store.js";

/**
 * Build a BuildBundle from a project's artifact store.
 *
 * Current v1 heuristic:
 *  - Each `qa_report` artifact becomes ≥1 ReviewItem (one per embedded failure if
 *    structured, otherwise one "verify test report" item).
 *  - `code_output` + `pmd_doc` artifacts become ReviewItems of category=manual
 *    for spot-check review.
 *  - `architect_review` artifacts attach as `release_notes`.
 *
 * @param {string} projectDir                absolute path to project under agent-workspace
 * @param {object} params
 * @param {string} params.build_id
 * @param {string} [params.version]
 * @param {string} [params.preview_url]
 * @param {string} [params.agent_trace_url]
 * @returns {Promise<import("./types.js").BuildBundle>}
 */
export async function buildBundle(projectDir, params) {
  if (!params?.build_id) throw new Error("buildBundle: build_id required");
  const all = await listArtifacts(projectDir);

  const review_items = [];
  let nextId = 1;
  const makeId = () => `RI-${String(nextId++).padStart(4, "0")}`;

  const releaseNotesParts = [];
  const screenshotArtifactIds = [];

  for (const a of all) {
    if (a.kind === "qa_report") {
      review_items.push({
        id: makeId(),
        requirement_id: a.meta?.requirement_id || "",
        title: `QA report review — ${a.id}`,
        description: "Automated QA report produced by Tuvok. Verify coverage + spot-check failures.",
        artifact_id: a.id,
        category: "automated",
        test_steps: ["Open attached qa_report artifact", "Confirm all listed test cases are reasonable", "Confirm reported failures are genuine (not false positives)"],
      });
    } else if (a.kind === "code_output") {
      review_items.push({
        id: makeId(),
        title: `Code review — ${a.id}`,
        description: "Spot-check generated code quality, structure, and alignment with scope.",
        artifact_id: a.id,
        category: "manual",
      });
    } else if (a.kind === "pmd_doc") {
      review_items.push({
        id: makeId(),
        title: `PMD doc review — ${a.id}`,
        description: "Verify the PMD document matches the scope and is usable downstream.",
        artifact_id: a.id,
        category: "manual",
      });
    } else if (a.kind === "architect_review") {
      releaseNotesParts.push(`- ${a.id}`);
    } else if (a.meta?.is_screenshot || a.kind === "pmd_doc" && a.content_ref?.endsWith(".png")) {
      screenshotArtifactIds.push(a.id);
    }
  }

  return {
    build_id: params.build_id,
    project_id: path.basename(projectDir),
    version: params.version || params.build_id,
    produced_at: new Date().toISOString(),
    preview_url: params.preview_url,
    agent_trace_url: params.agent_trace_url,
    release_notes: releaseNotesParts.length
      ? `Includes architect reviews:\n${releaseNotesParts.join("\n")}`
      : undefined,
    review_items,
    screenshot_artifact_ids: screenshotArtifactIds.length ? screenshotArtifactIds : undefined,
  };
}
