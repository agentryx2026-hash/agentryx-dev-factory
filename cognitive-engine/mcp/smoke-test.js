import { connectServer, listTools, callTool, disconnectAll } from "./client.js";

const PROJECT_DIR = process.env.PROJECT_DIR || "/home/subhash.thakur.india/Projects/agent-workspace";

async function main() {
  console.log(`[smoke] connecting filesystem MCP server scoped to ${PROJECT_DIR}`);
  try {
    await connectServer("filesystem", { projectDir: PROJECT_DIR });
    const tools = await listTools("filesystem");
    console.log(`[smoke] server connected. Advertised tools:`);
    for (const t of tools.tools || []) {
      console.log(`  - ${t.name}: ${(t.description || "").slice(0, 80)}`);
    }
    console.log(`[smoke] attempting list_directory on project root...`);
    const res = await callTool("filesystem", "list_directory", { path: PROJECT_DIR });
    const text = (res.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    console.log(`[smoke] result (first 400 chars):\n${text.slice(0, 400)}`);
    console.log(`[smoke] OK`);
  } catch (e) {
    console.error(`[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await disconnectAll();
  }
}

main();
