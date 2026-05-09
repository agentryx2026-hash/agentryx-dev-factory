/**
 * Phase 21-B — Real LLM-backed research dispatcher.
 *
 * Replaces `createStubDispatcher` with a real LLM call through the
 * Phase 2 LLM router. The router handles fallback chains, budget caps,
 * cost capture, and key resolution (Phase 2.5 Key Console).
 *
 * The dispatcher contract is unchanged from createStubDispatcher: takes
 * one area's context, returns `{ findings, cost_usd, produced_by }`.
 * Drop-in swap.
 *
 * Two presets:
 *   `research` task — Gemini 2.5 Pro primary, Sonnet 4.6 fallback (cheap,
 *                     fast scan; good for daily/weekly cadences)
 *   `architect` task — Opus 4.7 primary, GPT-5/Gemini 2.5 Pro fallbacks
 *                     (deep, slow, expensive; good for monthly strategic)
 *
 * Default = `research`. Pick `architect` for the monthly cadence in
 * Standing Orders (`dispatcher: 'opus'`).
 *
 * Fail-open posture: if the LLM call errors or returns malformed JSON,
 * we return zero findings + capture the error so the per-area failure
 * isolation in researcher.js still shields the rest of the pass.
 */

import { complete } from '../../../llm-router/src/router.js';

const TASK_FOR_DISPATCHER = {
  sonnet: 'research',     // Gemini 2.5 Pro / Sonnet 4.6
  opus:   'architect',    // Opus 4.7 / GPT-5 / Gemini 2.5 Pro
};

const DEFAULT_TASK = 'research';

/**
 * @param {Object} [opts]
 * @param {'sonnet'|'opus'|'research'|'architect'} [opts.dispatcher='sonnet']
 *   Maps to a router task. 'sonnet' → 'research' task; 'opus' → 'architect' task.
 *   Pass 'research' or 'architect' directly if you want to bypass the alias.
 * @param {string} [opts.project_id='architect']  for cost-rollup tagging
 * @param {string} [opts.phase='architect.research']
 * @param {string} [opts.agent='architect.researcher']
 */
export function createLLMDispatcher(opts = {}) {
  const dispatcherKey = opts.dispatcher || 'sonnet';
  const task = TASK_FOR_DISPATCHER[dispatcherKey] || dispatcherKey || DEFAULT_TASK;
  const projectId = opts.project_id || 'architect';
  const phase = opts.phase || 'architect.research';
  const agent = opts.agent || 'architect.researcher';

  return async ({
    area, weight, current_state, target_3mo, target_6mo,
    hard_constraints, anti_goals, directions, watch,
    budget_usd, research_depth, kb_summary,
  }) => {
    const messages = [
      {
        role: 'system',
        content: buildSystemPrompt(),
      },
      {
        role: 'user',
        content: buildUserPrompt({
          area, weight, current_state, target_3mo, target_6mo,
          hard_constraints, anti_goals, directions, watch,
          budget_usd, research_depth, kb_summary,
        }),
      },
    ];

    let response;
    try {
      response = await complete({
        task,
        messages,
        projectId,
        phase,
        agent,
        // Cap output tokens to keep cost predictable per area; 8K is enough
        // for ~5-10 findings with structured JSON.
        maxTokens: 8000,
      });
    } catch (err) {
      // Bubble the error up; researcher.js catches and isolates per-area.
      throw new Error(`LLM dispatcher (${dispatcherKey}/${task}) failed: ${err?.message || err}`);
    }

    const text = response?.content || '';
    const cost_usd = response?.cost_usd ?? 0;
    const findings = parseFindings(text, area);

    return {
      findings,
      cost_usd,
      produced_by: `researcher:llm:${dispatcherKey}:${response?.model_succeeded || task}`,
    };
  };
}

