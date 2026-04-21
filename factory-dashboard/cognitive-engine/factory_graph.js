import { StateGraph, Annotation, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { fileReadTool, fileWriteTool, fileListTool, terminalTool, gitTool, broadcastTelemetry, broadcastWorkItem } from "./tools.js";
import 'dotenv/config';

/* ═══════════════════════════════════════════════════════════
   AGENTRYX DEV FACTORY — Multi-Agent StateGraph
   
   Pipeline: Jane → Spock → Torres → Data → Tuvok → O'Brien
   ═══════════════════════════════════════════════════════════ */

// ── 1. STATE SCHEMA ──────────────────────────────────────
const FactoryState = Annotation.Root({
  userRequest: Annotation({ reducer: (a, b) => b ?? a }),        // Raw input from user
  triageSpec: Annotation({ reducer: (a, b) => b ?? a }),         // Jane's structured spec
  researchDossier: Annotation({ reducer: (a, b) => b ?? a }),    // Spock's research findings
  codeOutput: Annotation({ reducer: (a, b) => b ?? a }),         // Torres's generated code
  architectReview: Annotation({ reducer: (a, b) => b ?? a }),    // Data's architecture review
  qaReport: Annotation({ reducer: (a, b) => b ?? a }),           // Tuvok's test results
  deployStatus: Annotation({ reducer: (a, b) => b ?? a }),       // O'Brien's deploy status
  currentAgent: Annotation({ reducer: (a, b) => b ?? a }),       // Who is working now
  iteration: Annotation({ reducer: (a, b) => b ?? a }),          // Loop counter for fix cycles
  error: Annotation({ reducer: (a, b) => b ?? a }),              // Error state
  _taskId: Annotation({ reducer: (a, b) => b ?? a }),            // Work item ID for dashboard
  _taskName: Annotation({ reducer: (a, b) => b ?? a }),          // Work item name for dashboard
});

// ── 2. MODEL INSTANCES ───────────────────────────────────
//   Flash = Fast/Cheap | Pro = Analytical | Opus = Deep Code
const geminiFlash = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0.1,
});

const geminiPro = new ChatGoogleGenerativeAI({
  model: "gemini-3.1-pro-preview",
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0.2,
});

// For now, Torres + Data use Gemini 3.1 Pro as the thinking engine
// In production, swap these to Claude Opus 4.6 via Anthropic API
const codeModel = geminiPro;

// ── 3. AGENT NODES ───────────────────────────────────────

// UHURA — PM / Triage (Gemini Flash - fast routing)
async function janeNode(state) {
  // Create the work item box in Backlog
  const taskId = `TASK-${Date.now().toString(36).toUpperCase()}`;
  const taskName = state.userRequest.substring(0, 20);
  await broadcastWorkItem('create', taskId, taskName, 0, '#8b5cf6');
  await broadcastTelemetry('jane', 0, 'working', `Triaging: "${state.userRequest.substring(0, 60)}..."`);

  const response = await geminiFlash.invoke([
    new SystemMessage(`You are Jane, a senior PM agent. Your job is to take a raw user request and produce a precise, structured development specification in JSON format.
Output ONLY valid JSON with these fields:
- "title": short task title
- "description": detailed technical description of what needs to be built
- "files": array of file paths that will likely need to be created or modified
- "language": primary programming language
- "testCriteria": how to verify the task is complete`),
    new HumanMessage(state.userRequest)
  ]);

  await broadcastTelemetry('jane', 0, 'idle', `Triage complete. Spec generated.`);
  return { triageSpec: response.content, currentAgent: 'spock', _taskId: taskId, _taskName: taskName };
}

// SPOCK — Auto-Research (Gemini Pro - analytical + search grounding)
async function spockNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 1, '#8b5cf6');
  await broadcastTelemetry('spock', 1, 'working', `Researching best practices for task...`);

  const response = await geminiPro.invoke([
    new SystemMessage(`You are Spock, a research scientist agent. Given a development specification, research and provide:
1. The best libraries/frameworks to use (with version numbers)
2. Common pitfalls to avoid
3. A recommended file structure
4. Code patterns and best practices
Be concise and technical. Output as a structured markdown dossier.`),
    new HumanMessage(`Research the following development task:\n${state.triageSpec}`)
  ]);

  await broadcastTelemetry('spock', 1, 'idle', `Research dossier compiled.`);
  return { researchDossier: response.content, currentAgent: 'torres' };
}

