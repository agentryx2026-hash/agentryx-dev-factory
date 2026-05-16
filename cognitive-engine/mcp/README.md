# MCP Tool Plane

Model Context Protocol (MCP) subsystem for the cognitive-engine. Provides an alternative tool backend to `../tools.js`, feature-flagged via `USE_MCP_TOOLS`.

## Status: Phase 5-A scaffolding + 5-B graph rewire

Substrate shipped 2026-04-21 (5-A). Graph rewire shipped 2026-05-10 (5-B). Flag defaults off; flipping to `USE_MCP_TOOLS=true` makes the 5 graph files route filesystem ops through the MCP filesystem server instead of in-process Node fs. **End-to-end LLM validation pending** until OpenRouter credit allows a paid cycle on the flag-on path.

## Files

- `client.js` — MCP client wrapper. Spawns stdio subprocess per server, caches connections, exposes `listTools` / `callTool` / `disconnectAll`.
- `bridge.js` — LangChain `DynamicTool` instances that proxy to MCP servers. Drop-in API shape for `tools.js` names (`fileReadTool`, `fileWriteTool`, `fileListTool`).
- `configs/servers.json` — Server catalog with launch config. Placeholders `${PROJECT_DIR}` and `${WORKSPACE_ROOT}` are resolved at connect time.
- `../tool-selector.js` — Phase 5-B flag-aware re-export. Graphs import file tools from here.
- `../tool-selector.smoke.js` — 32-assertion smoke for the rewire.

## Environment flag

```
USE_MCP_TOOLS=true    # 5-B onwards: graphs route file_* tools through this bridge
                      # 5-A only: substrate present, no graph used it yet
                      # Default off — every existing pipeline keeps tools.js behaviour
```

Flag is checked at module-load time inside `tool-selector.js`. Flipping the flag requires a telemetry restart for the new selection to take effect — consistent with every other factory flag.

## Phase 5-B integration (active)

Graphs no longer import file tools from `tools.js` directly:

```js
// Before (5-A and earlier)
import { fileReadTool, fileWriteTool, fileListTool, terminalTool, ... } from "./tools.js";

// After (5-B)
import { fileReadTool, fileWriteTool, fileListTool } from "./tool-selector.js";
import { terminalTool, ... } from "./tools.js";
```

The selector resolves to tools.js (flag off — same instances as before) or bridge.js (flag on) at module load. `terminalTool`, `gitTool`, telemetry helpers, `setProjectDir`, `getProjectDir`, `readTemplate`, `cleanProjectForDev` stay in `tools.js` — they have no MCP equivalents in 5-B's scope.

## Adding a new MCP server

1. Add entry to `configs/servers.json` with `enabled`, `transport`, `command`, `args`, `env` (secret names only), `maps_to_tools`.
2. If it backs existing LangChain tools (`terminalTool`, `gitTool`), add a new exported `DynamicTool` in `bridge.js` that calls `callTool(serverName, toolName, args)`.
3. Smoke test with a standalone node script before flipping `USE_MCP_TOOLS`.

## Currently catalogued

| Server | Enabled | Maps to | Notes |
|---|---|---|---|
| filesystem | ✅ | file_read, file_write, file_list | Reference server, scoped to `${PROJECT_DIR}` |
| git | ❌ | git_operation | Enable when repo-inside-project-dir pattern adopted |
| github | ❌ | github_* | Phase 10 Courier; needs `GITHUB_PERSONAL_ACCESS_TOKEN` |
| postgres | ❌ | postgres_query | Phase 7 memory / Phase 12 admin |

## Connection lifecycle

- Connections are lazy + cached per server name in `client.js:_connections`.
- `disconnectAll()` should be called by process shutdown hooks. Graph nodes do not currently call it (subprocesses exit with node process).
- Each graph run reuses the same connection across tool calls — subprocess is NOT per-call.

## Design notes

- **stdio transport first** — every official reference MCP server supports stdio; avoids HTTP port management.
- **Bridge names match tools.js** — drop-in replacement, no graph code rewrites in Phase 5-A.
- **tools.js stays authoritative** — Phase 5-A does not delete it. Phase 5-B may make graphs switch-aware.

## Rollback

Set `USE_MCP_TOOLS=false` (or unset). Phase 5-A has no runtime effect regardless.
