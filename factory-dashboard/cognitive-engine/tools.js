import { DynamicTool } from "@langchain/core/tools";
import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const WORKSPACE = "/home/subhash.thakur.india/Projects/agent-workspace";

// ═══════════════════════════════════════════════════════════
//   TELEMETRY BRIDGE — Updates Dashboard in real-time
// ═══════════════════════════════════════════════════════════
export async function broadcastTelemetry(agentId, room, status, logMessage) {
    try {
        await fetch('http://localhost:4401/api/telemetry/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId, room, status, log: logMessage })
        });
    } catch(e) { /* Dashboard may not be running */ }
}

export async function broadcastWorkItem(action, id, name, room, color) {
    try {
        await fetch('http://localhost:4401/api/telemetry/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workItem: { action, id, name, room, color } })
        });
    } catch(e) { /* Dashboard may not be running */ }
}

// ═══════════════════════════════════════════════════════════
//   SCOTTY'S TOOLS — File System & Terminal
// ═══════════════════════════════════════════════════════════
export const fileReadTool = new DynamicTool({
  name: "file_read",
  description: "Reads a file from the agent workspace. Input is the relative file path.",
  func: async (filePath) => {
    try {
      const fullPath = path.join(WORKSPACE, filePath);
      const content = await fs.readFile(fullPath, "utf-8");
      return content;
    } catch (e) {
      return `Error reading file: ${e.message}`;
    }
  },
});

export const fileWriteTool = new DynamicTool({
  name: "file_write",
  description: "Writes content to a file in the agent workspace. Input: JSON string with 'path' and 'content' keys.",
  func: async (inputStr) => {
    try {
      const { path: filePath, content } = JSON.parse(inputStr);
      const fullPath = path.join(WORKSPACE, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
      return `✅ File written: ${fullPath}`;
    } catch (e) {
      return `Error writing file: ${e.message}`;
    }
  },
});

export const fileListTool = new DynamicTool({
  name: "file_list",
  description: "Lists files and directories in a given path within the workspace. Input: relative directory path (use '.' for root).",
  func: async (dirPath) => {
    try {
      const fullPath = path.join(WORKSPACE, dirPath);
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
    } catch (e) {
      return `Error listing: ${e.message}`;
    }
  },
});

export const terminalTool = new DynamicTool({
  name: "terminal",
  description: "Runs a bash command in the agent workspace. Input: the exact command string.",
  func: async (command) => {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: WORKSPACE, timeout: 30000 });
      return `STDOUT:\n${stdout}${stderr ? `\nSTDERR:\n${stderr}` : ''}`;
    } catch (e) {
      return `Error: ${e.message}\n${e.stdout || ''}\n${e.stderr || ''}`;
    }
  },
});

// ═══════════════════════════════════════════════════════════
//   LAFORGE'S TOOLS — Git Operations
// ═══════════════════════════════════════════════════════════
export const gitTool = new DynamicTool({
  name: "git_operation",
  description: "Runs a git command in the agent workspace. Input: git subcommand and args (e.g. 'status', 'add .', 'commit -m \"fix\"', 'push origin main').",
  func: async (gitArgs) => {
    try {
      const { stdout, stderr } = await execAsync(`git ${gitArgs}`, { cwd: WORKSPACE, timeout: 30000 });
      return `GIT:\n${stdout}${stderr ? `\n${stderr}` : ''}`;
    } catch (e) {
      return `Git Error: ${e.message}`;
    }
  },
});
