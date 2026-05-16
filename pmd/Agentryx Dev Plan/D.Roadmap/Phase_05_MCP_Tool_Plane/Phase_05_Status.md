# Phase 5 — Status: 5-A + 5-B COMPLETE ✅  (end-to-end LLM validation deferred until OpenRouter cycle)

**Phase started**: 2026-04-21
**Phase 5-A closed**: 2026-04-21 (substrate — MCP SDK, client, bridge, filesystem server catalogued)
**Phase 5-B closed**: 2026-05-10 (flag-aware tool-selector + 5 graphs rewired + 32-assertion smoke)
**Duration**: 5-A single session; 5-B ~30 min over the substrate

## Phase 5-B — what shipped (2026-05-10)

**`cognitive-engine/tool-selector.js`** (new, ~45 lines):
- Re-exports `fileReadTool` / `fileWriteTool` / `fileListTool` from either `tools.js` (default) or `mcp/bridge.js` based on `USE_MCP_TOOLS` at module-load time
- `activeBackend()` introspection helper returns `"tools"` or `"mcp"` for UI / smoke-test consumption
- Non-filesystem tools (`terminalTool`, `gitTool`, telemetry helpers, `setProjectDir` / `getProjectDir`, `readTemplate`, `cleanProjectForDev`) stay in `tools.js` — they don't have MCP equivalents yet and the substrate doesn't try to invent them

**5 graphs rewired** to import file tools from `tool-selector.js`:
- `pre_dev_graph.js`, `dev_graph.js`, `post_dev_graph.js`, `factory_graph.js`, `graph.js`
- Each file: 1-line import change (file tools from selector; everything else from tools.js as before)
- Zero behaviour change when `USE_MCP_TOOLS` is off (default) — selector re-exports the exact same DynamicTool instances tools.js already exports

**Smoke test** — `cognitive-engine/tool-selector.smoke.js`:
- **32 assertions** total
  - 7 verify selector with flag off → tools.js instances + correct names
  - 7 verify selector with flag on → bridge.js instances + correct names
  - 15 across the 5 graphs: each parses cleanly (`node --check`), imports from `./tool-selector.js`, and no longer imports `file*Tool` from `./tools.js` (regression guard)
  - 3 verify tools.js exports are unchanged (the 11 expected symbols)
- Two child Node processes test both flag states honestly — selector resolves at module load, so an in-process flag flip wouldn't take effect
- Graph files are NOT imported by the smoke test — each has `main().catch(...)` at the bottom which would auto-run the pipeline on import (lesson learned mid-implementation). `node --check` (syntax-only) is the right tool

**Why module-load resolution (not per-call)**:
- Matches Phase 12-B `applyFlagOverrides()` which also runs once at boot
- Per-call would require re-importing the right module on every tool invocation (slow + cache-busting)
- Flag changes already require telemetry restart for every other flag in the factory — this is consistent

## What stays for the full 5-B validation pass

- **Real MCP server install**: `npx -y @modelcontextprotocol/server-filesystem` runs on demand at first tool call. Founder action — flip `USE_MCP_TOOLS=true`, run a pipeline once, confirm filesystem ops go through the subprocess (process tree should show the MCP server alongside the graph)
- **End-to-end LLM run** with flag on: needs OpenRouter credit. Confirms parity (same project structure produced) and measures any latency hit (MCP stdio round-trip vs in-process function call)
- **Disconnect lifecycle**: MCP client caches connections forever (Phase 5-A README notes this). 5-B's rewire doesn't change that; if the founder leaves `USE_MCP_TOOLS=true` long-term, a `disconnectAll()` hook on telemetry shutdown becomes worth wiring (small cleanup, low priority)
- **Other MCP servers** (git, github, postgres): catalogued but disabled. Each gets enabled when its consuming phase ships (e.g. git when repo-in-project-dir pattern lands; github when 10-B Courier wires its app install)

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 5-A.1 | MCP SDK installed (`@modelcontextprotocol/sdk@1.29.0`) | ✅ done |
| 5-A.2 | `mcp/client.js` — stdio transport, connect/list/call, connection cache | ✅ done |
| 5-A.3 | `mcp/configs/servers.json` — 4 servers catalogued (filesystem enabled, 3 disabled) | ✅ done |
| 5-A.4 | `mcp/bridge.js` — 3 DynamicTools (file_read/write/list) backed by MCP | ✅ done |
| 5-A.5 | `mcp/README.md` — catalog, env flag, lifecycle, rollback notes | ✅ done |
| 5-A.6 | `USE_MCP_TOOLS` flag documented (no runtime effect in 5-A) | ✅ done |
| 5-A.7 | Smoke test: real filesystem MCP server spawn + list_directory | ✅ done — 14 tools advertised, directory listing returned |
| 5-B.1 | `tool-selector.js` — flag-aware file tool re-exports | ✅ done |
| 5-B.2 | Rewire 5 graphs to import file tools from selector | ✅ done |
| 5-B.3 | `tool-selector.smoke.js` — 32 assertions (selector + graph parse + tools.js regression) | ✅ done — all pass |
| 5-B.4 | End-to-end LLM validation with flag on | ⏳ deferred until OpenRouter cycle |

