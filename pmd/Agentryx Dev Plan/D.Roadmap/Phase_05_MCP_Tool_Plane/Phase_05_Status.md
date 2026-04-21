# Phase 5 — Status: 5-A COMPLETE ✅  (5-B DEFERRED)

**Phase started**: 2026-04-21
**Phase 5-A closed**: 2026-04-21
**Duration**: single session

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
| 5-B | Wire graph nodes to import from bridge under flag | ⏳ DEFERRED |

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
