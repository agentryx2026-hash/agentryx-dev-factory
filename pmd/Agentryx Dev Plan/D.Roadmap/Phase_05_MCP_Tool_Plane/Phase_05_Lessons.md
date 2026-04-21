# Phase 5 — Lessons Learned

Phase 5-A closed: 2026-04-21. Duration: single session.

## What surprised us

1. **MCP reference servers are turnkey via `npx -y`.** No build step, no install step, no local clone. `npx -y @modelcontextprotocol/server-filesystem ${PROJECT_DIR}` just works. This makes catalogue expansion cheap — adding a new server is a JSON entry, not a dependency decision.

2. **Filesystem MCP server exposes 14 tools out of the box, not just 3.** I planned to map file_read/write/list. The real server also advertises `read_multiple_files`, `edit_file` (line-based diff), `directory_tree` (JSON recursive), `search_files`, `get_file_info`, `move_file`. These are latent capability upgrades the bridge doesn't expose yet — future enhancement path in Phase 5-B or later.

3. **Client-side connection caching is essential, not optional.** First invocation spawns a subprocess (~200ms). Without a cache, every tool call spawns a new subprocess = unusable latency. `_connections` Map keyed by server name fixed it, but the lifecycle (when to `disconnectAll`) becomes a question for graph runners.

4. **Pre-phase code survey paid off again.** Per Phase 4 Lesson #2, I did `grep -l "from.*tools"` before scoping and discovered 5 graph files import from `tools.js`. That insight directly shaped D92 (alongside, not replacing) and D95 (name-match bridge). Without it I'd have proposed a rewrite scope.

## What to do differently

1. **Bridge should expose richer MCP capabilities, not just mirror tools.js.** Phase 5-B or a later pass should add DynamicTools for `edit_file`, `directory_tree`, `search_files`. The bridge is currently a lowest-common-denominator adapter; it leaves the MCP server's value on the table.

2. **Add a `disconnectAll()` hook to graph runners in 5-B.** If 5-B wires graphs to MCP, they must call `disconnectAll()` on completion (or `process.on('exit', …)`) else subprocesses leak until node exits. Document this as part of the 5-B PR.

3. **Smoke test script should live long-term, not just in scaffolding.** `mcp/smoke-test.js` is genuinely useful as a reproducible "is MCP still working?" probe. Keep it, don't delete. Future regressions will show here first.

## What feeds next phases

### Phase 5-B (deferred) — graph integration
- One-line import swaps per graph file using named-alias pattern (D95).
- Needs `disconnectAll()` wired into graph completion handlers.
- Needs E2E validation on a real LLM run → blocked on OpenRouter credit, same as Phase 4.

### Phase 7 — Memory Layer
- `postgres` MCP server already catalogued (disabled). Phase 7 flips it on and wires memory reads/writes through MCP instead of direct `pg` pool. Gives admin UI (Phase 12) a clean abstraction boundary.

### Phase 10 — Courier External Comms
- `github` MCP server catalogued. Phase 10 uses it for issue/PR operations instead of custom `gh` CLI wrapping. Requires `GITHUB_PERSONAL_ACCESS_TOKEN` plumbing.
- Same pattern will apply to Slack MCP when we adopt it.

### Phase 12 — B7 Full Admin Module
- `mcp/configs/servers.json` is the starting schema. Phase 12 promotes this to a Postgres table with per-project / per-agent scoping. Admin UI toggles `enabled` and edits `args` via CRUD.

### Phase 18 — Pipeline Module Marketplace
- Each marketplace module could declare which MCP servers it requires. Installing a module = appending to `servers.json`. Ecosystem compatibility for free.

## Stats

- **1 session**
- **$0.00 spent** (no LLM calls; scaffolding only)
- **1 dependency added**: `@modelcontextprotocol/sdk@1.29.0` (76 transitive packages)
- **4 files created**: `mcp/client.js` (76 lines), `mcp/bridge.js` (~60 lines), `mcp/configs/servers.json`, `mcp/README.md`, `mcp/smoke-test.js`
- **0 files modified**: `tools.js` and 5 graph files untouched
- **4 phase docs**: Plan (expanded from sketch), Status, Decisions, Lessons
- **5 Decisions**: D92-D96

## Phase 5-A exit criteria — met

- ✅ `@modelcontextprotocol/sdk` installed (v1.29.0)
- ✅ `mcp/client.js` — stdio connect / listTools / callTool / disconnectAll working
- ✅ `mcp/configs/servers.json` — 4 servers catalogued
- ✅ `mcp/bridge.js` — 3 LangChain DynamicTools with name-parity to tools.js
- ✅ `mcp/smoke-test.js` — **verified end-to-end**: filesystem server spawned, 14 tools advertised, `list_directory` returned real output
- ✅ `mcp/README.md` — full usage + catalog + lifecycle
- ✅ Zero graph files modified → zero regression risk
- ⏳ 5-B graph integration deferred (same credit constraint as Phase 4 E2E)

Phase 5-A is **wired, tested, and ready**. 5-B opens when OpenRouter credit allows an end-to-end LLM validation run.
