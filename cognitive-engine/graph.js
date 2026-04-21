import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { fileReadTool, fileWriteTool, terminalTool } from "./tools.js";
import 'dotenv/config';

console.log("Initializing Gemini 1.5 Pro Cognitive Engine...");

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-pro",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

const tools = [fileReadTool, fileWriteTool, terminalTool];
const memory = new MemorySaver();

export const graph = createReactAgent({
  llm,
  tools,
  checkpointSaver: memory,
  messageModifier: `You are a Senior Autonomous Software Factory Agent powered by Google Gemini.
You have access to an execution sandbox via OpenClaw Gateway.
Your goal is to complete the user's task perfectly inside the workspace.
Always Plan -> Code -> Test -> Fix -> Ship. Use the tools to check your work.
`
});

async function runTest() {
    console.log("-> Dispatching test task to agent...");
    const config = { configurable: { thread_id: "factory-verification-gate" } };
    const inputs = { messages: [new HumanMessage("Write a python script that prints 'OpenClaw execution successful' inside the agent-workspace. Name it 'success_check.py' and run it using the terminal tool to verify.")] };
    
    for await (const step of await graph.stream(inputs, config)) {
        if (step.agent) {
           console.log("🤖 Agent Reasoning:", step.agent.messages[step.agent.messages.length - 1].content || "(Tool Call execution)");
        } else if (step.tools) {
           console.log("🛠️ Tool Executed Result Size:", step.tools.messages.length);
        }
    }
    console.log("✅ Verification Gate Complete.");
    process.exit(0);
}

runTest();
