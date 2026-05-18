/**
 * Phase 14-B Tier B — factory pipeline queue handlers.
 *
 * Registers handlers for the three pipeline kinds (`pre_dev`, `dev`,
 * `post_dev`) so jobs of those kinds can flow through the Phase 14-A
 * queue + worker pool instead of being spawned inline from the
 * telemetry HTTP routes.
 *
 * Each handler is the same shape Phase 14-A's runSchedulerOnce expects:
 *   async (job, { workingDir, worker_id }) => { ...result }
 *
 * The work itself is just a `spawn()` of the corresponding graph script
 * (same as the existing telemetry.mjs `/api/factory/{pre-dev,dev,post-dev}`
 * paths do today). The new value here is:
 *   - jobs are queued with project_id → round-robin fairness across
 *     concurrent projects (no head-of-line blocking)
 *   - per-job working directory under <workspaceRoot>/_jobs/work/<JOB-id>/
 *   - retries on failure (max_attempts default 3) handled by Phase 14-A
 *   - admin queue panel observes live job state
 *
 * Phase 16-B / 17-B / 19-B will register additional handler kinds
 * (training_gen / training_video_render / project_intake) when they
 * land — same registry, no new handler-runtime work.
 *
 * What stays for full 14-B: HTTP submit endpoint with auth (we ship a
 * /api/factory-admin/queue/submit Tier B endpoint here without auth);
 * per-project quotas wired to Phase 11-A budget gates; crash recovery
 * (job leases time out and re-enqueue — Phase 14-A already handles this).
 */

import { spawn } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..", "..", "..");
const COGNITIVE_ENGINE_DIR = path.join(REPO_ROOT, "cognitive-engine");

/**
 * Spawn a graph subprocess and resolve when it exits.
 * Streams stdout/stderr lines through `onLog` if provided.
 *
 * @param {string} graphFile           e.g. 'pre_dev_graph.js'
 * @param {string[]} args              positional args passed to the script
 * @param {object} [opts]
 * @param {(line: string, kind: 'stdout'|'stderr') => void} [opts.onLog]
 * @returns {Promise<{exit_code: number, stdout_lines: number, stderr_lines: number, duration_ms: number}>}
 */
function spawnGraph(graphFile, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let stdoutLines = 0;
    let stderrLines = 0;

    const child = spawn("node", [path.join(COGNITIVE_ENGINE_DIR, graphFile), ...args], {
      cwd: COGNITIVE_ENGINE_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    child.stdout.on("data", (data) => {
      const line = data.toString().trim();
      if (line) {
        stdoutLines += 1;
        if (opts.onLog) try { opts.onLog(line, "stdout"); } catch {}
      }
    });
    child.stderr.on("data", (data) => {
      const line = data.toString().trim();
      if (line && !line.includes("ExperimentalWarning")) {
        stderrLines += 1;
        if (opts.onLog) try { opts.onLog(line, "stderr"); } catch {}
      }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exit_code: code,
        stdout_lines: stdoutLines,
        stderr_lines: stderrLines,
        duration_ms: Date.now() - start,
        graph: graphFile,
      });
    });
  });
}

/**
 * Register the three factory pipeline handlers on a Phase 14-A registry.
 * Idempotent: re-registering replaces the prior handler for the same kind.
 *
 * @param {object} registry           result of createHandlerRegistry()
 * @param {object} [opts]
 * @param {(kind: string, line: string, jobId: string) => void} [opts.onLog]
 *   Called for every stdout/stderr line from the spawned graph. Useful
 *   for piping back into a telemetry SSE stream so the Live Trace
 *   panel still sees pipeline output.
 */
export function registerFactoryHandlers(registry, opts = {}) {
  if (!registry?.register) throw new Error("registerFactoryHandlers: registry required");

  // pre_dev — body.payload should carry { task: <FRS text>, projectName?: string }
  registry.register("pre_dev", async (job /*, ctx */) => {
    const task = job.payload?.task ?? "";
    if (!task) throw new Error(`pre_dev job ${job.id}: payload.task required`);
    const args = [task];
    return spawnGraph("pre_dev_graph.js", args, {
      onLog: (line, kind) => opts.onLog?.("pre_dev", `[${kind}] ${line.substring(0, 240)}`, job.id),
    });
  });

  // dev — body.payload should carry { project: <project-dir-name> }
  registry.register("dev", async (job) => {
    const project = job.payload?.project;
    if (!project) throw new Error(`dev job ${job.id}: payload.project required`);
    return spawnGraph("dev_graph.js", [project], {
      onLog: (line, kind) => opts.onLog?.("dev", `[${kind}] ${line.substring(0, 240)}`, job.id),
    });
  });

  // post_dev — body.payload should carry { project: <project-dir-name> }
  registry.register("post_dev", async (job) => {
    const project = job.payload?.project;
    if (!project) throw new Error(`post_dev job ${job.id}: payload.project required`);
    return spawnGraph("post_dev_graph.js", [project], {
      onLog: (line, kind) => opts.onLog?.("post_dev", `[${kind}] ${line.substring(0, 240)}`, job.id),
    });
  });

  return registry;
}

/**
 * Convenience — return the kinds this module registers (for UI choice
 * lists, smoke-test assertions, etc.).
 */
export function factoryHandlerKinds() {
  return ["pre_dev", "dev", "post_dev"];
}
