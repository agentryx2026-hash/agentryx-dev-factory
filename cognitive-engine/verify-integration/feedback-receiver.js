import { validateFeedbackPayload } from "./types.js";

/**
 * Handle a feedback payload from the Verify portal.
 *
 * Steps:
 *  1. Validate payload shape.
 *  2. Write a user_note observation to the memory layer (Phase 7-A).
 *  3. Compute a FixRoute (stub in 9-A; 9-B wires real agent routing).
 *  4. Return a summary + trace.
 *
 * No exceptions are thrown for invalid payloads — caller gets {ok: false, error} so
 * the HTTP handler (Phase 9-B) can 400 cleanly without try/catch.
 *
 * @param {import("./types.js").FeedbackPayload} payload
 * @param {object} deps
 * @param {{addObservation: Function}} deps.memory
 * @param {string} deps.projectId                  project scope for observations
 * @param {(route: import("./types.js").FixRoute) => Promise<any>} [deps.fixRouter]   optional real router
 */
export async function handleFeedback(payload, deps) {
  const validationError = validateFeedbackPayload(payload);
  if (validationError) {
    return { ok: false, error: validationError };
  }
  if (!deps?.memory?.addObservation) return { ok: false, error: "deps.memory.addObservation required" };
  if (!deps?.projectId) return { ok: false, error: "deps.projectId required" };

  const observation = await deps.memory.addObservation({
    kind: "user_note",
    scope: `project:${deps.projectId}`,
    content: renderObservationContent(payload),
    tags: buildTags(payload),
    refs: {
      run_id: payload.build_id,
    },
    produced_by: {
      agent: `human:${payload.reviewer}`,
      source: "verify_portal",
    },
  });

  const route = planFixRoute(payload);
  let routerResult = null;
  if (route.lane !== "none") {
    if (deps.fixRouter) {
      try {
        routerResult = await deps.fixRouter(route);
      } catch (err) {
        routerResult = { ok: false, error: err.message };
      }
    } else {
      routerResult = { stubbed: true, note: "Phase 9-A — fixRouter is a stub; 9-B wires real agent routing" };
    }
  }

  return {
    ok: true,
    observation_id: observation.id,
    route,
    router_result: routerResult,
  };
}

function renderObservationContent(p) {
  const parts = [
    `**Verify review decision**: ${p.decision}`,
    p.review_item_id ? `**Review item**: ${p.review_item_id}` : null,
    p.requirement_id ? `**Requirement**: ${p.requirement_id}` : null,
    p.comments ? `\n${p.comments}` : null,
    p.screenshot_urls?.length ? `\n**Screenshots**:\n${p.screenshot_urls.map(u => `- ${u}`).join("\n")}` : null,
  ].filter(Boolean);
  return parts.join("\n");
}

function buildTags(p) {
  const tags = ["verify", `decision:${p.decision}`];
  if (p.requirement_id) tags.push(`req:${p.requirement_id}`);
  return tags;
}

/**
 * Decide which fix lane a reviewer's feedback should route to.
 * Heuristic; 9-B may replace with LLM classification.
 */
export function planFixRoute(payload) {
  if (payload.decision === "pass") return { lane: "none", reason: "passed; no fix required" };

  const txt = String(payload.comments || "").toLowerCase();
  const isTestComplaint = /(test|coverage|edge case|missing test)/.test(txt);
  const isDocComplaint = /(doc|readme|typo|grammar|unclear writing)/.test(txt);
  const isScopeComplaint = /(scope|requirement|spec|incorrect behavior)/.test(txt);

  if (isDocComplaint) return { lane: "docs", agent: "data", reason: "doc-quality complaint" };
  if (isTestComplaint) return { lane: "tests", agent: "tuvok", reason: "test-coverage complaint" };
  if (isScopeComplaint) return { lane: "triage", agent: "picard", reason: "scope clarification needed" };
  return { lane: "code", agent: "spock", reason: "default to code fix cycle" };
}
