import { DynamicTool } from "@langchain/core/tools";
import { connectServer, callTool } from "./client.js";
import { getProjectDir, getWorkspaceRoot } from "../tools.js";

function ctx() {
  return { projectDir: getProjectDir(), workspaceRoot: getWorkspaceRoot() };
}

async function extractTextResult(result) {
  if (!result || !result.content) return "";
  return result.content
    .filter(c => c.type === "text")
    .map(c => c.text)
    .join("\n");
}

export const mcpFileReadTool = new DynamicTool({
  name: "file_read",
  description: "Reads a file from the current project (MCP-backed). Input is the relative file path.",
  func: async (filePath) => {
    try {
      await connectServer("filesystem", ctx());
      const res = await callTool("filesystem", "read_text_file", { path: filePath });
      return await extractTextResult(res);
    } catch (e) {
      return `MCP Error reading file: ${e.message}`;
    }
  },
});

export const mcpFileWriteTool = new DynamicTool({
  name: "file_write",
  description: "Writes content to a file in the current project (MCP-backed). Input: JSON string with 'path' and 'content' keys.",
  func: async (inputStr) => {
    try {
      const { path: filePath, content } = JSON.parse(inputStr);
      await connectServer("filesystem", ctx());
      const res = await callTool("filesystem", "write_file", { path: filePath, content });
      await extractTextResult(res);
      return `MCP File written: ${filePath}`;
    } catch (e) {
      return `MCP Error writing file: ${e.message}`;
    }
  },
});

export const mcpFileListTool = new DynamicTool({
  name: "file_list",
  description: "Lists files/directories in the current project (MCP-backed). Input: relative directory path (use '.' for root).",
  func: async (dirPath) => {
    try {
      await connectServer("filesystem", ctx());
      const res = await callTool("filesystem", "list_directory", { path: dirPath });
      return await extractTextResult(res);
    } catch (e) {
      return `MCP Error listing: ${e.message}`;
    }
  },
});

export function getMcpTools() {
  return {
    fileReadTool: mcpFileReadTool,
    fileWriteTool: mcpFileWriteTool,
    fileListTool: mcpFileListTool,
  };
}