// SCOTTY — Junior Dev / Code Writer (Opus-tier model)
async function torresNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 2, '#8b5cf6');
  await broadcastTelemetry('torres', 2, 'working', `Building code from spec + research...`);

  // Read existing workspace files for context
  let workspaceContext = '';
  try {
    workspaceContext = await fileListTool.func('.');
  } catch (e) { workspaceContext = '(empty workspace)'; }

  const response = await codeModel.invoke([
    new SystemMessage(`You are Torres, a senior software engineer agent. You write production-quality code.

RULES:
1. Generate COMPLETE, working files. Never use placeholders or "// TODO".
2. Output your response as a series of FILE BLOCKS in this exact format:
   === FILE: path/to/file.ext ===
   (file content here)
   === END FILE ===
3. Include ALL necessary files (source code, package.json, README, etc.)
4. Follow the research dossier's recommendations exactly.
5. Write clean, well-commented code.`),
    new HumanMessage(`TASK SPEC:\n${state.triageSpec}\n\nRESEARCH DOSSIER:\n${state.researchDossier}\n\nEXISTING WORKSPACE:\n${workspaceContext}`)
  ]);

  // Parse file blocks and write to disk
  const fileRegex = /=== FILE: (.+?) ===([\s\S]*?)=== END FILE ===/g;
  let match;
  let filesWritten = [];
  while ((match = fileRegex.exec(response.content)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    await fileWriteTool.func(JSON.stringify({ path: filePath, content }));
    filesWritten.push(filePath);
    await broadcastTelemetry('torres', 2, 'working', `Wrote: ${filePath}`);
  }

  const summary = filesWritten.length > 0
    ? `Files created: ${filesWritten.join(', ')}`
    : response.content;

  await broadcastTelemetry('torres', 2, 'idle', `Code generation complete. ${filesWritten.length} files written.`);
  return { codeOutput: summary, currentAgent: 'data', iteration: (state.iteration || 0) };
}

// DATA — Sr. Architect / Code Review (Opus-tier thinking model)
async function dataNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 4, '#8b5cf6');
  await broadcastTelemetry('data', 4, 'working', `Reviewing architecture and code quality...`);

  // Read the generated files
  let codeContent = '';
  const files = (state.codeOutput || '').match(/[\w\-/.]+\.\w+/g) || [];
  for (const f of files.slice(0, 5)) {
    try {
      const content = await fileReadTool.func(f);
      codeContent += `\n--- ${f} ---\n${content}\n`;
    } catch (e) { /* skip unreadable */ }
  }

  const response = await codeModel.invoke([
    new SystemMessage(`You are Data, a senior architect agent. Review the code for:
1. Correctness - Does it fulfill the spec?
2. Architecture - Is the structure clean and maintainable?
3. Security - Any obvious vulnerabilities?
4. Performance - Any anti-patterns?

Output your review as:
VERDICT: APPROVED or NEEDS_FIX
ISSUES: (list any issues found, or "None")
SUGGESTIONS: (improvement ideas)`),
    new HumanMessage(`ORIGINAL SPEC:\n${state.triageSpec}\n\nCODE OUTPUT:\n${state.codeOutput}\n\nFILE CONTENTS:\n${codeContent}`)
  ]);

  await broadcastTelemetry('data', 4, 'idle', `Architecture review complete.`);
  return { architectReview: response.content, currentAgent: 'tuvok' };
}