function buildSystemPrompt() {
  return `You are the Master Architect's research subagent for the Agentryx Dev Factory.

Your job: research one priority area of the factory's Platform Evolution Roadmap, identify what's changed in the ecosystem since the last scan, compare against the founder's stated targets, and produce **structured findings** the founder can triage as proposals.

OUTPUT CONTRACT (strict):
Return ONLY a JSON object matching this schema. No prose before or after. No markdown code fences.

{
  "findings": [
    {
      "content": "<1-3 sentences, plain text, no markdown>",
      "kind": "info" | "upgrade-available" | "new-tool" | "deprecation" | "security",
      "sources": ["<URL or repo>", "..."],
      "target_name": "<optional — name a tool/product if kind is new-tool / upgrade-available>",
      "target_category": "<optional — short category like 'agent_runtime', 'memory_backend'>"
    }
  ]
}

DISCIPLINE:
- 1-5 findings per area. Quality over quantity.
- Every finding cites at least one source URL.
- Prefer concrete observations ("Hermes Agent v0.13 ships durable Kanban with heartbeat") over generic ones ("agent frameworks are evolving").
- Tag the finding kind precisely. "new-tool" only for genuinely new things; "upgrade-available" for new versions of existing tools; "deprecation" for things being retired.
- Honor the founder's hard_constraints + anti_goals — don't surface findings that violate them.`;
}

function buildUserPrompt(area) {
  const lines = [];
  lines.push(`# Priority area: ${area.area}`);
  lines.push(`Weight: ${area.weight}/5 · Budget: $${area.budget_usd?.toFixed(3) || '?'} · Depth: ${area.research_depth || 'standard'}`);
  lines.push('');
  if (area.current_state) {
    lines.push(`## Current state`);
    lines.push(area.current_state);
    lines.push('');
  }
  if (area.target_3mo) {
    lines.push(`## Target — 3 months`);
    lines.push(area.target_3mo);
    lines.push('');
  }
  if (area.target_6mo) {
    lines.push(`## Target — 6 months`);
    lines.push(area.target_6mo);
    lines.push('');
  }
  if (Array.isArray(area.hard_constraints) && area.hard_constraints.length) {
    lines.push(`## Hard constraints`);
    for (const c of area.hard_constraints) lines.push(`- ${c}`);
    lines.push('');
  }
  if (Array.isArray(area.anti_goals) && area.anti_goals.length) {
    lines.push(`## Anti-goals (do NOT propose)`);
    for (const a of area.anti_goals) lines.push(`- ${a}`);
    lines.push('');
  }
  if (Array.isArray(area.directions) && area.directions.length) {
    lines.push(`## Research directions (founder-suggested topics to scan)`);
    for (const d of area.directions) lines.push(`- ${d}`);
    lines.push('');
  }
  if (Array.isArray(area.watch) && area.watch.length) {
    lines.push(`## Strategic watch (organizations / products to track)`);
    for (const w of area.watch) {
      lines.push(`- ${w.name || w.id}${w.url ? ` (${w.url})` : ''}${w.notes ? ' — ' + w.notes : ''}`);
    }
    lines.push('');
  }
  if (area.kb_summary) {
    lines.push(`## Current KB state`);
    lines.push(`Targets: ${area.kb_summary.target_count || 0} · Findings: ${area.kb_summary.finding_count || 0} · Last pass: ${area.kb_summary.last_pass_at || 'none'}`);
    lines.push('');
  }
  lines.push(`# Research request`);
  lines.push(`Identify 1-5 findings for this priority area. What changed in the ecosystem since the last scan that's relevant to the targets above? Return the JSON object specified in the system prompt — no prose before or after.`);
  return lines.join('\n');
}

/**
 * Parse the model's JSON output into the architect's Finding shape.
 * Tolerates leading/trailing whitespace and accidental code-fences.
 * Drops malformed entries silently (with a console warn) — fail-open.
 */
function parseFindings(text, area) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '');

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.warn(`[architect.dispatcher.llm] failed to parse JSON for area "${area}": ${err?.message}`);
    return [];
  }

  const raw = Array.isArray(parsed?.findings) ? parsed.findings : [];
  const VALID_KINDS = new Set(['info', 'upgrade-available', 'new-tool', 'deprecation', 'security']);
  return raw
    .map(f => {
      if (!f || typeof f.content !== 'string' || !f.content.trim()) return null;
      const kind = VALID_KINDS.has(f.kind) ? f.kind : 'info';
      return {
        content: f.content.trim(),
        kind,
        sources: Array.isArray(f.sources) ? f.sources.filter(s => typeof s === 'string') : [],
        target_name: typeof f.target_name === 'string' ? f.target_name : undefined,
        target_category: typeof f.target_category === 'string' ? f.target_category : undefined,
      };
    })
    .filter(Boolean);
}
