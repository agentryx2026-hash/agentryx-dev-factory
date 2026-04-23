/**
 * Proposer — emits Proposals from memory-layer observations.
 *
 * D143: The proposer is dependency-injected. 15-A ships ONE built-in heuristic
 * proposer (`createHeuristicProposer`) that walks recent `lesson` + `pattern`
 * observations from Phase 7-A memory and clusters by tag. Any proposer
 * satisfying the contract can plug in — 15-B will add an LLM-backed one,
 * possible 15-C an RL / Hermes-Tinker-Atropos one.
 *
 * Proposer contract:
 *   propose(ctx) → Promise<ProposalDraft[]>
 *
 *   ctx = {
 *     memory,             // Phase 7-A MemoryService instance (has .recall/.listForScope)
 *     scope?,             // optional scope filter ("agent:troi", etc.)
 *     since?,             // optional ISO cutoff; observations older than this ignored
 *     registry,           // Phase 12-A config registry (for candidate target discovery)
 *   }
 *
 *   ProposalDraft = { kind, change, rationale } — NOT yet stored; caller runs
 *   store.create(draft) to persist. This separation lets the caller pre-filter,
 *   dedupe, or add extra context before writing.
 */

/**
 * Default heuristic rules — deliberately simple, just enough to prove the contract.
 * Each rule takes the observation list and yields zero-or-more ProposalDraft.
 *
 * Rule 1 (lesson-clustered prompt change): if ≥N `lesson` observations share a
 * tag and an `agent:<id>` scope, emit a `prompt_change` suggestion for that
 * agent's system prompt. Target format: "agent:<id>.system_prompt".
 *
 * Rule 2 (model underperformance): if ≥N `pattern` observations tag "cost_high"
 * or "slow" against a specific agent/tier, emit a `model_change` suggestion to
 * move that task to a cheaper tier. Target format: "task:<agent>.primary_model".
 *
 * Rule 3 (config drift): if ≥N `decision` observations tag "threshold_tuned"
 * against `config:<id>`, emit a `config_change` suggestion. Target format:
 * "config:<id>.<key_path>".
 */

const DEFAULT_MIN_SUPPORT = 2;

function ensureList(x) { return Array.isArray(x) ? x : []; }

