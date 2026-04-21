import { StateGraph, Annotation, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { fileReadTool, fileWriteTool, fileListTool, terminalTool, gitTool, broadcastTelemetry, broadcastWorkItem, setProjectDir, getProjectDir, readTemplate, cleanProjectForDev } from "./tools.js";
import 'dotenv/config';

/* ═══════════════════════════════════════════════════════════
   AGENTRYX 110 LABS — Dev Floor Pipeline v4
   
   Full Dev Flow:
   Jane(triage+AGENT_STATE) → Spock(research) → Torres(code)
   → Tuvok(QA) → Data(review) ⇄ Torres(fix)
   → Crusher(B1+B2+B5) → O'Brien(B9+git+deploy)
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

import { AntigravityBridgeLLM } from './AntigravityBridgeLLM.js';

// ── 2. MODEL INSTANCES ───────────────────────────────────
// Three mutually-exclusive backends (Phase 2B — configurability-first):
//   USE_ROUTER=true                  → multi-provider router (LiteLLM / OpenRouter)
//                                      with auto-fallback on 429/5xx/billing
//   USE_ANTIGRAVITY_BRIDGE=true      → filesystem bridge to external runner
//   (neither set; default)           → direct Gemini (original behavior preserved)
const USE_ROUTER = process.env.USE_ROUTER === 'true';
const USE_BRIDGE = !USE_ROUTER && process.env.USE_ANTIGRAVITY_BRIDGE === 'true';

// Dynamic import so the router dep is only loaded when enabled — keeps the
// default path zero-risk if the router package has any issue.
let RouterChatModel;
if (USE_ROUTER) {
  ({ RouterChatModel } = await import('@agentryx-factory/llm-router'));
}

const geminiFlash = USE_ROUTER
  ? new RouterChatModel({ task: 'cheap' })
  : USE_BRIDGE
    ? new AntigravityBridgeLLM({ model: "gemini-2.5-flash", temperature: 0.1 })
    : new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash", apiKey: process.env.GEMINI_API_KEY, temperature: 0.1 });

const geminiPro = USE_ROUTER
  ? new RouterChatModel({ task: 'architect' })
  : USE_BRIDGE
    ? new AntigravityBridgeLLM({ model: "gemini-3.1-pro", temperature: 0.2 })
    : new ChatGoogleGenerativeAI({ model: "gemini-2.5-pro", apiKey: process.env.GEMINI_API_KEY, temperature: 0.2 });

const codeModel = USE_ROUTER
  ? new RouterChatModel({ task: 'code' })
  : geminiPro;

console.error(`[dev_graph] model backend: ${USE_ROUTER ? 'ROUTER' : USE_BRIDGE ? 'BRIDGE' : 'direct-gemini'}`);

// ── 3. AGENT NODES (DEV FLOOR) ───────────────────────────

// JANE — PM / Triage + AGENT_STATE
async function janeNode(state) {
  const projectName = state.userRequest.trim();
  const projInfo = setProjectDir(projectName, true);
  await cleanProjectForDev(); // Clear old dev artifacts, keep PMD
  const taskId = state._taskId || `TASK-${Date.now().toString(36).toUpperCase()}`;
  
  console.log("JANE: Reading state...");
  await broadcastWorkItem('create', taskId, projectName, 0, '#8b5cf6');
  await broadcastTelemetry('jane', 0, 'working', `📋 Reading project memory and triaging...`);

  // Jane reads AGENT_STATE first (project memory)
  let agentState = '';
  try { agentState = await fileReadTool.func('AGENT_STATE.md'); } catch(e) {}

  // Jane reads scope docs
  console.log("JANE: Reading scope docs...");
  let A5_PRD_Phase1 = '';
  let B6_Quick_Wins_110 = '';
  let B7_Admin = '';
  let A3_Modules = '';
  try { A5_PRD_Phase1 = await fileReadTool.func('PMD/A5_PRD_Phase1.md'); } catch(e) {}
  try { B6_Quick_Wins_110 = await fileReadTool.func('docs/B6_Quick_Wins_110.md'); } catch(e) {}
  try { A3_Modules = await fileReadTool.func('PMD/A3_Module_Breakdown.md'); } catch(e) {}
  // B7 Admin standard is a reference template, not project-specific
  try { B7_Admin = await readTemplate('B7'); } catch(e) {}

  console.log("JANE: Invoking model geminiFlash...");
  try {
    const response = await geminiFlash.invoke([
      new SystemMessage(`You are Jane, senior PM agent at Agentryx 110 Labs.
  Read the AGENT_STATE (project memory) and PMD specs. Produce a JSON dev target.

  IMPORTANT:
  - If AGENT_STATE exists and shows IN_PROGRESS work, resume from there.
  - The B7 Admin & Operations module is MANDATORY — always include M0, M-AUTH, M-ADMIN.
  - Include Quick Wins from B6 in Phase 1.

  Output ONLY valid JSON:
  {
    "title": "short task title",
    "description": "exactly what to build",
    "modules": [{"name": "M0-Infrastructure", "files": [...], "description": "..."}, ...],
    "adminModule": "Include B7 standard: config management, log viewer, health dashboard, user management, audit trail",
    "testCriteria": ["criterion 1", ...],
    "quickWins": ["dark mode", "export CSV", ...]
  }`),
      new HumanMessage(`AGENT_STATE (memory):\n${agentState.substring(0, 1500)}\n\nA3 Modules:\n${A3_Modules.substring(0, 2000)}\n\nA5 PRD Phase 1:\n${A5_PRD_Phase1.substring(0, 3000)}\n\nB6 Quick Wins:\n${B6_Quick_Wins_110.substring(0, 1500)}\n\nB7 Admin Standard (mandatory):\n${B7_Admin.substring(0, 2000)}`)
    ]);
    console.log("JANE: Model call complete");
    await broadcastTelemetry('jane', 0, 'idle', `✅ Triage complete. Dev spec ready.`);
    return { triageSpec: response.content, currentAgent: 'spock', _taskId: taskId, _taskName: projectName, _projectDir: projInfo.dirName };
  } catch (err) {
    console.error("JANE MODEL ERROR:", err.message);
    throw err;
  }
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
  let responseContent = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  while ((match = fileRegex.exec(responseContent)) !== null) {
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
  return { codeOutput: summary, currentAgent: 'tuvok', iteration: (state.iteration || 0) + 1 };
}

// TUVOK — QA Fortress: Writes REAL test files + runs them
async function tuvokNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 3, '#8b5cf6');
  await broadcastTelemetry('tuvok', 3, 'working', `Building test suite and running QA...`);

  // Read all source files Torres wrote
  let codeContent = '';
  const files = String(state.codeOutput || '').match(/[\w\-/.]+\.\w+/g) || [];
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
  let testResponseContent = typeof testResponse.content === 'string' ? testResponse.content : JSON.stringify(testResponse.content);
  while ((match = fileRegex.exec(testResponseContent)) !== null) {
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
  const files = String(state.codeOutput || '').match(/[\w\-/.]+\.\w+/g) || [];
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

// CRUSHER — Documentation: B1 API Reference + B2 Dev Docs + B5 Training Guide
async function crusherNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 5, '#8b5cf6');
  await broadcastTelemetry('crusher', 5, 'working', `📚 Generating B1 API Reference + B2 Dev Docs + B5 Training Guide...`);

  // Read code files to document them
  let codeContent = '';
  const files = String(state.codeOutput || '').match(/[\w\-/.]+\.\w+/g) || [];
  for (const f of files.slice(0, 5)) {
    try {
      const content = await fileReadTool.func(f);
      codeContent += `\n--- ${f} ---\n${content}\n`;
    } catch (e) { /* skip */ }
  }

  const b1Tpl = await readTemplate('B1');
  const b2Tpl = await readTemplate('B2');
  const b5Tpl = await readTemplate('B5');

  const response = await geminiFlash.invoke([
    new SystemMessage(`You are Crusher, Documentation & Training Agent at Agentryx 110 Labs.
Generate THREE documents from the source code:

1. B1_API_Reference.md — Complete API docs with every endpoint, request/response examples, curl/fetch examples.
2. B2_Developer_Documentation.md — Quick start guide, project structure, env vars, scripts, Docker, troubleshooting.
3. B5_Training_Guide.md — End-user training: feature guides, step-by-step walkthroughs, FAQ, glossary.

Use templates:
--- B1 TEMPLATE ---
${b1Tpl}
--- B2 TEMPLATE ---
${b2Tpl}
--- B5 TEMPLATE ---
${b5Tpl}

Output as FILE BLOCKS:
=== FILE: docs/B1_API_Reference.md ===
...
=== END FILE ===
=== FILE: docs/B2_Developer_Documentation.md ===
...
=== END FILE ===
=== FILE: docs/B5_Training_Guide.md ===
...
=== END FILE ===`),
    new HumanMessage(`TASK SPEC:\n${(state.triageSpec || '').substring(0, 1500)}\n\nCODE:\n${codeContent}`)
  ]);

  const fileRegex = /=== FILE: (.+?) ===\n?([\s\S]*?)=== END FILE ===/g;
  let match;
  let responseContent = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  while ((match = fileRegex.exec(responseContent)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    await fileWriteTool.func(JSON.stringify({ path: filePath, content }));
    await broadcastTelemetry('crusher', 5, 'working', `📄 ${filePath}`);
  }

  await broadcastTelemetry('crusher', 5, 'idle', `✅ B1 + B2 + B5 documentation complete.`);
  return { currentAgent: 'obrien' };
}

