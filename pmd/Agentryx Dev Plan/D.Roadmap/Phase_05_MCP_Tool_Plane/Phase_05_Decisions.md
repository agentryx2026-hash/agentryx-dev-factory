# Phase 5 — Decisions Log

## D92 — MCP subsystem lives ALONGSIDE `tools.js`, not replacing it

**What**: Phase 5-A builds `cognitive-engine/mcp/` as a parallel tool plane. `tools.js` is untouched. Graph files continue to import from `tools.js`. MCP is opt-in via `USE_MCP_TOOLS` flag (no runtime effect in 5-A).

**Why**:
- **Zero regression**: factory today works end-to-end with `tools.js`. Ripping it out before MCP is proven in production is reckless.
- **Earn replacement rights** (per Master_Factory_Architect.md): we replace custom code only after we've suffered enough failures to justify the swap. `tools.js` has not failed yet.
- **R&D comparison mode** (v0.0.1 band): both paths coexist so we can measure cost, latency, reliability before committing.
- Mirrors Phase 4 D89 (`PRE_DEV_USE_GRAPH`) — feature-flagged alternative, not hard cutover.

**Implication for 5-B**: wiring graphs to switch on the flag is a deliberate, isolated subphase. Rollback = flip flag off.

## D93 — stdio transport as default (not SSE/HTTP)

**What**: `mcp/client.js` only supports `transport: "stdio"`. Other transports throw.

**Why**:
- Every official reference MCP server supports stdio.
- No HTTP port management, no localhost conflicts, no auth to configure.
- Per-server subprocess isolation comes free.
- SSE/HTTP transports can be added to `client.js` later when a specific server requires them (e.g., a hosted MCP service).

**Tradeoff**: subprocess spawn cost per factory run (~200ms). Acceptable since connection is cached for the life of the process.

## D94 — `servers.json` is a flat catalog, not per-task or per-agent

**What**: All MCP servers live in a single JSON file with an `enabled` flag each. Agents / task tiers do NOT get their own server lists yet.

**Why**:
- 4 servers catalogued (only filesystem enabled). Slicing by agent/task tier is premature.
- Phase 12 admin UI will need a structured source-of-truth; easier to slice from a flat catalog later than to merge scattered configs.
- Keeps the mental model simple: one place to see "what MCP servers do we have."

**Migration path**: Phase 12 may promote this to Postgres with agent/tier/project scoping. At that point `servers.json` becomes the seed file.

## D95 — Bridge exports names that match `tools.js` exactly

**What**: `mcp/bridge.js` exports `mcpFileReadTool` (DynamicTool with `name: "file_read"`), not `mcpReadTool` or `mcp.fileRead`. Drop-in name-match.

**Why**:
- Phase 5-B integration becomes a one-line import swap per graph file:
  ```js
  // Before
  import { fileReadTool, fileWriteTool, fileListTool } from "./tools.js";
  // After (5-B)
  import { mcpFileReadTool as fileReadTool,
           mcpFileWriteTool as fileWriteTool,
           mcpFileListTool as fileListTool } from "./mcp/bridge.js";
  ```
- LangChain tool registrations rely on the `name` field for LLM tool-call matching. Name divergence would require re-writing every agent prompt. Hard no.

**Consequence**: adding a new MCP-backed tool in bridge.js MUST preserve the `name:` used by tools.js.

## D96 — 5-B (graph integration) deferred until OpenRouter credit allows E2E validation

**What**: Phase 5 closes at 5-A (scaffolding). Wiring graph nodes to use MCP under the flag happens in 5-B, but not this session.

**Why**:
- Wiring without validating end-to-end is half-work. Would need a real LLM pipeline run to confirm agents can successfully call file tools through MCP.
- OpenRouter credit state (same constraint as Phase 4) blocks cheap E2E testing of architect-tier agents.
- Closing 5-A clean now keeps the phase boundary crisp. 5-B opens when validation is possible (same trigger as Phase 4 E2E: credit top-up or architect-tier downshift).

**Cost estimate for 5-B**: ~1 session, ~$0.50-2 in LLM costs for validation run (on Opus) or ~$0.10-0.30 on Haiku.
