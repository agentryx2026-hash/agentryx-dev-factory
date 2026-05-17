/**
 * Phase 13-B — default LLM-backed NodeStub for the replay executor.
 *
 * Phase 13-A shipped the replay executor with a NodeStub interface
 * (`async ({original, parents, new_run_id, project_id}) → {kind, content, ...}`)
 * and synthetic stubs for the smoke test. This module is the default
 * production stub: it takes the original artifact + its resolved
 * parents, asks the LLM to "re-produce this output", and returns a
 * fresh artifact body with real cost + latency.
 *
 * The stub is dependency-injected with `llmCall` so the same code path
 * works against:
 *   - The Phase 2 llm-router (production)
 *   - The Phase 21-B `createLLMDispatcher` (architect-style routing)
 *   - A stub `llmCall` (tests + offline replay)
 *
 * What replay actually does (D162 — replay re-produces, doesn't re-decide):
 *   The replayed artifact MUST be the same `kind` and serve the same
 *   role as the original. The LLM gets the original's content as
 *   "the previous answer to this same prompt" and is asked to produce
 *   a fresh variant (sampled fresh, same task). This is NOT a chance
 *   to re-route or re-decide; it's a chance to see if a different
 *   sample of the same step yields different downstream effects.
 *
 * Cross-pipeline use: if the original artifact came from a graph the
 * caller doesn't recognise, the stub falls back to a generic
 * "reproduce the output" prompt rather than the agent-specific one.
 * Founder can override per-agent prompts via `agentSystemPrompts`.
 */

const GENERIC_SYSTEM_PROMPT = `You are replaying a step from a past factory pipeline run.

You are given:
  - The ORIGINAL output that was produced at this step
  - The PARENT artifacts that fed into this step

Your job: produce a FRESH variant of the same output. Same kind, same
role, same downstream contract — just sampled fresh. Do not re-decide
the architectural direction; do not change scope; produce an output
that could plausibly have been the original.

Output ONLY the artifact body. No commentary, no "here is the replay",
no markdown fences around it unless the original itself used them.`;

const DEFAULT_AGENT_SYSTEM_PROMPTS = Object.freeze({
  picard: `You are Picard, Solution Architect. You are replaying a past architecture step. Produce a fresh A1 brief + A2 architecture in the same shape as the original. Same scope, same project. Output only the documents.`,
  sisko:  `You are Sisko, Project Planner. Replay a past breakdown step: A3 / A4 / A5 in the same shape as the original. Same modules. Output only the documents.`,
  troi:   `You are Troi, Enhancement Analyst. Replay a past 110% step: B4 + B6 in the same shape as the original. Same project. Output only the documents.`,
  jane:   `You are Jane, PM/Triage. Replay a past triageSpec compression. Same input bundle; produce a fresh single-document summary.`,
  spock:  `You are Spock, Auto-Research. Replay a past research dossier. Produce a fresh dossier in the same shape with the same stack picks + patterns + gotchas.`,
  torres: `You are Torres, Junior Dev. Replay the code-writing step. Produce code in the same files for the same scope. Same architecture, same packages, fresh code.`,
  tuvok:  `You are Tuvok, QA Reviewer. Replay the test-suite step. Produce tests against the same code in the same framework. Same coverage shape, fresh tests + verdict.`,
  data:   `You are Data, Sr. Architect. Replay the code-review step. Produce a fresh architectural review in the same shape (VERDICT, ISSUES, SUGGESTIONS, OVERALL_CONFIDENCE).`,
  crusher: `You are Crusher, Documentation. Replay the docs step. Produce a fresh doc in the same kind as the original (B1 / B2 / B5 / C1 / C2 / C3).`,
  obrien: `You are O'Brien, SRE/Deploy. Replay the packaging step. Produce a fresh B9 report or C4 plan in the same shape as the original.`,
});

/**
 * Truncate a string to roughly fit a token budget. Cheap char-count
 * approximation (assume ~4 chars/token); good enough for prompt
 * assembly defaults. Callers can pass `maxChars` directly.
 */
function truncate(s, maxChars) {
  if (typeof s !== "string") s = JSON.stringify(s);
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + `\n…[truncated; original was ${s.length} chars]`;
}

/**
 * Build the {system, user} prompt the LLM sees for one replay step.
 * Pure function — exported for testability.
 */
