# MCP Tool Plane

Model Context Protocol (MCP) subsystem for the cognitive-engine. Provides an alternative tool backend to `../tools.js`, feature-flagged via `USE_MCP_TOOLS`.

## Status: Phase 5-A scaffolding

Built but **not wired into graph nodes**. Flag defaults off. Flipping the flag without wiring changes currently has no effect — see Phase 5-B for integration.

## Files

- `client.js` — MCP client wrapper. Spawns stdio subprocess per server, caches connections, exposes `listTools` / `callTool` / `disconnectAll`.
- `bridge.js` — LangChain `DynamicTool` instances that proxy to MCP servers. Drop-in API shape for `tools.js` names (`fileReadTool`, `fileWriteTool`, `fileListTool`).
- `configs/servers.json` — Server catalog with launch config. Placeholders `${PROJECT_DIR}` and `${WORKSPACE_ROOT}` are resolved at connect time.

## Environment flag

```
USE_MCP_TOOLS=true    # Phase 5-B onwards: graph nodes import from bridge instead of tools.js
                      # Phase 5-A: flag has no runtime effect yet
```

Flag is checked via `client.js`'s `isEnabled()` export.

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
