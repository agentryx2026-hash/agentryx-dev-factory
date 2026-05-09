/**
 * Beta Playground runner — executes the reference scenario against the stable
 * baseline and against any number of experimental profile variants, captures
 * comparable metrics, and writes JSON results to `playground/results/`.
 *
 * Phase 2.76 — substrate only. The runner ships in a deliberately minimal
 * form: it knows how to run `cognitive-engine/integration/composition-smoke.js`
 * with environment-flag overrides. Future iterations will add:
 *
 *   - Per-profile adapter discovery (load profiles/<slug>/adapter.js)
 *   - Multi-variant runs in one invocation
 *   - LLM cost capture via Phase 11-A cost-tracker hooks
 *   - Comparison reports under playground/results/
 *
 * For Phase 2.76 close: this file is the contract surface — every profile
 * adapter implements `runVariant(scenario, baselineResult)` and returns
 * `{ scenario, variant_id, metrics, observations }`. The orchestration loop
 * is small and the surface is clear.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const RESULTS_DIR = path.join(__dirname, "results");

const REFERENCE_SCENARIO = path.join(REPO_ROOT, "cognitive-engine", "integration", "composition-smoke.js");

function nowIso() { return new Date().toISOString(); }
function dateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Run a single scenario as a subprocess, capture exit code + stdout + duration.
 *
 * @param {string} scenarioPath
 * @param {Object} env  extra env vars overlaid on process.env
 * @returns {Promise<{ ok: boolean, exit_code: number, duration_ms: number, stdout: string, stderr: string }>}
 */
function runScenario(scenarioPath, env = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn("node", [scenarioPath], {
      env: { ...process.env, ...env },
      cwd: REPO_ROOT,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exit_code: code,
        duration_ms: Date.now() - start,
        stdout,
        stderr,
      });
    });
    child.on("error", (err) => {
      resolve({
        ok: false,
        exit_code: -1,
        duration_ms: Date.now() - start,
        stdout,
        stderr: stderr + "\n" + err.message,
      });
    });
  });
}

function countAssertions(stdout) {
  return (stdout.match(/✓/g) || []).length;
}

/**
 * Run the reference scenario and return a structured result.
 *
 * @param {Object} variantSpec
 * @param {string} variantSpec.id              e.g. "baseline" or "hermes-kanban"
 * @param {string} [variantSpec.profile]       slug under playground/profiles/
 * @param {Object} [variantSpec.env]           extra env vars (feature flags) for the run
 * @param {string} [variantSpec.notes]
 */
async function runVariant(variantSpec) {
  const result = await runScenario(REFERENCE_SCENARIO, variantSpec.env || {});
  return {
    variant_id: variantSpec.id,
    profile: variantSpec.profile || null,
    notes: variantSpec.notes || null,
    env_overrides: variantSpec.env || {},
    ok: result.ok,
    exit_code: result.exit_code,
    duration_ms: result.duration_ms,
    assertion_count: countAssertions(result.stdout),
    stdout_tail: result.stdout.split("\n").slice(-40).join("\n"),
    stderr: result.stderr.trim() || null,
  };
}

/**
 * Run the baseline + zero-or-more experimental variants and write the
 * comparison JSON to playground/results/<date>_<scenario>.json.
 *
 * Profile adapters are wired here in future iterations — for Phase 2.76
 * close, the runner only knows how to run the baseline + simple env-flag
 * variants.
 *
 * @param {Object} [opts]
 * @param {Object[]} [opts.variants]   defaults to a single baseline run
 * @param {string} [opts.scenario_label]
 * @returns {Promise<Object>}  the comparison report (also written to disk)
 */
export async function runComparison(opts = {}) {
  await fs.mkdir(RESULTS_DIR, { recursive: true });

  const variants = opts.variants?.length ? opts.variants : [{ id: "baseline" }];
  const scenarioLabel = opts.scenario_label || "composition-smoke";

  const runs = [];
  for (const v of variants) {
    runs.push(await runVariant(v));
  }

  const report = {
    schema_version: 1,
    started_at: nowIso(),
    scenario: {
      label: scenarioLabel,
      path: path.relative(REPO_ROOT, REFERENCE_SCENARIO),
    },
    variant_count: runs.length,
    runs,
    summary: {
      baseline_ok: runs[0]?.ok ?? false,
      baseline_assertions: runs[0]?.assertion_count ?? 0,
      baseline_duration_ms: runs[0]?.duration_ms ?? 0,
      delta_vs_baseline: runs.slice(1).map(r => ({
        variant_id: r.variant_id,
        ok: r.ok,
        assertion_delta: (r.assertion_count ?? 0) - (runs[0]?.assertion_count ?? 0),
        duration_delta_ms: (r.duration_ms ?? 0) - (runs[0]?.duration_ms ?? 0),
      })),
    },
  };

  const outFile = path.join(RESULTS_DIR, `${dateStamp()}_${scenarioLabel}.json`);
  await fs.writeFile(outFile, JSON.stringify(report, null, 2) + "\n", "utf-8");
  return { report, output_path: outFile };
}

/**
 * CLI entrypoint:
 *   node playground/runner.js              → runs baseline only
 *   node playground/runner.js --baseline   → same
 *
 * Future:
 *   node playground/runner.js --include hermes-agent,honcho
 *   node playground/runner.js --variant baseline,hermes-kanban
 */
async function main() {
  const args = process.argv.slice(2);
  const variants = [{ id: "baseline" }];

  if (args.includes("--include")) {
    const idx = args.indexOf("--include");
    const list = (args[idx + 1] || "").split(",").filter(Boolean);
    if (list.length > 0) {
      console.log(`[playground/runner] --include flag detected; profiles: ${list.join(",")}`);
      console.log(`[playground/runner] adapter loading not yet wired in Phase 2.76 substrate; ignoring --include and running baseline only.`);
      console.log(`[playground/runner] add adapter.js to each profile + extend runner.js to load them.`);
    }
  }

  console.log(`[playground/runner] reference scenario: ${path.relative(REPO_ROOT, REFERENCE_SCENARIO)}`);
  console.log(`[playground/runner] running ${variants.length} variant(s)…`);

  const { report, output_path } = await runComparison({ variants });

  console.log(`\n[playground/runner] DONE`);
  console.log(`  wrote: ${path.relative(REPO_ROOT, output_path)}`);
  console.log(`  baseline: ${report.summary.baseline_ok ? "OK" : "FAILED"} — ${report.summary.baseline_assertions} assertions in ${report.summary.baseline_duration_ms}ms`);
  if (report.summary.delta_vs_baseline.length) {
    for (const d of report.summary.delta_vs_baseline) {
      console.log(`  ${d.variant_id}: ${d.ok ? "OK" : "FAILED"} — assertion_delta=${d.assertion_delta}, duration_delta_ms=${d.duration_delta_ms}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[playground/runner] FATAL:", err.message);
    process.exit(1);
  });
}