export function buildReplayPrompt({ original, parents, agentSystemPrompts, maxOriginalChars = 4000, maxParentChars = 1500 }) {
  const system = (agentSystemPrompts && agentSystemPrompts[original.agent]) || GENERIC_SYSTEM_PROMPT;

  const parentBlocks = (parents || []).map((p) => {
    const content = p.content ?? p._loaded_content ?? "(parent content not loaded — see meta)";
    return `### PARENT ${p.id} (kind=${p.kind}, agent=${p.agent || "?"})\n${truncate(content, maxParentChars)}`;
  }).join("\n\n") || "(no parents)";

  const originalBlock = `### ORIGINAL OUTPUT (artifact=${original.id}, kind=${original.kind}, agent=${original.agent})\n${truncate(original.content ?? "(content not loaded)", maxOriginalChars)}`;

  const user = `You are replaying step '${original.agent}' from run '${original.run_id || "unknown"}'.

The parents that fed this step:
${parentBlocks}

The output that was produced last time:
${originalBlock}

Produce a fresh variant. Output only the artifact body.`;

  return { system, user };
}

/**
 * Build a NodeStub function that calls `llmCall` to reproduce an artifact.
 *
 * @param {object} deps
 * @param {(args: { system: string, user: string, agent?: string, kind?: string }) => Promise<{ content: string, cost_usd?: number, latency_ms?: number, model?: string }>} deps.llmCall
 *   Required. Receives prompt + metadata; returns {content, cost_usd?, latency_ms?, model?}.
 * @param {Record<string, string>} [deps.agentSystemPrompts]
 *   Override per-agent system prompts. Falls back to DEFAULT_AGENT_SYSTEM_PROMPTS
 *   then to a generic prompt.
 * @param {number} [deps.maxOriginalChars=4000]
 * @param {number} [deps.maxParentChars=1500]
 * @returns {(ctx: { original: object, parents: object[], new_run_id: string, project_id: string }) => Promise<{ kind, content, agent?, model?, node?, cost_usd, latency_ms }>}
 */
export function createLLMNodeStub(deps = {}) {
  if (typeof deps.llmCall !== "function") {
    throw new Error("createLLMNodeStub: deps.llmCall required (function returning {content, cost_usd?, latency_ms?})");
  }
  const prompts = { ...DEFAULT_AGENT_SYSTEM_PROMPTS, ...(deps.agentSystemPrompts || {}) };
  const maxOriginalChars = deps.maxOriginalChars ?? 4000;
  const maxParentChars   = deps.maxParentChars   ?? 1500;

  return async function llmReplayStub({ original, parents }) {
    if (!original?.id || !original?.kind || !original?.agent) {
      throw new Error("llmReplayStub: ctx.original must have {id, kind, agent}");
    }
    const { system, user } = buildReplayPrompt({
      original,
      parents,
      agentSystemPrompts: prompts,
      maxOriginalChars,
      maxParentChars,
    });

    const started = Date.now();
    const result = await deps.llmCall({
      system,
      user,
      agent: original.agent,
      kind: original.kind,
    });
    if (!result || typeof result.content !== "string") {
      throw new Error(`llmReplayStub: llmCall returned invalid result (expected {content: string, ...})`);
    }

    return {
      kind: original.kind,
      content: result.content,
      agent: original.agent,
      model: result.model || original.model,
      node: original.node,
      cost_usd: typeof result.cost_usd === "number" ? result.cost_usd : 0,
      latency_ms: typeof result.latency_ms === "number" ? result.latency_ms : (Date.now() - started),
    };
  };
}

/**
 * Build a nodeStubs map (agent_name → NodeStub) for every unique agent
 * in a replay plan. Convenience for the HTTP endpoint that doesn't
 * want to pre-enumerate agents.
 */
export function createLLMNodeStubsForPlan(plan, snapshot, deps) {
  const agents = new Set();
  for (const id of plan.replay_artifact_ids) {
    const a = (snapshot.artifacts || []).find(x => x.id === id);
    if (a?.agent) agents.add(a.agent);
  }
  const stub = createLLMNodeStub(deps);
  const map = {};
  for (const agent of agents) map[agent] = stub; // same instance — fine, stub is pure
  return map;
}

export { DEFAULT_AGENT_SYSTEM_PROMPTS, GENERIC_SYSTEM_PROMPT };
