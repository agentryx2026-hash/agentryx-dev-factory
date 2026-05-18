/**
 * Phase 5-B — flag-aware tool selector.
 *
 * Phase 5-A built `mcp/bridge.js` with MCP-backed drop-in replacements
 * for the three filesystem tools in `tools.js` (`file_read`, `file_write`,
 * `file_list`). This module is the switch: graph files import their
 * filesystem tools from here instead of from `tools.js`, and at module-
 * load time the selector picks the backend based on `USE_MCP_TOOLS`.
 *
 * Why a separate module (not a flag check inside each graph):
 *   - Single switch surface — flipping the flag affects every graph
 *     identically.
 *   - Zero behaviour change when flag is off — the selector re-exports
 *     the exact same DynamicTool instances tools.js already exports.
 *   - The MCP path stays opt-in until Phase 5-B's full validation pass
 *     (real MCP server install + end-to-end LLM run) confirms parity.
 *
 * Non-filesystem tools (`terminalTool`, `gitTool`, telemetry helpers,
 * `setProjectDir` / `getProjectDir`, `readTemplate`, `cleanProjectForDev`)
 * stay in `tools.js` — they don't have MCP equivalents yet and the
 * substrate doesn't try to invent them. Graphs import the file tools
 * from this module and everything else from `tools.js` directly.
 *
 * Flag changes require a telemetry restart to take effect — the selector
 * resolves at module load, not per-invocation. Consistent with Phase
 * 12-B `applyFlagOverrides()` which also runs once at boot.
 */

import {
  fileReadTool as fsFileReadTool,
  fileWriteTool as fsFileWriteTool,
  fileListTool as fsFileListTool,
} from "./tools.js";
import {
  mcpFileReadTool,
  mcpFileWriteTool,
  mcpFileListTool,
} from "./mcp/bridge.js";

const MCP_ON = process.env.USE_MCP_TOOLS === "true";

export const fileReadTool  = MCP_ON ? mcpFileReadTool  : fsFileReadTool;
export const fileWriteTool = MCP_ON ? mcpFileWriteTool : fsFileWriteTool;
export const fileListTool  = MCP_ON ? mcpFileListTool  : fsFileListTool;

/**
 * Introspection helper — used by smoke test and the Phase 12-B Admin
 * Modules panel to show which backend is live without parsing env.
 */
export function activeBackend() {
  return MCP_ON ? "mcp" : "tools";
}
