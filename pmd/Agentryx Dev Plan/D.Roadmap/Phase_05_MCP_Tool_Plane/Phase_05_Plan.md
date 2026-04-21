# Phase 5 — MCP Tool Plane

**One-liner**: Replace custom `tools.js` (filesystem, git, terminal, broadcast) with MCP servers. Adopt Anthropic's Model Context Protocol so the factory plugs into the broader MCP ecosystem (filesystem, github, postgres, browser, slack, etc.).

## Context (pre-phase code survey)

Per Phase 4 Lesson #1 ("read existing code before scoping"):

- `cognitive-engine/tools.js` (200 lines) exposes 5 LangChain `DynamicTool` instances + helpers:
  - `fileReadTool`, `fileWriteTool`, `fileListTool`, `terminalTool`, `gitTool`
  - `broadcastTelemetry`, `broadcastWorkItem`, `setProjectDir`, `getProjectDir`, `readTemplate`, `cleanProjectForDev`
- 5 graph files consume these imports: `pre_dev_graph.js`, `dev_graph.js`, `post_dev_graph.js`, `factory_graph.js`, `graph.js`
- All tool calls are scoped to `_projectDir` (in-module state).
- `@modelcontextprotocol/sdk` installed this phase (v1.29.0).

## Design decision

**Do not hard-cutover `tools.js`.** Instead:

1. Build MCP subsystem in parallel under `cognitive-engine/mcp/`.
2. Expose an `mcpToolsBridge.js` that returns LangChain `DynamicTool` instances backed by MCP server calls — drop-in replacement API for `fileReadTool` etc.
3. Feature-flag via `USE_MCP_TOOLS` env var. Default OFF (`tools.js` path unchanged).
4. Graph files get a thin shim that chooses the source based on the flag.

This mirrors Phase 4 D89 (`PRE_DEV_USE_GRAPH` feature flag) — zero production regression, one-line rollback.

## Scope for this phase (5-A: scaffolding)

| Sub | What | Deliverable |
|---|---|---|
| 5-A.1 | MCP SDK installed | `package.json` updated, lockfile regenerated |
| 5-A.2 | `mcp/client.js` | Spawns/connects to an MCP server via stdio transport; lists tools; calls tool |
| 5-A.3 | `mcp/configs/servers.json` | Catalog of usable MCP servers (filesystem, git, github, etc.) with launch config |
| 5-A.4 | `mcp/bridge.js` | Exports LangChain `DynamicTool`s that proxy to MCP — drop-in for tools.js names |
| 5-A.5 | `mcp/README.md` | How to add a new MCP server; how to enable flag |
| 5-A.6 | Feature flag `USE_MCP_TOOLS` | Documented; default off; no graph code changed yet |

**Out of scope for Phase 5-A** (deferred to 5-B):

- Actually switching graph files to import from bridge
- Running real LLM pipeline through MCP (requires OpenRouter credit anyway)
- Wrapping our custom tools as an MCP server for external consumption
- GitHub/Postgres MCP server integration (Phase 10+ as needed)

## Why this scope is right

- **Configurability-first**: Building the switch, not flipping it. Factory memory P8.
- **Earn replacement rights**: Per Master_Factory_Architect.md, we don't replace `tools.js` until we've suffered enough failures to justify it. For now, MCP is the *alternative* path, not the default.
- **R&D mode**: v0.0.1 is comparison mode. Let both paths exist, measure later.

## Phase close criteria

- ✅ MCP SDK installed
- ✅ `mcp/` directory scaffolded (client, bridge, config, README)
- ✅ `USE_MCP_TOOLS` flag documented in telemetry.mjs env notes
- ✅ No graph files modified (zero regression guarantee)
- ✅ Phase docs: Status, Decisions (D92-D9x), Lessons
- ⏳ Real MCP server connection test deferred — requires picking one server to validate (likely filesystem) and running a smoke test

## Decisions expected

- **D92**: MCP alongside, not replacing, tools.js
- **D93**: stdio transport as default (vs sse/http) — spawn subprocess per server
- **D94**: `servers.json` as a flat catalog, not per-task (admin UI Phase 12 can slice later)
- **D95**: Bridge exposes DynamicTools with identical names to tools.js — drop-in swap