// O'BRIEN — SRE / Deploy: B9 Factory Report + Git + Package
async function obrienNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 5, '#8b5cf6');
  await broadcastTelemetry('obrien', 5, 'working', `📦 Building deployment package + B9 Factory Report...`);

  // Initialize git and commit
  try {
    await terminalTool.func('git init');
    await terminalTool.func('git add -A');
    const title = state._projectDir || 'project';
    await terminalTool.func(`git commit -m "Agentryx 110 Labs: ${title} — Dev Floor Complete"`);
  } catch (e) { /* git may already exist */ }

  // Generate B9 Factory Report (machine-readable audit trail)
  const qaContent = String(state.qaReport || '');
  const report = {
    _meta: { template: "B9_Factory_Report", version: "2.0", generatedBy: "O'Brien", generatedAt: new Date().toISOString() },
    project: { name: state._projectDir, code: state._taskId, status: "COMPLETE", completedAt: new Date().toISOString() },
    pipeline: {
      phases: [{
        phase: 1,
        name: "Dev Floor",
        steps: {
          triage: { agent: "Jane", status: "complete" },
          research: { agent: "Spock", status: "complete" },
          development: { agent: "Torres", filesWritten: (String(state.codeOutput || '').match(/[\w\-/.]+\.\w+/g) || []).length },
          testing: { agent: "Tuvok", status: "complete" },
          review: { agent: "Data", status: "complete" },
          documentation: { agent: "Crusher", docsGenerated: 3 },
          deployment: { agent: "O'Brien", status: "complete" }
        },
        gateStatus: qaContent.includes('PASS') ? 'PASS' : 'WARNING'
      }]
    },
    quality: {
      qaVerdict: qaContent.includes('PASS') ? 'PASS' : 'WARNING',
      selfHealingLoops: (state.iteration || 1) - 1,
    },
    deliverables: {
      documentsGenerated: {
        B_series: ['B1_API_Reference', 'B2_Developer_Documentation', 'B5_Training_Guide', 'B9_Factory_Report']
      }
    }
  };
  
  await fileWriteTool.func(JSON.stringify({
    path: 'B9_Factory_Report.json',
    content: JSON.stringify(report, null, 2)
  }));
  await broadcastTelemetry('obrien', 5, 'working', `📄 B9_Factory_Report.json`);

  // Update AGENT_STATE to mark dev complete
  try {
    const agentState = await fileReadTool.func('AGENT_STATE.md');
    const updatedState = agentState.replace(/status: ".*?"/, 'status: "Dev Complete"')
      .replace(/overall_completion: ".*?"/, 'overall_completion: "80%"');
    await fileWriteTool.func(JSON.stringify({ path: 'AGENT_STATE.md', content: updatedState }));
  } catch(e) { /* AGENT_STATE may not exist */ }

  await broadcastWorkItem('complete', state._taskId, state._taskName, 5, '#8b5cf6');
  await broadcastTelemetry('obrien', 5, 'idle', `✅ ${state._projectDir} packaged. B9 Factory Report generated.`);
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
  .addNode('jane', janeNode)
  .addNode('spock', spockNode)
  .addNode('torres', torresNode)
  .addNode('tuvok', tuvokNode)
  .addNode('data', dataNode)
  .addNode('crusher', crusherNode)
  .addNode('obrien', obrienNode)
  .addEdge('__start__', 'jane')
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
