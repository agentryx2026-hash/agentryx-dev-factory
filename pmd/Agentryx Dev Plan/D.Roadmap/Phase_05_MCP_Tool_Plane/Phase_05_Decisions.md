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

## D215 — 5-B uses a tool-selector module, not per-graph flag checks (added 2026-05-10)

**What**: Phase 5-B rewires graphs by introducing `cognitive-engine/tool-selector.js` — a single module that re-exports `fileReadTool` / `fileWriteTool` / `fileListTool` from either `tools.js` (default) or `mcp/bridge.js` (when `USE_MCP_TOOLS=true`). Graphs import file tools from the selector and everything else from `tools.js` as before. The selector resolves at module load.

**Why one selector module, not per-graph `if (USE_MCP_TOOLS)` checks**:
- **Single switch surface**: flipping the flag affects every graph identically — no risk of `pre_dev_graph` going MCP while `dev_graph` stays on tools.js because someone forgot to thread the check through every node.
- **Diff is one line per graph** (vs ~5-10 if every node had its own ternary). Smaller blast radius if the rewire needs reverting.
- **Drop-in replacement preserved**: D95 already required bridge tools to share names with tools.js. The selector compounds that — graphs aren't even aware which backend they got. Adding a new MCP-backed tool category (e.g. `terminalTool`) later means extending the selector + bridge; graphs need no further change.
- **Mirrors Phase 14-A `handlerRegistry` / Phase 9-A `fixRouter` / Phase 13-A `nodeStubs` DI pattern**: dependency choice happens at one well-defined seam, not scattered through consumer code.

**Why module-load resolution (not per-call)**:
- Matches Phase 12-B `applyFlagOverrides()` which runs once at boot.
- Per-call would require re-importing the right module on every tool invocation — slow + breaks Node's module cache semantics.
- Every other flag in the factory already requires telemetry restart to take effect; this is consistent. Flag changes via Admin · Configuration still trigger a "🔄 Restart telemetry to apply" hint (existing Phase 12-B UX).

**Tradeoff acknowledged**: a partial-MCP graph (e.g. tuvok runs MCP, torres doesn't) isn't expressible. Not currently a real use case — the substrate gives us all-or-nothing today, and per-agent backend selection would need new config shape. Acceptable defer.

## D216 — Graph files are not import-safe; smoke tests use `node --check` (added 2026-05-10)

**What**: Every graph file (`pre_dev_graph.js`, `dev_graph.js`, `post_dev_graph.js`, `factory_graph.js`, `graph.js`) ends with `main().catch(...)` so that running `node <graph>.js` from the CLI executes the pipeline. A naive `import("./pre_dev_graph.js")` from a smoke test therefore tries to run the full pipeline (which hangs waiting for an LLM call or fails on missing API keys).

**Decision**: Smoke tests verify graphs by syntax-check (`node --check`) and regex-grep of the import lines, NOT by `import()`. This proves the rewire compiles and points at the new module without paying the auto-run cost.

**Why not refactor the graphs to guard `main()` with `if (import.meta.url === ...)`**:
- That refactor touches 5 production files in service of a smoke test — disproportionate.
- The current CLI ergonomic is genuinely useful (`node dev_graph.js "..."` is how graphs get run today and from queue handlers in Phase 14-B).
- The smoke test's job is to catch import-line typos and wrong-module errors, not to validate runtime behaviour. Syntax-check + grep nails both at a fraction of the cost.

**Recorded as a constraint for future smoke tests**: any test that needs to actually exercise graph runtime must spawn the graph as a subprocess with a controlled environment (mock LLM, test workspace dir, etc.) — never `import()` it in-process.

## Decision counter (Phase 5)

- D92–D96 — Phase 5-A substrate decisions
- D215, D216 — Phase 5-B rewire pattern + smoke-test constraint
- Future Phase 5 work continues from D217.
