import { DynamicTool } from "@langchain/core/tools";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const WORKSPACE_ROOT = "/home/subhash.thakur.india/Projects/agent-workspace";

// ═══════════════════════════════════════════════════════════
//   PROJECT SCOPING — Each task gets its own folder
// ═══════════════════════════════════════════════════════════
let _projectDir = WORKSPACE_ROOT; // Default: root (legacy)

export function setProjectDir(projectName, forceExactPath = false) {
    let dirName = "";
    if (forceExactPath) {
        dirName = projectName;
    } else {
        // Sanitize: lowercase, replace spaces with hyphens, remove special chars
        const safe = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 40);
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        dirName = `${date}_${safe}`;
    }
    
    _projectDir = path.join(WORKSPACE_ROOT, dirName);
    // Create the project directory structure
    fsSync.mkdirSync(path.join(_projectDir, 'src'), { recursive: true });
    fsSync.mkdirSync(path.join(_projectDir, 'tests'), { recursive: true });
    fsSync.mkdirSync(path.join(_projectDir, 'docs'), { recursive: true });
    fsSync.mkdirSync(path.join(_projectDir, 'PMD'), { recursive: true });
    return { dirName, fullPath: _projectDir };
}

export function getProjectDir() { return _projectDir; }
export function getWorkspaceRoot() { return WORKSPACE_ROOT; }

export async function cleanProjectForDev() {
    try {
        const entries = await fs.readdir(_projectDir);
        for (const entry of entries) {
            if (['PMD', '.git', 'docs', 'AGENT_STATE.md', 'README.md'].includes(entry)) continue;
            const fullPath = path.join(_projectDir, entry);
            await fs.rm(fullPath, { recursive: true, force: true });
        }
        fsSync.mkdirSync(path.join(_projectDir, 'src'), { recursive: true });
        fsSync.mkdirSync(path.join(_projectDir, 'tests'), { recursive: true });
        fsSync.mkdirSync(path.join(_projectDir, 'docs'), { recursive: true });
    } catch(e) {}
}

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
//   TEMPLATE TOOLS — Access PMD templates
// ═══════════════════════════════════════════════════════════
export async function readTemplate(docId) {
  try {
    // New structure: /PMD/Agentryx Dev Plan/{section}/{docId}*
    const newBase = "/home/subhash.thakur.india/Projects/PMD/Agentryx Dev Plan";
    const sectionMap = {
      'A': 'A.Solution Scope',
      'B': 'B.Agentryx Edge',
      'C': 'C.Project Delivery',
      'P': 'P.Project Management',
    };
    const prefix = docId.charAt(0).toUpperCase();
    const section = sectionMap[prefix];
    
    if (section) {
      const sectionPath = path.join(newBase, section);
      try {
        const files = await fs.readdir(sectionPath);
        const templateFile = files.find(f => f.startsWith(docId) && (f.endsWith('.md') || f.endsWith('.json')));
        if (templateFile) {
          let content = await fs.readFile(path.join(sectionPath, templateFile), "utf-8");
          content = content.replace(/^# .*?\n(?:> .*?\n)+\n---\n+/m, '');
          return content;
        }
      } catch(e) { /* folder may not exist, fall through */ }
    }

    // Also check for AGENT_STATE template at root
    if (docId === 'AGENT_STATE') {
      try {
        return await fs.readFile(path.join(newBase, 'AGENT_STATE_TEMPLATE.md'), 'utf-8');
      } catch(e) { /* fall through */ }
    }

    // Fallback: old structure
    const oldBase = "/home/subhash.thakur.india/Projects/PMD/Dev Scop & Plan";
    const oldSubfolder = docId.startsWith('A') ? "A.Project Scope" : "B.Standard Scope";
    const oldFiles = await fs.readdir(path.join(oldBase, oldSubfolder));
    const oldFile = oldFiles.find(f => f.startsWith(docId));
    if (oldFile) {
      let content = await fs.readFile(path.join(oldBase, oldSubfolder, oldFile), "utf-8");
      content = content.replace(/^# .*?\n> \*\*Template Version.*\n> \*\*.*?\n\n---\n+/m, '');
      return content;
    }
    return `Template ${docId} not found.`;
  } catch(e) { return `Error reading template: ${e.message}`; }
}

// ═══════════════════════════════════════════════════════════
//   FILE TOOLS — All scoped to current project directory
// ═══════════════════════════════════════════════════════════
export const fileReadTool = new DynamicTool({
  name: "file_read",
  description: "Reads a file from the current project. Input is the relative file path.",
  func: async (filePath) => {
    try {
      const fullPath = path.join(_projectDir, filePath);
      const content = await fs.readFile(fullPath, "utf-8");
      return content;
    } catch (e) {
      return `Error reading file: ${e.message}`;
    }
  },
});

export const fileWriteTool = new DynamicTool({
  name: "file_write",
  description: "Writes content to a file in the current project. Input: JSON string with 'path' and 'content' keys.",
  func: async (inputStr) => {
    try {
      const { path: filePath, content } = JSON.parse(inputStr);
      const fullPath = path.join(_projectDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
      return `✅ File written: ${filePath}`;
    } catch (e) {
      return `Error writing file: ${e.message}`;
    }
  },
});

export const fileListTool = new DynamicTool({
  name: "file_list",
  description: "Lists files and directories in the current project. Input: relative directory path (use '.' for root).",
  func: async (dirPath) => {
    try {
      const fullPath = path.join(_projectDir, dirPath);
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
    } catch (e) {
      return `Error listing: ${e.message}`;
    }
  },
});

export const terminalTool = new DynamicTool({
  name: "terminal",
  description: "Runs a bash command in the current project directory. Input: the exact command string.",
  func: async (command) => {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: _projectDir, timeout: 30000 });
      return `STDOUT:\n${stdout}${stderr ? `\nSTDERR:\n${stderr}` : ''}`;
    } catch (e) {
      return `Error: ${e.message}\n${e.stdout || ''}\n${e.stderr || ''}`;
    }
  },
});

// ═══════════════════════════════════════════════════════════
//   GIT TOOLS — Scoped to current project
// ═══════════════════════════════════════════════════════════
export const gitTool = new DynamicTool({
  name: "git_operation",
  description: "Runs a git command in the current project directory. Input: git subcommand and args.",
  func: async (gitArgs) => {
    try {
      const { stdout, stderr } = await execAsync(`git ${gitArgs}`, { cwd: _projectDir, timeout: 30000 });
      return `GIT:\n${stdout}${stderr ? `\n${stderr}` : ''}`;
    } catch (e) {
      return `Git Error: ${e.message}`;
    }
  },
});
