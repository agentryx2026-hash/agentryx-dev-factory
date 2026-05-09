/**
 * Phase 15-B Tier B — LLM-backed proposer for the self-improvement loop.
 *
 * Drop-in alternative to `createHeuristicProposer`: same contract
 * (`{ id, async propose(ctx) }`), reads memory observations from
 * `ctx.memory.recall(...)`, but uses an LLM to reason across them and
 * produce ProposalDraft objects rather than running fixed rules.
 *
 * Routes through llm-router/router.js `complete()` (the same path used
 * by Phase 21-B Sonnet dispatcher and Phase 6-B archive hook). Default
 * task = `architect` (Opus 4.7) — proposing changes to the factory's
 * own system is a high-tier reasoning task; demote to `worker` for
 * cheaper drafts.
 *
 * Output is a strict JSON contract; malformed entries get dropped with
 * a console warn (fail-open per draft, not per call).
 *
 * What stays for full 15-B: real outcome comparators that read
 * artifact-level cost / latency / success-rate deltas. This proposer
 * reasons over OBSERVATIONS today; comparators feed it ARTIFACTS later.
 */

import { complete } from '../../llm-router/src/router.js';

const VALID_KINDS = new Set([
  // Phase 15-A originals
  'prompt_change', 'model_change', 'config_change', 'graph_change',
  // Phase 21-A architect-owned (rare for the self-improvement proposer to emit, but valid)
  'tool_adoption', 'kb_update', 'research_finding',
]);

/**
 * @param {Object} [opts]
 * @param {string} [opts.task='architect']  llm-router task; 'architect' = Opus 4.7
 * @param {number} [opts.maxDrafts=8]        cap to keep per-call cost predictable
 * @param {number} [opts.maxObservations=80] cap context window
 */
export function createLLMProposer(opts = {}) {
  const task = opts.task || 'architect';
  const maxDrafts = opts.maxDrafts ?? 8;
  const maxObservations = opts.maxObservations ?? 80;

  return {
    id: `proposer:llm:${task}`,

    async propose(ctx) {
      if (!ctx?.memory?.recall) {
        throw new Error('proposer: ctx.memory with .recall required');
      }

      // Pull observations same way the heuristic proposer does
      const filter = {};
      if (ctx.scope) filter.scope = ctx.scope;
      const observations = (await ctx.memory.recall({ ...filter, limit: maxObservations })) || [];
      const pool = ctx.since
        ? observations.filter(o => String(o.produced_at || '') >= ctx.since)
        : observations;

      if (pool.length === 0) {
        return [];
      }

      const messages = [
        { role: 'system', content: buildSystemPrompt(maxDrafts) },
        { role: 'user',   content: buildUserPrompt(pool, ctx) },
      ];

      let response;
      try {
        response = await complete({
          task,
          messages,
          projectId: 'self-improvement',
          phase: 'self-improvement.propose',
          agent: 'self-improvement.llm-proposer',
          maxTokens: 4096,
        });
      } catch (err) {
        throw new Error(`LLM proposer (task=${task}) failed: ${err?.message || err}`);
      }

      return parseDrafts(response?.content || '', pool);
    },
  };
}

function buildSystemPrompt(maxDrafts) {
  return `You are the self-improvement proposer for the Agentryx Dev Factory.

Your job: read recent memory observations (lessons, patterns, decisions, user_notes) the factory has accumulated, identify recurring signals that suggest a concrete change, and emit a list of ProposalDraft objects the founder can review and approve.

OUTPUT CONTRACT (strict):
Return ONLY a JSON object matching this schema. No prose before or after. No markdown fences.

{
  "drafts": [
    {
      "kind": "prompt_change" | "model_change" | "config_change" | "graph_change",
      "change": {
        "target": "<discriminator-prefixed string, see below>",
        "from": "<optional — current value if relevant>",
        "to":   "<the proposed new value, prose for prompt_change>",
        "params": { ...optional fine-grained fields }
      },
      "rationale": {
        "summary": "<one sentence: what this changes and why>",
        "supporting_observations": ["<observation id>", "..."]
      }
    }
  ]
}

DISCRIMINATOR-PREFIXED TARGETS (Phase 15-A convention):
- prompt_change → "agent:<name>.system_prompt"  (e.g. "agent:tuvok.system_prompt")
- model_change  → "task:<task-name>.primary_model"  (e.g. "task:architect.primary_model")
- config_change → "config:<id>"  (e.g. "config:cost_thresholds")
- graph_change  → "graph:<graphName>.<change-kind>"  (NOT applied in 15-A; flag-only)

DISCIPLINE:
- At most ${maxDrafts} drafts per call. Quality > quantity.
- Every draft cites at least one observation id under supporting_observations.
- Only propose when there's repeated signal — single-incident lessons rarely warrant change.
- "rationale.summary" is one sentence, action-oriented ("Update X to Y because Z"), <140 chars.
- Don't propose changes the architect already suggested (those come through Phase 21 with kinds tool_adoption/kb_update/research_finding — not your lane).
- Prefer prompt_change and model_change drafts over config_change (they're lower-risk reversible changes).
- If the pool is too thin or the signal is too weak to propose a high-quality change, return { "drafts": [] } — don't pad.`;
}

function buildUserPrompt(pool, ctx) {
  const lines = [];
  lines.push(`# Recent observations (${pool.length} entries${ctx.scope ? `, scope: ${ctx.scope}` : ''}${ctx.since ? `, since: ${ctx.since}` : ''})`);
  lines.push('');
  for (const o of pool) {
    const tags = (o.tags || []).join(', ') || '—';
    const oneLine = String(o.content || '').split('\n')[0].slice(0, 220);
    lines.push(`- ${o.id} [${o.kind}] scope=${o.scope} tags=${tags} produced_at=${o.produced_at}`);
    lines.push(`  ${oneLine}`);
  }
  lines.push('');
  lines.push('# Task');
  lines.push('Analyze the observations above. Identify recurring signals that justify a concrete factory change. Emit ProposalDraft entries per the schema in the system prompt. If nothing rises to the threshold of a confident proposal, return an empty drafts array.');
  return lines.join('\n');
}

function parseDrafts(text, pool) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '');

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.warn(`[self-improvement.llm-proposer] failed to parse JSON: ${err?.message}`);
    return [];
  }

  const raw = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
  const knownIds = new Set(pool.map(o => o.id));
  const out = [];

  for (const d of raw) {
    if (!d || !VALID_KINDS.has(d.kind)) continue;
    if (!d.change || typeof d.change.target !== 'string') continue;
    if (!d.rationale?.summary || typeof d.rationale.summary !== 'string') continue;

    // Filter supporting_observations to ones actually in the pool;
    // models sometimes hallucinate ids
    const supporting = Array.isArray(d.rationale.supporting_observations)
      ? d.rationale.supporting_observations.filter(id => knownIds.has(id))
      : [];

    if (supporting.length === 0) {
      console.warn(`[self-improvement.llm-proposer] draft "${d.rationale.summary.slice(0, 60)}" cites no valid observation ids; skipping`);
      continue;
    }

    out.push({
      kind: d.kind,
      change: {
        target: d.change.target,
        ...(d.change.from != null ? { from: d.change.from } : {}),
        ...(d.change.to != null   ? { to: d.change.to }   : {}),
        ...(d.change.params       ? { params: d.change.params } : {}),
      },
      rationale: {
        summary: d.rationale.summary.slice(0, 240),
        supporting_observations: supporting,
        meta: { proposer: 'llm', task: 'architect' },
      },
    });
  }

  return out;
}
