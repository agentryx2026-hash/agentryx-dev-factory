#!/usr/bin/env node
// Phase 2F — CLI for A/B comparing multiple models on the same prompt.
//
// Usage:
//   node llm-router/src/compare-cli.mjs \
//     --models=openrouter:anthropic/claude-haiku-4-5,openrouter:google/gemini-2.5-flash \
//     --prompt="Write a haiku about budget caps" \
//     [--system="You are a poet."] \
//     [--format=human|json]  (default: human)
//
// Runs all models in parallel (via compare() from router.js). Total wall time
// is max(individual latencies), not sum. Costs are captured to llm_calls with
// project_id='compare-cli' so Phase 2G dashboard shows them as evaluation
// runs, distinct from real project spend.

import { compare } from './router.js';

function parseArgs(argv) {
  const args = { format: 'human' };
  for (const raw of argv.slice(2)) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (!m) throw new Error(`unexpected arg: ${raw}`);
    args[m[1]] = m[2];
  }
  if (!args.models) throw new Error('--models is required (comma-separated)');
  if (!args.prompt) throw new Error('--prompt is required');
  args.models = args.models.split(',').map(s => s.trim()).filter(Boolean);
  if (args.models.length === 0) throw new Error('--models: at least one model required');
  return args;
}

function fmtHuman(result) {
  const header = `=== ${result.model}${result.error ? ' (ERROR)' : ''} ===`;
  const meta = result.error
    ? `(failed: ${result.error})`
    : `(cost=$${result.cost_usd?.toFixed(6) ?? '?'}, latency=${result.latency_ms ?? '?'}ms, tokens=${result.usage?.prompt_tokens ?? '?'}/${result.usage?.completion_tokens ?? '?'})`;
  const body = result.content ?? '';
  return [header, meta, '', body, ''].join('\n');
}

function summarize(results) {
  const ok = results.filter(r => !r.error);
  if (ok.length === 0) return 'All models failed.';
  const cheapest = ok.reduce((a, b) => (a.cost_usd <= b.cost_usd ? a : b));
  const fastest  = ok.reduce((a, b) => (a.latency_ms <= b.latency_ms ? a : b));
  const longest  = ok.reduce((a, b) => ((a.content?.length ?? 0) >= (b.content?.length ?? 0) ? a : b));
  return [
    '─── Summary ───',
    `  cheapest:   ${cheapest.model}   ($${cheapest.cost_usd.toFixed(6)})`,
    `  fastest:    ${fastest.model}   (${fastest.latency_ms}ms)`,
    `  longest:    ${longest.model}   (${longest.content?.length ?? 0} chars)`,
    `  ${ok.length}/${results.length} succeeded`,
  ].join('\n');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n\nusage:\n  compare-cli --models=<m1,m2,...> --prompt="..." [--system="..."] [--format=human|json]\n`);
    process.exit(2);
  }

  const messages = [];
  if (args.system) messages.push({ role: 'system', content: args.system });
  messages.push({ role: 'user', content: args.prompt });

  const results = await compare({ messages, models: args.models });

  if (args.format === 'json') {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    for (const r of results) process.stdout.write(fmtHuman(r));
    process.stdout.write(summarize(results) + '\n');
  }
  // Graceful exit — pg connection pool has keep-alive, give it a moment.
  setTimeout(() => process.exit(results.every(r => r.error) ? 1 : 0), 500);
}

main().catch((err) => {
  process.stderr.write(`compare-cli fatal: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