## What shipped

### `cognitive-engine/package.json`
- `+ @modelcontextprotocol/sdk@1.29.0`

### `cognitive-engine/mcp/client.js` (new, 76 lines)
- `loadServersConfig()`, `connectServer()`, `listTools()`, `callTool()`, `disconnectAll()`, `isEnabled()`
- stdio transport via `StdioClientTransport`
- Connection cache keyed by server name (lazy, reused across calls)
- Placeholder resolution: `${PROJECT_DIR}`, `${WORKSPACE_ROOT}`

### `cognitive-engine/mcp/bridge.js` (new, ~60 lines)
- `mcpFileReadTool`, `mcpFileWriteTool`, `mcpFileListTool` — LangChain `DynamicTool` instances
- Names match `tools.js` (`file_read`, `file_write`, `file_list`) — drop-in API
- `extractTextResult()` helper flattens MCP content arrays to string

### `cognitive-engine/mcp/configs/servers.json` (new)
- **filesystem** — enabled, `@modelcontextprotocol/server-filesystem` via `npx -y`, scoped to `${PROJECT_DIR}`
- **git** — disabled, pending repo-in-project-dir pattern
- **github** — disabled, Phase 10 Courier
- **postgres** — disabled, Phase 7 memory / Phase 12 admin

### `cognitive-engine/mcp/smoke-test.js` (new)
- Standalone verification: connects filesystem server, lists tools, invokes `list_directory`
- **Ran successfully**: 14 tools advertised, actual workspace listing returned

### `cognitive-engine/mcp/README.md` (new)
- Usage, catalog table, env flag, add-new-server instructions, lifecycle, rollback

### Graph files: UNCHANGED
- `pre_dev_graph.js`, `dev_graph.js`, `post_dev_graph.js`, `factory_graph.js`, `graph.js` still import from `tools.js`.
- Zero regression risk.

## Why 5-B deferred

5-B = making graph nodes switch-aware on `USE_MCP_TOOLS`. This requires:
- Shimming imports in 5 graph files, OR
- Runtime tool-registry swap (cleaner but bigger refactor)

Both approaches should be validated with an end-to-end run, which currently needs OpenRouter credit top-up (same constraint as Phase 4). Better to close 5-A clean and open 5-B when we're going to validate end-to-end anyway.

## USE_MCP_TOOLS flag

Currently inherited by graph subprocesses via `telemetry.mjs:199` (`env: { ...process.env }`). No changes needed in endpoint. In 5-B, graphs will inspect this flag and swap tool sources.

## Feature-flag posture (P8 configurability-first)

| Flag | Default | Effect |
|---|---|---|
| `PRE_DEV_USE_GRAPH` | off | Phase 4 — template subst vs real LLM graph |
| `USE_MCP_TOOLS` | off | Phase 5 — **no runtime effect in 5-A**; 5-B will swap tool backend |

## Phase 5-A exit criteria — met

- ✅ MCP SDK installed + working
- ✅ Client can connect to a real MCP server via stdio
- ✅ Bridge exposes LangChain-compatible DynamicTools
- ✅ Smoke test verified end-to-end (not just syntactic)
- ✅ Zero changes to `tools.js` or graph files → zero regression
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 5-B integration deferred to when OpenRouter credit allows E2E validation

**Phase 5-A is wired and ready.** Flip `USE_MCP_TOOLS=true` in 5-B's graph shim once that's built.
