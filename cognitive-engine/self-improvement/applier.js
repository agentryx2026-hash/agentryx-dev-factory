import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "./types.js";

/**
 * Applier — writes an approved Proposal's change to disk.
 *
 * D145: In 15-A the applier's authority is narrow:
 *   - `config_change` → Phase 12-A `writeConfig` (atomic, registry-known ids only)
 *   - `prompt_change` → append to a per-agent overrides file under
 *     <workspace>/_prompt-overrides/<agent>.jsonl (graph doesn't consume it yet;
 *     15-B adds the hot-swap consumer). Non-destructive: never edits live code.
 *   - `model_change` → patch the Phase 2 `llm_routing` config via writeConfig
 *   - `graph_change` → REJECTED at apply time (errors out). Graph mutation is
 *     Phase 18 marketplace territory.
 *
 * D146: All applies are gated by Super Admin approval at the store layer. The
 * applier assumes the proposal is already in "approved" state; it refuses to
 * apply otherwise (caller bug if this happens).
 *
 * The applier is dependency-injected:
 *   - `configIO` = { readConfig, writeConfig, getConfigEntry } — Phase 12-A
 *     functions. Tests inject stubs; production passes the real
 *     `admin-substrate/config-store.js` + `registry.js`.
 */

function assertApproved(proposal) {
  if (proposal.state !== "approved") {
    throw new Error(`applier: proposal ${proposal.id} not in approved state (got ${proposal.state})`);
  }
}

/**
 * Parse a target string into its components.
 *
 * Supported target formats (15-A):
 *   "agent:<id>.<field>"           — prompt_change: <field> like "system_prompt"
 *   "task:<agent>.primary_model"   — model_change: routes via llm_routing config
 *   "config:<id>"                  — config_change: registry-known config id
 *   "config:<id>.<key_path>"       — config_change: nested key (dot-separated path)
 *
 * @param {string} target
 */
export function parseTarget(target) {
  if (typeof target !== "string" || !target.includes(":")) {
    throw new Error(`applier: malformed target "${target}"`);
  }
  const [prefix, rest] = target.split(":", 2);
  if (prefix === "agent") {
    const [agentId, field = "system_prompt"] = rest.split(".");
    return { kind: "agent", agent_id: agentId, field };
  }
  if (prefix === "task") {
    const [agent, field = "primary_model"] = rest.split(".");
    return { kind: "task", agent, field };
  }
  if (prefix === "config") {
    const dotIdx = rest.indexOf(".");
    if (dotIdx === -1) return { kind: "config", config_id: rest, key_path: null };
    return {
      kind: "config",
      config_id: rest.slice(0, dotIdx),
      key_path: rest.slice(dotIdx + 1),
    };
  }
  throw new Error(`applier: unknown target prefix "${prefix}"`);
}

/**
 * Set a nested key via dot-path. Returns a *new* object with the path mutated.
 * For 15-A we accept a depth of up to 8 and only scalar leaves.
 */
function setDotPath(obj, dotPath, value) {
  if (!dotPath) return value;
  const keys = dotPath.split(".");
  const copy = JSON.parse(JSON.stringify(obj ?? {}));
  let cursor = copy;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cursor[k] == null || typeof cursor[k] !== "object") cursor[k] = {};
    cursor = cursor[k];
  }
  cursor[keys[keys.length - 1]] = value;
  return copy;
}

async function applyConfigChange(proposal, { configIO }) {
  if (!configIO?.readConfig || !configIO?.writeConfig) {
    throw new Error("applier: configIO.readConfig and writeConfig required for config_change");
  }
  const target = parseTarget(proposal.change.target);
  if (target.kind !== "config") {
    throw new Error(`applier: config_change must target "config:<id>" (got ${proposal.change.target})`);
  }
  const { value: current } = await configIO.readConfig(target.config_id);
  const newValue = target.key_path
    ? setDotPath(current, target.key_path, proposal.change.to)
    : (typeof proposal.change.to === "string" ? safeJsonParse(proposal.change.to, current) : proposal.change.to);
  const writeMeta = await configIO.writeConfig(target.config_id, newValue);
  return {
    kind: "config_change",
    target_config_id: target.config_id,
    key_path: target.key_path,
    sha256: writeMeta.sha256,
    bytes: writeMeta.bytes,
  };
}

