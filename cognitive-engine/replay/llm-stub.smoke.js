/**
 * Phase 13-B smoke test for the LLM-backed replay NodeStub.
 *
 *   node cognitive-engine/replay/llm-stub.smoke.js
 *
 * Tests the prompt builder + the createLLMNodeStub wrapper using a
 * stub `llmCall` so no real LLM is needed.
 */

import assert from "node:assert/strict";
import {
  buildReplayPrompt,
  createLLMNodeStub,
  createLLMNodeStubsForPlan,
  DEFAULT_AGENT_SYSTEM_PROMPTS,
  GENERIC_SYSTEM_PROMPT,
} from "./llm-stub.js";

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

const ORIGINAL = {
  id: "ART-0042",
  kind: "qa_report",
  agent: "tuvok",
  model: "openrouter:anthropic/claude-sonnet-4.6",
  node: "tuvokNode",
  run_id: "run-abc",
  content: "QA_VERDICT: PASS\nSECURITY_ISSUES: None\nTEST_COVERAGE_ESTIMATE: 85%\nRECOMMENDATION: DEPLOY",
};
const PARENTS = [
  { id: "ART-0041", kind: "code_output", agent: "torres", content: "src/auth.js — JWT middleware + login route" },
  { id: "ART-0040", kind: "triageSpec",  agent: "jane",   content: "Build a Node API with JWT auth + login endpoint." },
];

// ─── buildReplayPrompt ─────────────────────────────────────────────────────

group("buildReplayPrompt — known agent uses agent-specific system prompt");
{
  const { system, user } = buildReplayPrompt({
    original: ORIGINAL,
    parents: PARENTS,
    agentSystemPrompts: DEFAULT_AGENT_SYSTEM_PROMPTS,
  });
  ok("system mentions Tuvok", system.includes("Tuvok"));
  ok("system mentions QA",    system.includes("QA"));
  ok("user includes ORIGINAL block", user.includes("### ORIGINAL OUTPUT") && user.includes("ART-0042"));
  ok("user includes both parents",   user.includes("ART-0041") && user.includes("ART-0040"));
  ok("user references run_id",       user.includes("run-abc"));
}

group("buildReplayPrompt — unknown agent falls back to generic prompt");
{
  const { system } = buildReplayPrompt({
    original: { ...ORIGINAL, agent: "unknown_agent" },
    parents: PARENTS,
    agentSystemPrompts: DEFAULT_AGENT_SYSTEM_PROMPTS,
  });
  check("system === generic", system, GENERIC_SYSTEM_PROMPT);
}

group("buildReplayPrompt — truncates oversized parent + original content");
{
  const huge = "x".repeat(10_000);
  const { user } = buildReplayPrompt({
    original: { ...ORIGINAL, content: huge },
    parents: [{ id: "P", kind: "k", agent: "a", content: huge }],
    maxOriginalChars: 100,
    maxParentChars: 50,
  });
  ok("user contains truncation marker", user.includes("[truncated"));
  ok("user is far smaller than 10K×2",  user.length < 1000);
}

// ─── createLLMNodeStub ────────────────────────────────────────────────────

group("createLLMNodeStub — happy path returns expected artifact shape");
{
  let callArg;
  const stub = createLLMNodeStub({
    llmCall: async (arg) => {
      callArg = arg;
      return { content: "REPLAY-CONTENT", cost_usd: 0.0123, latency_ms: 42, model: "test-model" };
    },
  });
  const out = await stub({ original: ORIGINAL, parents: PARENTS, new_run_id: "run-abc.replay.1", project_id: "proj-x" });

  check("kind preserved",    out.kind, ORIGINAL.kind);
  check("agent preserved",   out.agent, "tuvok");
  check("content",           out.content, "REPLAY-CONTENT");
  check("cost_usd preserved",out.cost_usd, 0.0123);
  check("latency_ms preserved", out.latency_ms, 42);
  check("model from llmCall override",  out.model, "test-model");
  check("node passed through from original", out.node, ORIGINAL.node);

  ok("llmCall received agent",  callArg.agent === "tuvok");
  ok("llmCall received kind",   callArg.kind === "qa_report");
  ok("llmCall received system + user", typeof callArg.system === "string" && typeof callArg.user === "string");
}

