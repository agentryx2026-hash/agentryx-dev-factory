// Token → USD based on the price table. Best-effort values, edited via Phase 12 admin UI.

import { loadPrices } from './config.js';

export function computeCost(model, usage) {
  if (!usage) return 0;
  const prices = loadPrices();

  // Look up. Supports exact match or stripped prefix (e.g. "anthropic/claude-opus-4-7" → "claude-opus-4-7").
  const short = model.includes('/') ? model.split('/').pop() : model;
  const entry = prices[model] ?? prices[short];
  if (!entry) {
    process.stderr.write(`COST_WARN no price for model ${model} (tried ${short}) — recording 0\n`);
    return 0;
  }

  const inTokens  = usage.prompt_tokens    ?? 0;
  const outTokens = usage.completion_tokens ?? 0;
  const inCost  = (inTokens  / 1_000_000) * (entry.input_per_mtok ?? 0);
  const outCost = (outTokens / 1_000_000) * (entry.output_per_mtok ?? 0);
  return roundUsd(inCost + outCost);
}

function roundUsd(n) {
  return Math.round(n * 1_000_000) / 1_000_000; // 6 decimal places
}