async function applyModelChange(proposal, { configIO }) {
  if (!configIO?.readConfig || !configIO?.writeConfig) {
    throw new Error("applier: configIO required for model_change");
  }
  const target = parseTarget(proposal.change.target);
  if (target.kind !== "task") {
    throw new Error(`applier: model_change must target "task:<agent>.primary_model" (got ${proposal.change.target})`);
  }
  const { value: current } = await configIO.readConfig("llm_routing");
  const newValue = JSON.parse(JSON.stringify(current ?? {}));
  newValue.tasks = newValue.tasks || {};
  newValue.tasks[target.agent] = newValue.tasks[target.agent] || {};
  newValue.tasks[target.agent][target.field] = proposal.change.to;
  const writeMeta = await configIO.writeConfig("llm_routing", newValue);
  return {
    kind: "model_change",
    agent: target.agent,
    field: target.field,
    new_value: proposal.change.to,
    sha256: writeMeta.sha256,
    bytes: writeMeta.bytes,
  };
}

async function applyPromptChange(proposal, { workspaceRoot }) {
  if (!workspaceRoot) {
    throw new Error("applier: workspaceRoot required for prompt_change");
  }
  const target = parseTarget(proposal.change.target);
  if (target.kind !== "agent") {
    throw new Error(`applier: prompt_change must target "agent:<id>.<field>" (got ${proposal.change.target})`);
  }
  const dir = path.join(workspaceRoot, "_prompt-overrides");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${target.agent_id}.jsonl`);
  const entry = {
    proposal_id: proposal.id,
    applied_at: nowIso(),
    field: target.field,
    from: proposal.change.from,
    to: proposal.change.to,
    rationale: proposal.rationale?.summary,
  };
  await fs.appendFile(file, JSON.stringify(entry) + "\n", "utf-8");
  return {
    kind: "prompt_change",
    agent_id: target.agent_id,
    field: target.field,
    override_file: file,
  };
}

function safeJsonParse(text, fallback) {
  try { return JSON.parse(text); } catch { return text ?? fallback; }
}

/**
 * Apply one approved proposal.
 *
 * @param {import("./types.js").Proposal} proposal
 * @param {Object} ctx
 * @param {{ readConfig: Function, writeConfig: Function, getConfigEntry?: Function }} [ctx.configIO]
 * @param {string} [ctx.workspaceRoot]    required for prompt_change
 * @returns {Promise<{ ok: true, summary: object }>}
 */
export async function applyProposal(proposal, ctx = {}) {
  assertApproved(proposal);
  switch (proposal.kind) {
    case "config_change": {
      const summary = await applyConfigChange(proposal, ctx);
      return { ok: true, summary };
    }
    case "model_change": {
      const summary = await applyModelChange(proposal, ctx);
      return { ok: true, summary };
    }
    case "prompt_change": {
      const summary = await applyPromptChange(proposal, ctx);
      return { ok: true, summary };
    }
    case "graph_change":
      throw new Error(`applier: graph_change rejected — Phase 15-A applier does not mutate graph code (D145)`);
    default:
      throw new Error(`applier: unknown proposal kind "${proposal.kind}"`);
  }
}

/**
 * Convenience wrapper: apply + transition store state to "applied" with summary.
 */
export async function applyAndStore({ proposal, store, ctx, actor = "applier" }) {
  const result = await applyProposal(proposal, ctx);
  return store.transition(proposal.id, "applied", {
    actor,
    patch: { apply_result: result.summary },
  });
}