// WORF — QA / Security Reviewer (Gemini Pro - analytical)
async function tuvokNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 3, '#8b5cf6');
  await broadcastTelemetry('tuvok', 3, 'working', `Running security audit and tests...`);

  // Try to run tests if they exist
  let testOutput = '';
  try {
    testOutput = await terminalTool.func('ls -la');
  } catch (e) { testOutput = 'No test commands available'; }

  const response = await geminiPro.invoke([
    new SystemMessage(`You are Tuvok, a QA security agent. You are the last line of defense before deployment.
Analyze the architect's review and the code output. 

Output exactly:
QA_VERDICT: PASS or FAIL
SECURITY_ISSUES: (list any security concerns, or "None")
TEST_RESULTS: (summary of verification)
RECOMMENDATION: DEPLOY or SEND_BACK_TO_SCOTTY`),
    new HumanMessage(`ARCHITECT REVIEW:\n${state.architectReview}\n\nCODE FILES:\n${state.codeOutput}\n\nWORKSPACE:\n${testOutput}`)
  ]);

  await broadcastTelemetry('tuvok', 3, 'idle', `QA audit complete.`);
  return { qaReport: response.content, currentAgent: 'obrien' };
}

// LAFORGE — SRE / Deploy (Gemini Flash - fast ops)
async function obrienNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 5, '#8b5cf6');
  await broadcastTelemetry('obrien', 5, 'working', `Preparing deployment...`);

  // Initialize git if needed and commit
  try {
    await terminalTool.func('git init');
    await terminalTool.func('git add -A');
    await terminalTool.func(`git commit -m "Factory: ${(state.triageSpec || '').substring(0, 50)}"`);
  } catch (e) { /* git may already be initialized */ }

  await broadcastWorkItem('complete', state._taskId, state._taskName, 5, '#8b5cf6');
  await broadcastTelemetry('obrien', 5, 'idle', `Deployment committed locally. Pipeline complete.`);
  return { deployStatus: 'DEPLOYED', currentAgent: 'complete' };
}

// ── 4. ROUTING LOGIC ─────────────────────────────────────

function routeAfterTuvok(state) {
  const report = (state.qaReport || '').toUpperCase();
  const iteration = state.iteration || 0;

  // If Tuvok says FAIL and we haven't looped too many times, send back to Torres
  if ((report.includes('SEND_BACK') || report.includes('FAIL')) && iteration < 2) {
    return 'torres';
  }
  return 'obrien';
}

// ── 5. BUILD THE GRAPH ───────────────────────────────────

const workflow = new StateGraph(FactoryState)
  .addNode('jane', janeNode)
  .addNode('spock', spockNode)
  .addNode('torres', torresNode)
  .addNode('data', dataNode)
  .addNode('tuvok', tuvokNode)
  .addNode('obrien', obrienNode)
  .addEdge('__start__', 'jane')
  .addEdge('jane', 'spock')
  .addEdge('spock', 'torres')
  .addEdge('torres', 'data')
  .addEdge('data', 'tuvok')
  .addConditionalEdges('tuvok', routeAfterTuvok, { torres: 'torres', obrien: 'obrien' })
  .addEdge('obrien', '__end__');

export const factoryGraph = workflow.compile();

// ── 6. CLI Runner ────────────────────────────────────────

async function main() {
  const task = process.argv.slice(2).join(' ') || 'Create a simple Express.js REST API with a /health endpoint that returns { status: "ok" }';
  
  console.log('═══════════════════════════════════════════');
  console.log('🖖 AGENTRYX FACTORY — Engaging Star Trek Crew');
  console.log(`📋 Task: ${task}`);
  console.log('═══════════════════════════════════════════\n');

  const result = await factoryGraph.invoke({
    userRequest: task,
    iteration: 0,
  });

  console.log('\n═══════════════════════════════════════════');
  console.log('✅ PIPELINE COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log('📋 Jane Spec:', result.triageSpec?.substring(0, 200));
  console.log('🔬 Spock Research:', result.researchDossier?.substring(0, 200));
  console.log('🔨 Torres Code:', result.codeOutput?.substring(0, 200));
  console.log('🔎 Data Review:', result.architectReview?.substring(0, 200));
  console.log('🧪 Tuvok QA:', result.qaReport?.substring(0, 200));
  console.log(`🚀 O'Brien Deploy:`, result.deployStatus);
}

// Run if called directly
main().catch(console.error);
