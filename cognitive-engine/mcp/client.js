import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const _connections = new Map();

export async function loadServersConfig() {
  const configPath = path.join(__dirname, "configs", "servers.json");
  const raw = await fs.readFile(configPath, "utf-8");
  return JSON.parse(raw);
}

function resolvePlaceholders(args, ctx) {
  return args.map(a =>
    a
      .replace("${PROJECT_DIR}", ctx.projectDir || "")
      .replace("${WORKSPACE_ROOT}", ctx.workspaceRoot || "")
  );
}

export async function connectServer(name, ctx = {}) {
  if (_connections.has(name)) return _connections.get(name);

  const cfg = await loadServersConfig();
  const sv = cfg.servers[name];
  if (!sv) throw new Error(`MCP server '${name}' not found in configs/servers.json`);
  if (!sv.enabled) throw new Error(`MCP server '${name}' is disabled in config`);
  if (sv.transport !== "stdio") throw new Error(`MCP transport '${sv.transport}' not yet supported`);

  const env = {};
  for (const key of sv.env || []) {
    if (process.env[key]) env[key] = process.env[key];
  }

  const transport = new StdioClientTransport({
    command: sv.command,
    args: resolvePlaceholders(sv.args, ctx),
    env: { ...process.env, ...env },
  });

  const client = new Client(
    { name: "agentryx-factory", version: "0.0.1" },
    { capabilities: {} }
  );

  await client.connect(transport);
  _connections.set(name, { client, transport, config: sv });
  return _connections.get(name);
}

export async function listTools(serverName) {
  const { client } = await connectServer(serverName);
  return await client.listTools();
}

export async function callTool(serverName, toolName, args) {
  const { client } = await connectServer(serverName);
  return await client.callTool({ name: toolName, arguments: args });
}

export async function disconnectAll() {
  for (const [name, { client, transport }] of _connections) {
    try { await client.close(); } catch (e) { /* best-effort */ }
    try { await transport.close(); } catch (e) { /* best-effort */ }
  }
  _connections.clear();
}

export function isEnabled() {
  return process.env.USE_MCP_TOOLS === "true";
}