group("createLLMNodeStub — llmCall returns invalid → throws");
{
  const stub = createLLMNodeStub({ llmCall: async () => ({}) });
  let threw = false;
  try { await stub({ original: ORIGINAL, parents: [], new_run_id: "r", project_id: "p" }); } catch { threw = true; }
  ok("throws on missing content", threw);
}

group("createLLMNodeStub — missing original.id/kind/agent → throws");
{
  const stub = createLLMNodeStub({ llmCall: async () => ({ content: "x" }) });
  let cnt = 0;
  try { await stub({ original: { kind: "k", agent: "a" } }); } catch { cnt += 1; }
  try { await stub({ original: { id: "i", agent: "a" } }); } catch { cnt += 1; }
  try { await stub({ original: { id: "i", kind: "k" } }); } catch { cnt += 1; }
  ok("3 missing-field variants throw", cnt === 3);
}

group("createLLMNodeStub — defaults cost_usd=0 + measures latency");
{
  const stub = createLLMNodeStub({
    llmCall: async () => {
      await new Promise(r => setTimeout(r, 5));
      return { content: "x" };
    },
  });
  const out = await stub({ original: ORIGINAL, parents: [] });
  check("cost_usd defaults to 0", out.cost_usd, 0);
  ok("latency_ms ≥ 5", out.latency_ms >= 5);
}

group("createLLMNodeStub — dep validation");
{
  let cnt = 0;
  try { createLLMNodeStub(); } catch { cnt += 1; }
  try { createLLMNodeStub({}); } catch { cnt += 1; }
  try { createLLMNodeStub({ llmCall: "not-a-function" }); } catch { cnt += 1; }
  ok("3 missing-dep variants throw", cnt === 3);
}

group("createLLMNodeStub — custom agentSystemPrompts merge with defaults");
{
  const stub = createLLMNodeStub({
    llmCall: async ({ system }) => ({ content: system }),  // echo system back as content for inspection
    agentSystemPrompts: { tuvok: "CUSTOM TUVOK PROMPT" },
  });
  const out = await stub({ original: ORIGINAL, parents: [] });
  check("custom system used for tuvok", out.content, "CUSTOM TUVOK PROMPT");

  // Agents not overridden still get defaults.
  const out2 = await stub({ original: { ...ORIGINAL, agent: "torres" }, parents: [] });
  ok("torres default kept", out2.content.includes("Torres"));
}

// ─── createLLMNodeStubsForPlan ────────────────────────────────────────────

group("createLLMNodeStubsForPlan — one stub per unique agent in plan");
{
  const snapshot = {
    artifacts: [
      { id: "A1", agent: "spock", kind: "research", parent_ids: [] },
      { id: "A2", agent: "torres", kind: "code", parent_ids: ["A1"] },
      { id: "A3", agent: "tuvok", kind: "qa", parent_ids: ["A2"] },
      { id: "A4", agent: "torres", kind: "code", parent_ids: ["A3"] },  // duplicate agent
    ],
  };
  const plan = { replay_artifact_ids: ["A2", "A3", "A4"] };
  const map = createLLMNodeStubsForPlan(plan, snapshot, {
    llmCall: async () => ({ content: "x" }),
  });
  ok("has torres",  typeof map.torres === "function");
  ok("has tuvok",   typeof map.tuvok === "function");
  ok("no spock (not in replay set)", !map.spock);
  // Same instance is reused for the duplicate agent.
  check("only 2 unique agents", Object.keys(map).sort(), ["torres", "tuvok"]);
}

// ─── default prompts roster ───────────────────────────────────────────────

group("DEFAULT_AGENT_SYSTEM_PROMPTS covers all 10 named agents");
{
  const expected = ["picard", "sisko", "troi", "jane", "spock", "torres", "tuvok", "data", "crusher", "obrien"];
  for (const a of expected) {
    ok(`has prompt for ${a}`, typeof DEFAULT_AGENT_SYSTEM_PROMPTS[a] === "string" && DEFAULT_AGENT_SYSTEM_PROMPTS[a].length > 30);
  }
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
