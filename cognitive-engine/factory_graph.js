import { StateGraph, Annotation, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { fileReadTool, fileWriteTool, fileListTool, terminalTool, gitTool, broadcastTelemetry, broadcastWorkItem, setProjectDir, getProjectDir, readTemplate } from "./tools.js";
import 'dotenv/config';

/* ═══════════════════════════════════════════════════════════
   AGENTRYX AI LABS — Multi-Agent StateGraph v3
   
   E2E Pipeline:
   [Intake] Picard → Sisko → Troi 
   [Dev]    Jane → Spock → Torres ⇄ Tuvok ⇄ Data
   [Ship]   Crusher → O'Brien
   ═══════════════════════════════════════════════════════════ */

// ── 1. STATE SCHEMA ──────────────────────────────────────
const FactoryState = Annotation.Root({
  userRequest: Annotation({ reducer: (a, b) => b ?? a }),
  pmdDocs: Annotation({ reducer: (a, b) => ({ ...a, ...(b || {}) }), default: () => ({}) }),
  triageSpec: Annotation({ reducer: (a, b) => b ?? a }),
  researchDossier: Annotation({ reducer: (a, b) => b ?? a }),
  codeOutput: Annotation({ reducer: (a, b) => b ?? a }),
  testOutput: Annotation({ reducer: (a, b) => b ?? a }),
  architectReview: Annotation({ reducer: (a, b) => b ?? a }),
  qaReport: Annotation({ reducer: (a, b) => b ?? a }),
  deployStatus: Annotation({ reducer: (a, b) => b ?? a }),
  currentAgent: Annotation({ reducer: (a, b) => b ?? a }),
  iteration: Annotation({ reducer: (a, b) => b ?? a }),
  error: Annotation({ reducer: (a, b) => b ?? a }),
  _taskId: Annotation({ reducer: (a, b) => b ?? a }),
  _taskName: Annotation({ reducer: (a, b) => b ?? a }),
  _projectDir: Annotation({ reducer: (a, b) => b ?? a }),
});

// ── 2. MODEL INSTANCES ───────────────────────────────────
// USE_ROUTER toggles the multi-provider router (Phase 2B). Default off →
// preserves direct-Gemini behavior. See dev_graph.js for full pattern.
const USE_ROUTER = process.env.USE_ROUTER === 'true';
let RouterChatModel;
if (USE_ROUTER) ({ RouterChatModel } = await import('@agentryx-factory/llm-router'));

const geminiFlash = USE_ROUTER
  ? new RouterChatModel({ task: 'cheap' })
  : new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash", apiKey: process.env.GEMINI_API_KEY, temperature: 0.1 });

const geminiPro = USE_ROUTER
  ? new RouterChatModel({ task: 'architect' })
  : new ChatGoogleGenerativeAI({ model: "gemini-2.5-pro", apiKey: process.env.GEMINI_API_KEY, temperature: 0.2 });

const codeModel = USE_ROUTER ? new RouterChatModel({ task: 'code' }) : geminiPro;

console.error(`[factory_graph] model backend: ${USE_ROUTER ? 'ROUTER' : 'direct-gemini'}`);

// ── 3. AGENT NODES (INTAKE / PRE-DEV) ────────────────────

// PICARD — Solution Architect
async function picardNode(state) {
  const taskId = `TASK-${Date.now().toString(36).toUpperCase()}`;
  const taskName = state.userRequest.substring(0, 20);
  await broadcastWorkItem('create', taskId, taskName, 0, '#8b5cf6');
  await broadcastTelemetry('picard', 0, 'working', `Architecting solution from raw request...`);

  // Phase 1: Create isolated project folder (Picard does this now)
  const projInfo = setProjectDir(state.userRequest.substring(0, 30));
  await broadcastTelemetry('picard', 0, 'working', `Created project: ${projInfo.dirName}`);

  const a1Tpl = await readTemplate('A1');
  const a2Tpl = await readTemplate('A2');

  const response = await geminiPro.invoke([
    new SystemMessage(`You are Picard, Solution Architect at Agentryx AI Labs.
Your job is to convert a raw request into exactly two markdown documents:
1. A1_Solution_Brief.md
2. A2_Solution_Architecture.md

Use these templates as your exact structure:
--- A1 TEMPLATE ---
${a1Tpl}
--- A2 TEMPLATE ---
${a2Tpl}

Output your response as FILE BLOCKS:
=== FILE: PMD/A1_Solution_Brief.md ===
(content)
=== END FILE ===
=== FILE: PMD/A2_Solution_Architecture.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`Raw Request:\n${state.userRequest}`)
  ]);

  const fileRegex = /=== FILE: (.+?) ===\n?([\s\S]*?)=== END FILE ===/g;
  let match;
  let pmdDocs = { ...state.pmdDocs };
  while ((match = fileRegex.exec(response.content)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    await fileWriteTool.func(JSON.stringify({ path: filePath, content }));
    pmdDocs[filePath.split('/').pop().replace('.md', '')] = content;
  }

  await broadcastTelemetry('picard', 0, 'idle', `Solution Architecture complete.`);
  return { pmdDocs, currentAgent: 'sisko', _taskId: taskId, _taskName: taskName, _projectDir: projInfo.dirName };
}

// SISKO — Project Planner
async function siskoNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 0, '#8b5cf6');
  await broadcastTelemetry('sisko', 0, 'working', `Breaking down modules and phasing...`);

  const a3Tpl = await readTemplate('A3');
  const a4Tpl = await readTemplate('A4');
  const a5Tpl = await readTemplate('A5');

  const response = await geminiPro.invoke([
    new SystemMessage(`You are Sisko, Project Planner at Agentryx AI Labs.
Based on Picard's architecture, write the module breakdown, dev plan, and PRDs.

Use these templates:
--- A3 TEMPLATE ---
${a3Tpl}
--- A4 TEMPLATE ---
${a4Tpl}
--- A5 TEMPLATE ---
${a5Tpl}

Output your response as FILE BLOCKS:
=== FILE: PMD/A3_Module_Breakdown.md ===
(content)
=== END FILE ===
=== FILE: PMD/A4_Dev_Plan_Phasing.md ===
(content)
=== END FILE ===
=== FILE: PMD/A5_PRD_Phase1.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`A2_Architecture:\n${state.pmdDocs['A2_Solution_Architecture']}`)
  ]);

  const fileRegex = /=== FILE: (.+?) ===\n?([\s\S]*?)=== END FILE ===/g;
  let match;
  let pmdDocs = { ...state.pmdDocs };
  while ((match = fileRegex.exec(response.content)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    await fileWriteTool.func(JSON.stringify({ path: filePath, content }));
    pmdDocs[filePath.split('/').pop().replace('.md', '')] = content;
  }

  await broadcastTelemetry('sisko', 0, 'idle', `Project breakdown complete.`);
  return { pmdDocs, currentAgent: 'troi' };
}

// TROI — The 110% Enhancement Analyst
async function troiNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 0, '#8b5cf6');
  await broadcastTelemetry('troi', 0, 'working', `Identifying Quick Wins and AI Enhancements...`);

  const b4Tpl = await readTemplate('B4');
  const b6Tpl = await readTemplate('B6');

  const response = await geminiPro.invoke([
    new SystemMessage(`You are Troi, Enhancement Analyst at Agentryx AI Labs.
Your job is the "110%". Find AI opportunities and quick-win UX features that the customer didn't ask for but will love.

Use these templates:
--- B4 TEMPLATE ---
${b4Tpl}
--- B6 TEMPLATE ---
${b6Tpl}

Output as FILE BLOCKS:
=== FILE: docs/B4_AI_Enhancement_Report.md ===
(content)
=== END FILE ===
=== FILE: docs/B6_Quick_Wins_110.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`A1 Brief:\n${state.pmdDocs['A1_Solution_Brief']}\nA3 Modules:\n${state.pmdDocs['A3_Module_Breakdown']}`)
  ]);

  const fileRegex = /=== FILE: (.+?) ===\n?([\s\S]*?)=== END FILE ===/g;
  let match;
  let pmdDocs = { ...state.pmdDocs };
  while ((match = fileRegex.exec(response.content)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    await fileWriteTool.func(JSON.stringify({ path: filePath, content }));
    pmdDocs[filePath.split('/').pop().replace('.md', '')] = content;
  }

  await broadcastTelemetry('troi', 0, 'idle', `110% Extras injected.`);
  return { pmdDocs, currentAgent: 'jane' };
}

// ── 3. AGENT NODES (DEV FLOOR) ───────────────────────────

// JANE — PM / Triage
async function janeNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 0, '#8b5cf6');
  await broadcastTelemetry('jane', 0, 'working', `Triaging Phase 1 tasks for dev floor...`);

  const response = await geminiFlash.invoke([
    new SystemMessage(`You are Jane, a senior PM agent at Agentryx AI Labs.
Take the PMD specifications and produce a concise JSON development target.

Output ONLY valid JSON with these fields:
- "title": short task title
- "description": exactly what the dev must build based on A5 PRD
- "modules": array of module objects {"name", "files", "description"}
- "testCriteria": array of strict acceptance criteria
- "quickWins": any Phase 1 quick wins from B6`),
    new HumanMessage(`A5 PRD Phase 1:\n${state.pmdDocs['A5_PRD_Phase1']}\n\nB6 Quick Wins:\n${state.pmdDocs['B6_Quick_Wins_110']}`)
  ]);

  await broadcastTelemetry('jane', 0, 'idle', `Triage complete. Dev spec ready.`);
  return { triageSpec: response.content, currentAgent: 'spock' };
}

// SPOCK — Auto-Research
async function spockNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 1, '#8b5cf6');
  await broadcastTelemetry('spock', 1, 'working', `Researching best practices...`);

  const response = await geminiPro.invoke([
    new SystemMessage(`You are Spock, a research scientist agent at Agentryx AI Labs.
Given a development spec, research and provide:
1. The best libraries/frameworks to use (with version numbers)
2. Common pitfalls to avoid
3. Recommended project structure under src/
4. Code patterns and best practices
5. Test strategy: what to test and how

Be concise and technical. Output as a structured markdown dossier.`),
    new HumanMessage(`Research this development task:\n${state.triageSpec}`)
  ]);

  await broadcastTelemetry('spock', 1, 'idle', `Research dossier compiled.`);
  return { researchDossier: response.content, currentAgent: 'torres' };
}

// TORRES — Code Writer (generates src/ files)
async function torresNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 2, '#8b5cf6');
  await broadcastTelemetry('torres', 2, 'working', `Building code from spec + research...`);

  // Show Torres what exists in the project
  let workspaceContext = '';
  try { workspaceContext = await fileListTool.func('.'); } catch (e) { workspaceContext = '(new project)'; }

  const isFix = (state.iteration || 0) > 0;
  const fixContext = isFix ? `\n\nPREVIOUS QA FEEDBACK (FIX THESE ISSUES):\n${state.qaReport}` : '';

  const response = await codeModel.invoke([
    new SystemMessage(`You are Torres, a senior software engineer at Agentryx AI Labs.
You write production-quality, well-structured code.

RULES:
1. Generate COMPLETE, working files. Never use placeholders or "// TODO".
2. Output your response as FILE BLOCKS in this exact format:
   === FILE: path/to/file.ext ===
   (file content here)
   === END FILE ===
3. Place application code under src/ (e.g., src/index.js, src/auth/controller.js)
4. Always include a package.json at root with proper scripts (start, test)
5. Always include a README.md with install + usage instructions
6. Follow the research dossier's recommendations exactly.
7. Write clean, well-commented, production-quality code.
8. Include proper error handling in all functions.
${isFix ? '9. This is a FIX iteration — focus on resolving the QA issues below.' : ''}`),
    new HumanMessage(`TASK SPEC:\n${state.triageSpec}\n\nRESEARCH DOSSIER:\n${state.researchDossier}\n\nEXISTING PROJECT:\n${workspaceContext}${fixContext}`)
  ]);

  // Parse file blocks and write to project directory
  const fileRegex = /=== FILE: (.+?) ===\n?([\s\S]*?)=== END FILE ===/g;
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

  await broadcastTelemetry('torres', 2, 'idle', `Code complete. ${filesWritten.length} files written.`);
  return { codeOutput: summary, currentAgent: 'tuvok', iteration: (state.iteration || 0) };
}

// TUVOK — QA Fortress: Writes REAL test files + runs them
async function tuvokNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 3, '#8b5cf6');
  await broadcastTelemetry('tuvok', 3, 'working', `Building test suite and running QA...`);

  // Read all source files Torres wrote
  let codeContent = '';
  const files = (state.codeOutput || '').match(/[\w\-/.]+\.\w+/g) || [];
  for (const f of files.slice(0, 8)) {
    try {
      const content = await fileReadTool.func(f);
      codeContent += `\n--- ${f} ---\n${content}\n`;
    } catch (e) { /* skip */ }
  }

  // Generate real test files
  const testResponse = await geminiPro.invoke([
    new SystemMessage(`You are Tuvok, QA Fortress Commander at Agentryx AI Labs.
Your job is to write REAL, EXECUTABLE test files that validate the code.

RULES:
1. Output test files as FILE BLOCKS:
   === FILE: tests/filename.test.js ===
   (test code here)
   === END FILE ===
2. Use the testing framework referenced in package.json (Jest by default).
3. Test every public function and endpoint.
4. Include edge cases: invalid input, missing fields, error states.
5. Tests must be RUNNABLE — no mocks of things that don't exist, no missing imports.
6. Also provide a security and code quality assessment.

After the FILE BLOCKS, output:
QA_VERDICT: PASS or FAIL
SECURITY_ISSUES: (list or "None")
TEST_COVERAGE_ESTIMATE: (percentage)
ISSUES_FOUND: (list or "None")
RECOMMENDATION: DEPLOY or SEND_BACK_TO_TORRES`),
    new HumanMessage(`ORIGINAL SPEC:\n${state.triageSpec}\n\nCODE FILES:\n${codeContent}`)
  ]);

  // Parse and write test files
  const fileRegex = /=== FILE: (.+?) ===\n?([\s\S]*?)=== END FILE ===/g;
  let match;
  let testFiles = [];
  while ((match = fileRegex.exec(testResponse.content)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    await fileWriteTool.func(JSON.stringify({ path: filePath, content }));
    testFiles.push(filePath);
    await broadcastTelemetry('tuvok', 3, 'working', `Test written: ${filePath}`);
  }

  // Try to install deps and run tests
  let testRunOutput = '';
  try {
    await broadcastTelemetry('tuvok', 3, 'working', `Installing dependencies...`);
    await terminalTool.func('npm install --silent 2>&1 || true');
    await broadcastTelemetry('tuvok', 3, 'working', `Running test suite...`);
    testRunOutput = await terminalTool.func('npm test 2>&1 || true');
    await broadcastTelemetry('tuvok', 3, 'working', `Test run: ${testRunOutput.substring(0, 100)}`);
  } catch (e) {
    testRunOutput = `Test execution error: ${e.message}`;
  }

  const fullReport = testResponse.content + `\n\nACTUAL TEST RUN OUTPUT:\n${testRunOutput}`;

  await broadcastTelemetry('tuvok', 3, 'idle', `QA complete. ${testFiles.length} test files. Verdict issued.`);
  return { qaReport: fullReport, testOutput: testRunOutput, currentAgent: 'data' };
}

// DATA — Sr. Architect / Code Review
async function dataNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 4, '#8b5cf6');
  await broadcastTelemetry('data', 4, 'working', `Reviewing architecture and code quality...`);

  // Read code files
  let codeContent = '';
  const files = (state.codeOutput || '').match(/[\w\-/.]+\.\w+/g) || [];
  for (const f of files.slice(0, 8)) {
    try {
      const content = await fileReadTool.func(f);
      codeContent += `\n--- ${f} ---\n${content}\n`;
    } catch (e) { /* skip */ }
  }

  const response = await codeModel.invoke([
    new SystemMessage(`You are Data, senior architect at Agentryx AI Labs.
Review the code AND test results together. Evaluate:
1. Correctness — Does code fulfill the spec?
2. Architecture — Is structure clean and maintainable?
3. Security — Any vulnerabilities?
4. Test quality — Are Tuvok's tests thorough?
5. Production-readiness — Error handling, edge cases, logging?

Output:
VERDICT: APPROVED or NEEDS_FIX
ISSUES: (list or "None")
SUGGESTIONS: (improvement ideas)
OVERALL_CONFIDENCE: (0.0 to 1.0)`),
    new HumanMessage(`SPEC:\n${state.triageSpec}\n\nCODE:\n${codeContent}\n\nTUVOK QA REPORT:\n${state.qaReport?.substring(0, 2000)}`)
  ]);

  await broadcastTelemetry('data', 4, 'idle', `Architecture review complete.`);
  return { architectReview: response.content, currentAgent: 'route_after_review' };
}

// CRUSHER — Documentation
async function crusherNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 5, '#8b5cf6');
  await broadcastTelemetry('crusher', 5, 'working', `Generating full documentation...`);

  // Read code files to document them
  let codeContent = '';
  const files = (state.codeOutput || '').match(/[\w\-/.]+\.\w+/g) || [];
  for (const f of files.slice(0, 5)) {
    try {
      const content = await fileReadTool.func(f);
      codeContent += `\n--- ${f} ---\n${content}\n`;
    } catch (e) { /* skip */ }
  }

  const b1Tpl = await readTemplate('B1');
  const b2Tpl = await readTemplate('B2');

  const response = await geminiFlash.invoke([
    new SystemMessage(`You are Crusher, Documentation Agent at Agentryx AI Labs.
Generate the standard B1 API Reference and B2 Developer Docs.

Use templates:
--- B1 TEMPLATE ---
${b1Tpl}
--- B2 TEMPLATE ---
${b2Tpl}

Output as FILE BLOCKS:
=== FILE: docs/B1_API_Reference.md ===
...
=== END FILE ===
=== FILE: docs/B2_Developer_Documentation.md ===
...
=== END FILE ===`),
    new HumanMessage(`A2_Architecture:\n${state.pmdDocs['A2_Solution_Architecture']}\n\nCODE:\n${codeContent}`)
  ]);

  // Parse and write docs
  const fileRegex = /=== FILE: (.+?) ===\n?([\s\S]*?)=== END FILE ===/g;
  let match;
  while ((match = fileRegex.exec(response.content)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    await fileWriteTool.func(JSON.stringify({ path: filePath, content }));
    await broadcastTelemetry('crusher', 5, 'working', `Doc written: ${filePath}`);
  }

  await broadcastTelemetry('crusher', 5, 'idle', `Documentation generated.`);
  return { currentAgent: 'obrien' };
}

// O'BRIEN — SRE / Deploy + Package
async function obrienNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 5, '#8b5cf6');
  await broadcastTelemetry('obrien', 5, 'working', `Preparing deployment package...`);

  // Initialize git in project folder and commit
  try {
    await terminalTool.func('git init');
    await terminalTool.func('git add -A');
    const title = state._projectDir || 'project';
    await terminalTool.func(`git commit -m "Agentryx AI Labs: Finalizing ${title}"`);
  } catch (e) { /* git may already exist */ }

  const b7Tpl = await readTemplate('B7');

  const report = {
    _meta: { template: "B7_Factory_Report", version: "1.0", generatedBy: "O'Brien" },
    project: { name: state._projectDir, status: "COMPLETE" },
    quality: { qaVerdict: state.qaReport?.includes('PASS') ? 'PASS' : 'WARNING' },
    summary: "Full E2E run from Picard to O'Brien completed successfully."
  };
  
  await fileWriteTool.func(JSON.stringify({
    path: 'B7_Factory_Report.json',
    content: JSON.stringify(report, null, 2)
  }));

  await broadcastWorkItem('complete', state._taskId, state._taskName, 5, '#8b5cf6');
  await broadcastTelemetry('obrien', 5, 'idle', `📦 Project packaged: ${state._projectDir}`);
  return { deployStatus: 'DEPLOYED', currentAgent: 'complete' };
}

// ── 4. ROUTING LOGIC ─────────────────────────────────────

function routeAfterReview(state) {
  const review = (state.architectReview || '').toUpperCase();
  const qa = (state.qaReport || '').toUpperCase();
  const iteration = state.iteration || 0;

  // If either Data or Tuvok flagged issues and we haven't looped too much
  const hasFix = review.includes('NEEDS_FIX') || qa.includes('SEND_BACK') || qa.includes('FAIL');
  if (hasFix && iteration < 2) {
    return 'torres';
  }
  return 'crusher'; // Flow to docs instead of obrien directly
}

// ── 5. BUILD THE GRAPH ───────────────────────────────────

const workflow = new StateGraph(FactoryState)
  .addNode('picard', picardNode)
  .addNode('sisko', siskoNode)
  .addNode('troi', troiNode)
  .addNode('jane', janeNode)
  .addNode('spock', spockNode)
  .addNode('torres', torresNode)
  .addNode('tuvok', tuvokNode)
  .addNode('data', dataNode)
  .addNode('crusher', crusherNode)
  .addNode('obrien', obrienNode)
  .addEdge('__start__', 'picard')
  .addEdge('picard', 'sisko')
  .addEdge('sisko', 'troi')
  .addEdge('troi', 'jane')
  .addEdge('jane', 'spock')
  .addEdge('spock', 'torres')
  .addEdge('torres', 'tuvok')
  .addEdge('tuvok', 'data')
  .addConditionalEdges('data', routeAfterReview, { torres: 'torres', crusher: 'crusher' })
  .addEdge('crusher', 'obrien')
  .addEdge('obrien', '__end__');

export const factoryGraph = workflow.compile();

// ── 6. CLI Runner ────────────────────────────────────────

async function main() {
  let task = process.argv.slice(2).join(' ') || 'Create a Node.js REST API with user registration and login using JWT authentication';
  if (task.startsWith('FILE:')) {
    const fs = await import('node:fs/promises');
    task = await fs.readFile(task.substring(5), 'utf-8');
  }
  
  console.log('═══════════════════════════════════════════');
  console.log('🖖 AGENTRYX AI LABS — Factory Engaged');
  console.log(`📋 Task: ${task.substring(0, 150)}... [${task.length} chars]`);
  console.log('═══════════════════════════════════════════\n');

  const result = await factoryGraph.invoke({
    userRequest: task,
    iteration: 0,
  });

  console.log('\n═══════════════════════════════════════════');
  console.log('✅ PIPELINE COMPLETE');
  console.log(`📁 Project: ${result._projectDir}`);
  console.log('═══════════════════════════════════════════');
}

main().catch(console.error);
