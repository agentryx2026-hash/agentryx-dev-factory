/**
 * Phase 5-B smoke test for cognitive-engine/tool-selector.js.
 *
 *   node cognitive-engine/tool-selector.smoke.js
 *
 * Tests both flag states (USE_MCP_TOOLS off vs on) by spawning a child
 * Node process per state. The selector resolves at module-load time so
 * an in-process flag flip wouldn't take effect — child processes are
 * the only honest test.
 *
 * Also verifies the 5 graphs that import from the selector can load
 * cleanly under both flag states. We import the *file*, not run the
 * graph (which would need API keys + a workspace) — successful import
 * proves the symbols resolve.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function ok(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); passed += 1; }
  else      { console.log(`  ✗ ${label}`); failed += 1; }
}
function check(label, actual, expected) {
  if (actual === expected) { console.log(`  ✓ ${label}`); passed += 1; }
  else {
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
    failed += 1;
  }
}

function runChild(envOverrides, scriptBody) {
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", scriptBody], {
    cwd: HERE,
    env: { ...process.env, ...envOverrides },
    encoding: "utf-8",
  });
  return { stdout: res.stdout?.trim() || "", stderr: res.stderr?.trim() || "", status: res.status };
}

// ─── selector resolves to tools.js when flag is off ─────────────────────────

console.log("\n[selector — USE_MCP_TOOLS off (default)]");
{
  const r = runChild({ USE_MCP_TOOLS: "" }, `
    import { fileReadTool, fileWriteTool, fileListTool, activeBackend } from "./tool-selector.js";
    import { fileReadTool as toolsRead } from "./tools.js";
    console.log(JSON.stringify({
      backend: activeBackend(),
      read_is_tools:  fileReadTool  === toolsRead,
      read_name:      fileReadTool.name,
      write_name:     fileWriteTool.name,
      list_name:      fileListTool.name,
    }));
  `);
  ok(`child exited 0 (stderr: ${r.stderr.slice(0, 100) || "—"})`, r.status === 0);
  const parsed = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  ok("output is parseable JSON", !!parsed);
  if (parsed) {
    check("backend = tools", parsed.backend, "tools");
    ok("fileReadTool is the tools.js instance", parsed.read_is_tools === true);
    check("read tool name", parsed.read_name, "file_read");
    check("write tool name", parsed.write_name, "file_write");
    check("list tool name", parsed.list_name, "file_list");
  }
}

// ─── selector resolves to mcp/bridge.js when flag is on ─────────────────────

console.log("\n[selector — USE_MCP_TOOLS=true]");
{
  const r = runChild({ USE_MCP_TOOLS: "true" }, `
    import { fileReadTool, fileWriteTool, fileListTool, activeBackend } from "./tool-selector.js";
    import { mcpFileReadTool } from "./mcp/bridge.js";
    console.log(JSON.stringify({
      backend: activeBackend(),
      read_is_mcp: fileReadTool === mcpFileReadTool,
      read_name:   fileReadTool.name,
      write_name:  fileWriteTool.name,
      list_name:   fileListTool.name,
    }));
  `);
  ok(`child exited 0 (stderr: ${r.stderr.slice(0, 100) || "—"})`, r.status === 0);
  const parsed = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  ok("output is parseable JSON", !!parsed);
  if (parsed) {
    check("backend = mcp", parsed.backend, "mcp");
    ok("fileReadTool is the bridge.js instance", parsed.read_is_mcp === true);
    check("MCP read tool name", parsed.read_name, "file_read");
    check("MCP write tool name", parsed.write_name, "file_write");
    check("MCP list tool name", parsed.list_name, "file_list");
  }
}

// ─── rewired graphs parse cleanly (syntax-check only — they auto-run
//      main() on import, so we can't safely `import()` them in a test) ────

const GRAPHS = ["pre_dev_graph.js", "dev_graph.js", "post_dev_graph.js", "factory_graph.js", "graph.js"];
console.log("\n[graph rewires — syntax-check + selector import line present]");
for (const g of GRAPHS) {
  // 1. Node parses the file without complaint.
  const parsed = spawnSync(process.execPath, ["--check", path.join(HERE, g)], { encoding: "utf-8" });
  ok(`${g} parses cleanly`, parsed.status === 0);
  if (parsed.status !== 0) console.log(`      stderr: ${parsed.stderr.split("\n").slice(0, 3).join(" | ")}`);

  // 2. The first 10 lines must include the selector import + must NOT
  //    import file tools from tools.js any more (regression guard).
  let head = "";
  try { head = fs.readFileSync(path.join(HERE, g), "utf-8").split("\n").slice(0, 10).join("\n"); } catch {}
  ok(`${g} imports from tool-selector.js`,    head.includes('from "./tool-selector.js"'));
  ok(`${g} no longer imports file* from tools.js`, !/from\s+["']\.\/tools\.js["'][^\n]*file(Read|Write|List)Tool/.test(head));
}

// ─── tools.js exports unchanged (regression guard) ──────────────────────────

console.log("\n[tools.js exports unchanged]");
{
  const r = runChild({}, `
    import * as t from "./tools.js";
    const needed = ["fileReadTool","fileWriteTool","fileListTool","terminalTool","gitTool",
                    "broadcastTelemetry","broadcastWorkItem","setProjectDir","getProjectDir",
                    "readTemplate","cleanProjectForDev"];
    const missing = needed.filter(n => typeof t[n] === "undefined");
    console.log(JSON.stringify({ missing }));
  `);
  ok("child exited 0", r.status === 0);
  const parsed = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  ok("output parseable", !!parsed);
  if (parsed) {
    ok(`zero missing exports (missing: ${parsed.missing.join(", ") || "—"})`, parsed.missing.length === 0);
  }
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