function groupBy(arr, keyFn) {
  const out = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (k == null) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

function pickAgentScope(scope) {
  if (typeof scope !== "string") return null;
  if (!scope.startsWith("agent:")) return null;
  return scope.slice("agent:".length);
}

/**
 * Rule 1: cluster `lesson` observations by (scope, tag). If a cluster has ≥min
 * entries AND scope is agent-specific, propose a prompt update.
 */
function rule_promptClustering(observations, opts) {
  const lessons = observations.filter(o => o.kind === "lesson" && pickAgentScope(o.scope));
  const buckets = groupBy(lessons, o => {
    const agent = pickAgentScope(o.scope);
    const primaryTag = (o.tags || [])[0] || "general";
    return `${agent}::${primaryTag}`;
  });
  const drafts = [];
  for (const [key, group] of buckets) {
    if (group.length < opts.minSupport) continue;
    const [agent, tag] = key.split("::");
    const summaries = group.map(o => (o.content || "").split("\n")[0]).slice(0, 5);
    drafts.push({
      kind: "prompt_change",
      change: {
        target: `agent:${agent}.system_prompt`,
        from: "",
        to: `(suggested addition) When handling ${tag}-related work, observe:\n- ${summaries.join("\n- ")}`,
      },
      rationale: {
        summary: `${group.length} lessons tagged "${tag}" recurred for agent ${agent}; consolidate into system prompt.`,
        supporting_observations: group.map(o => o.id),
        meta: { rule: "prompt_clustering", tag, agent },
      },
    });
  }
  return drafts;
}

/**
 * Rule 2: `pattern` observations tagged "cost_high" or "slow" scoped to an
 * agent → model_change proposal (suggest cheaper tier).
 */
function rule_modelUnderperformance(observations, opts) {
  const patterns = observations.filter(o =>
    o.kind === "pattern" &&
    pickAgentScope(o.scope) &&
    (o.tags || []).some(t => t === "cost_high" || t === "slow")
  );
  const byAgent = groupBy(patterns, o => pickAgentScope(o.scope));
  const drafts = [];
  for (const [agent, group] of byAgent) {
    if (group.length < opts.minSupport) continue;
    const kinds = new Set(group.flatMap(o => o.tags || []));
    const direction = kinds.has("cost_high") ? "cheaper_tier" : "faster_tier";
    drafts.push({
      kind: "model_change",
      change: {
        target: `task:${agent}.primary_model`,
        from: "",
        to: `(suggested) move to ${direction}`,
      },
      rationale: {
        summary: `${group.length} performance-regression patterns for agent ${agent} suggest switching to ${direction}.`,
        supporting_observations: group.map(o => o.id),
        meta: { rule: "model_underperformance", agent, direction },
      },
    });
  }
  return drafts;
}

/**
 * Rule 3: `decision` observations tagged "threshold_tuned" referencing a
 * config entry → config_change proposal. Supports any config registered in
 * Phase 12-A config registry.
 */
function rule_configDrift(observations, opts, registry) {
  if (!registry?.CONFIG_ENTRIES) return [];
  const configIds = new Set(registry.CONFIG_ENTRIES.map(e => e.id));
  const decisions = observations.filter(o =>
    o.kind === "decision" &&
    (o.tags || []).includes("threshold_tuned")
  );
  const byTarget = groupBy(decisions, o => {
    const tag = (o.tags || []).find(t => t.startsWith("config:"));
    if (!tag) return null;
    const id = tag.slice("config:".length);
    return configIds.has(id) ? id : null;
  });
  const drafts = [];
  for (const [configId, group] of byTarget) {
    if (group.length < opts.minSupport) continue;
    drafts.push({
      kind: "config_change",
      change: {
        target: `config:${configId}`,
        from: "",
        to: "(suggested) review + adjust based on tuning decisions",
      },
      rationale: {
        summary: `${group.length} tuning decisions recorded for config ${configId}; consider promoting them to the stored config.`,
        supporting_observations: group.map(o => o.id),
        meta: { rule: "config_drift", config_id: configId },
      },
    });
  }
  return drafts;
}

export const DEFAULT_RULES = Object.freeze([
  rule_promptClustering,
  rule_modelUnderperformance,
  rule_configDrift,
]);

/**
 * @param {Object} [opts]
 * @param {number} [opts.minSupport]      minimum cluster size before emitting (default 2)
 * @param {Array<Function>} [opts.rules]  override rule set (default = DEFAULT_RULES)
 * @returns {{ id: string, propose: (ctx: object) => Promise<object[]> }}
 */
export function createHeuristicProposer(opts = {}) {
  const minSupport = opts.minSupport ?? DEFAULT_MIN_SUPPORT;
  const rules = opts.rules || DEFAULT_RULES;

  return {
    id: "proposer:heuristic",

    async propose(ctx) {
      if (!ctx?.memory?.recall) {
        throw new Error("proposer: ctx.memory with .recall required");
      }
      const filter = {};
      if (ctx.scope) filter.scope = ctx.scope;
      const observations = ensureList(await ctx.memory.recall({ ...filter, limit: 500 }));
      const pool = ctx.since
        ? observations.filter(o => String(o.produced_at || "") >= ctx.since)
        : observations;

      const drafts = [];
      for (const rule of rules) {
        const out = await rule(pool, { minSupport }, ctx.registry);
        drafts.push(...out);
      }
      return drafts;
    },
  };
}

/**
 * Convenience: run a proposer and persist each draft via a store.
 * Returns the array of created Proposals (stateful).
 *
 * Dedupe: if a draft's (kind, change.target, rationale.summary) already exists
 * in a non-terminal state, we skip it. Keeps the proposer idempotent across
 * re-runs over the same memory.
 */
export async function runProposerIntoStore({ proposer, store, ctx }) {
  if (!proposer?.propose) throw new Error("runProposerIntoStore: proposer required");
  if (!store?.create) throw new Error("runProposerIntoStore: store required");

  const drafts = await proposer.propose(ctx);
  const existing = await store.list();
  const existingKey = new Set(
    existing
      .filter(p => !["rejected", "applied"].includes(p.state))
      .map(p => `${p.kind}::${p.change?.target}::${p.rationale?.summary}`)
  );

  const created = [];
  for (const d of drafts) {
    const key = `${d.kind}::${d.change?.target}::${d.rationale?.summary}`;
    if (existingKey.has(key)) continue;
    const proposal = await store.create({
      ...d,
      created_by: proposer.id || "proposer:unknown",
    });
    created.push(proposal);
  }
  return created;
}
