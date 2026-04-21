import { StateGraph, Annotation, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { fileReadTool, fileWriteTool, fileListTool, terminalTool, gitTool, broadcastTelemetry, broadcastWorkItem, setProjectDir, getProjectDir, readTemplate } from "./tools.js";
import 'dotenv/config';

/* ═══════════════════════════════════════════════════════════
   AGENTRYX AI LABS — Pre-Dev Pipeline v4
   
   Full Intake Flow:
   Picard → A0, A1, A2
   Sisko  → A3, A4, A5
   Picard → A6
   Troi   → B4, B6
   O'Brien→ B8
   Picard → P0
   Jane   → AGENT_STATE init
   ═══════════════════════════════════════════════════════════ */

// ── 1. STATE SCHEMA ──────────────────────────────────────
const PreDevState = Annotation.Root({
  userRequest: Annotation({ reducer: (a, b) => b ?? a }),
  pmdDocs: Annotation({ reducer: (a, b) => ({ ...a, ...(b || {}) }), default: () => ({}) }),
  currentAgent: Annotation({ reducer: (a, b) => b ?? a }),
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

console.error(`[pre_dev_graph] model backend: ${USE_ROUTER ? 'ROUTER' : 'direct-gemini'}`);

// ── HELPER: Parse FILE BLOCKS and write them ─────────────
async function parseAndWriteFiles(responseContent, pmdDocs, agentId) {
  const content = typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent);
  const fileRegex = /=== FILE: (.+?) ===\n?([\s\S]*?)=== END FILE ===/g;
  let match;
  let filesWritten = [];
  while ((match = fileRegex.exec(content)) !== null) {
    const filePath = match[1].trim();
    const fileContent = match[2].trim();
    await fileWriteTool.func(JSON.stringify({ path: filePath, content: fileContent }));
    const docKey = filePath.split('/').pop().replace('.md', '').replace('.json', '');
    pmdDocs[docKey] = fileContent;
    filesWritten.push(filePath);
    if (agentId) await broadcastTelemetry(agentId, 0, 'working', `Wrote: ${filePath}`);
  }
  return filesWritten;
}

// ── 3. AGENT NODES ───────────────────────────────────────

// PICARD — Solution Architect: A0 Source Analysis + A1 Brief + A2 Architecture
async function picardScopeNode(state) {
  const taskId = `SCOPE-${Date.now().toString(36).toUpperCase()}`;
  
  // Extract project name
  let projNameRaw = state.userRequest.substring(0, 30);
  const projMatch = state.userRequest.match(/^PROJECT_NAME:\s*(.+)/);
  if (projMatch) projNameRaw = projMatch[1].trim();
  
  const projInfo = setProjectDir(projNameRaw);
  const taskName = projNameRaw.substring(0, 25);
  
  await broadcastWorkItem('create', taskId, taskName, 0, '#8b5cf6');
  await broadcastTelemetry('picard', 0, 'working', `📋 Analyzing source document & architecting solution...`);

  const a0Tpl = await readTemplate('A0');
  const a1Tpl = await readTemplate('A1');
  const a2Tpl = await readTemplate('A2');

  const response = await geminiPro.invoke([
    new SystemMessage(`You are Picard, Solution Architect at Agentryx 110 Labs.
Your job is to analyze a raw customer request/FRS and produce THREE documents:

1. A0_Source_Analysis.md — Gap analysis of the source document. Identify missing requirements, ambiguities, contradictions, scope creep risks, and our additions beyond what was asked.
2. A1_Solution_Brief.md — Project identity, executive summary, problem statement, proposed solution, scope definition, success metrics.
3. A2_Solution_Architecture.md — Technology stack decisions, system architecture, data architecture, auth/security design, deployment model.

CRITICAL RULES:
- Fill in ALL placeholders with real analysis from the source document.
- Do NOT leave {placeholder} values — replace every single one.
- Be thorough and specific. This is the foundation everything else builds on.

Use these templates as your exact structure:
--- A0 TEMPLATE ---
${a0Tpl}
--- A1 TEMPLATE ---
${a1Tpl}
--- A2 TEMPLATE ---
${a2Tpl}

Output your response as FILE BLOCKS:
=== FILE: PMD/A0_Source_Analysis.md ===
(content)
=== END FILE ===
=== FILE: PMD/A1_Solution_Brief.md ===
(content)
=== END FILE ===
=== FILE: PMD/A2_Solution_Architecture.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`Raw Customer Request / FRS:\n${state.userRequest}`)
  ]);

  let pmdDocs = { ...state.pmdDocs };
  await parseAndWriteFiles(response.content, pmdDocs, 'picard');

  await broadcastTelemetry('picard', 0, 'idle', `✅ A0 Source Analysis + A1 Brief + A2 Architecture complete.`);
  return { pmdDocs, currentAgent: 'sisko', _taskId: taskId, _taskName: taskName, _projectDir: projInfo.dirName };
}

// SISKO — Project Planner: A3 Module Breakdown + A4 Dev Plan + A5 PRD Phase1
async function siskoNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 0, '#8b5cf6');
  await broadcastTelemetry('sisko', 0, 'working', `📊 Breaking down modules, phasing, and writing Phase 1 PRD...`);

  const a3Tpl = await readTemplate('A3');
  const a4Tpl = await readTemplate('A4');
  const a5Tpl = await readTemplate('A5');

  const response = await geminiPro.invoke([
    new SystemMessage(`You are Sisko, Project Planner at Agentryx 110 Labs.
Based on Picard's A0 analysis and A2 architecture, write THREE documents:

1. A3_Module_Breakdown.md — Complete module map with standard modules (M0, M-AUTH, M-ADMIN) AND project-specific modules. Include dependency graph, effort estimates, and module detail for EACH project-specific module.
2. A4_Dev_Plan_Phasing.md — Phase the modules into sprints. Include agent assignments, gate criteria, self-healing protocol, and resource allocation.
3. A5_PRD_Phase1.md — Detailed Phase 1 PRD with EXACT endpoint specs, input schemas, validation rules, test scenarios, and UI component specs.

CRITICAL RULES:
- Standard modules (M0, M-AUTH, M-ADMIN) are ALWAYS included — see B7 template for their specs.
- Fill in ALL placeholders with real data from Picard's documents.
- A5 must have CONCRETE endpoint definitions, not placeholder text.

Use these templates:
--- A3 TEMPLATE ---
${a3Tpl}
--- A4 TEMPLATE ---
${a4Tpl}
--- A5 TEMPLATE ---
${a5Tpl}

Output as FILE BLOCKS:
=== FILE: PMD/A3_Module_Breakdown.md ===
(content)
=== END FILE ===
=== FILE: PMD/A4_Dev_Plan_Phasing.md ===
(content)
=== END FILE ===
=== FILE: PMD/A5_PRD_Phase1.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`A0 Source Analysis:\n${state.pmdDocs['A0_Source_Analysis'] || ''}\n\nA1 Brief:\n${state.pmdDocs['A1_Solution_Brief'] || ''}\n\nA2 Architecture:\n${state.pmdDocs['A2_Solution_Architecture'] || ''}`)
  ]);

  let pmdDocs = { ...state.pmdDocs };
  await parseAndWriteFiles(response.content, pmdDocs, 'sisko');

  await broadcastTelemetry('sisko', 0, 'idle', `✅ A3 Modules + A4 Phasing + A5 PRD Phase1 complete.`);
  return { pmdDocs, currentAgent: 'picard_a6' };
}

// PICARD again — A6 Acceptance Criteria (needs A1 + A5)
async function picardA6Node(state) {
  await broadcastTelemetry('picard', 0, 'working', `📋 Writing acceptance criteria...`);

  const a6Tpl = await readTemplate('A6');

  const response = await geminiPro.invoke([
    new SystemMessage(`You are Picard, Solution Architect at Agentryx 110 Labs.
Write the A6 Acceptance Criteria document — the FINAL checklist for project delivery.

Cover:
1. Functional acceptance criteria (every feature with pass/fail test)
2. Non-functional criteria (performance, security, quality)
3. Documentation acceptance (all PMD documents generated)
4. Delivery package checklist
5. Sign-off section
6. Defect tolerance

Use this template:
--- A6 TEMPLATE ---
${a6Tpl}

Output as FILE BLOCK:
=== FILE: PMD/A6_Acceptance_Criteria.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`A1 Brief:\n${state.pmdDocs['A1_Solution_Brief'] || ''}\n\nA3 Modules:\n${state.pmdDocs['A3_Module_Breakdown'] || ''}\n\nA5 PRD Phase1:\n${state.pmdDocs['A5_PRD_Phase1'] || ''}`)
  ]);

  let pmdDocs = { ...state.pmdDocs };
  await parseAndWriteFiles(response.content, pmdDocs, 'picard');

  await broadcastTelemetry('picard', 0, 'idle', `✅ A6 Acceptance Criteria complete.`);
  return { pmdDocs, currentAgent: 'troi' };
}

// TROI — Enhancement Analyst: B4 AI Enhancement + B6 Quick Wins 110%
async function troiNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 0, '#8b5cf6');
  await broadcastTelemetry('troi', 0, 'working', `✨ Identifying AI opportunities and 110% Quick Wins...`);

  const b4Tpl = await readTemplate('B4');
  const b6Tpl = await readTemplate('B6');

  const response = await geminiPro.invoke([
    new SystemMessage(`You are Troi, Enhancement Analyst at Agentryx 110 Labs.
Your job is the "110%". Analyze the project and produce TWO documents:

1. B4_AI_Enhancement_Report.md — Identify AI/ML opportunities. If the project has searchable content, reports, data extraction, or decision workflows, suggest AI enhancements with feasibility, effort, and ROI. If none apply, write "B4: Not applicable — no AI opportunities identified."
2. B6_Quick_Wins_110.md — Select 5-10 low-effort, high-delight features the customer didn't ask for but will love. Scan the Quick Win Library in the template for applicable items.

RULES:
- Quick Wins must meet ALL criteria: <1 agent-cycle effort, noticeable impact, zero risk, self-contained.
- AI enhancements must specify technical approach, data needs, and privacy implications.

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
    new HumanMessage(`A1 Brief:\n${state.pmdDocs['A1_Solution_Brief'] || ''}\n\nA3 Modules:\n${state.pmdDocs['A3_Module_Breakdown'] || ''}`)
  ]);

  let pmdDocs = { ...state.pmdDocs };
  await parseAndWriteFiles(response.content, pmdDocs, 'troi');

  await broadcastTelemetry('troi', 0, 'idle', `✅ B4 AI Enhancement + B6 Quick Wins complete.`);
  return { pmdDocs, currentAgent: 'obrien_infra' };
}

// O'BRIEN — Infrastructure Plan: B8
async function obrienInfraNode(state) {
  await broadcastTelemetry('obrien', 0, 'working', `🏗️ Planning infrastructure and resources...`);

  const b8Tpl = await readTemplate('B8');

  const response = await geminiFlash.invoke([
    new SystemMessage(`You are O'Brien, SRE/Deploy Agent at Agentryx 110 Labs.
Write the B8 Infrastructure Plan based on the architecture decisions in A2.

Cover: VM specs, RAM allocation, storage layout, software stack checklist, firewall rules, backup strategy, monitoring, and standby/failover.

Use this template:
--- B8 TEMPLATE ---
${b8Tpl}

Output as FILE BLOCK:
=== FILE: docs/B8_Infrastructure_Plan.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`A2 Architecture:\n${state.pmdDocs['A2_Solution_Architecture'] || ''}\n\nA3 Modules:\n${state.pmdDocs['A3_Module_Breakdown'] || ''}`)
  ]);

  let pmdDocs = { ...state.pmdDocs };
  await parseAndWriteFiles(response.content, pmdDocs, 'obrien');

  await broadcastTelemetry('obrien', 0, 'idle', `✅ B8 Infrastructure Plan complete.`);
  return { pmdDocs, currentAgent: 'picard_p0' };
}

// PICARD — Executive Summary: P0
async function picardP0Node(state) {
  await broadcastTelemetry('picard', 0, 'working', `📄 Writing Executive Summary for client...`);

  const p0Tpl = await readTemplate('P0');

  const response = await geminiFlash.invoke([
    new SystemMessage(`You are Picard, Solution Architect at Agentryx 110 Labs.
Write the P0 Executive Summary — a CLIENT-FACING document. Keep it concise, non-technical, and professional.

This is what the CEO or steering committee reads. No jargon. Plain language.

Use this template:
--- P0 TEMPLATE ---
${p0Tpl}

Output as FILE BLOCK:
=== FILE: docs/P0_Executive_Summary.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`A1 Brief:\n${state.pmdDocs['A1_Solution_Brief'] || ''}\n\nA3 Modules:\n${state.pmdDocs['A3_Module_Breakdown'] || ''}\n\nA4 Phasing:\n${state.pmdDocs['A4_Dev_Plan_Phasing'] || ''}`)
  ]);

  let pmdDocs = { ...state.pmdDocs };
  await parseAndWriteFiles(response.content, pmdDocs, 'picard');

  await broadcastTelemetry('picard', 0, 'idle', `✅ P0 Executive Summary complete.`);
  return { pmdDocs, currentAgent: 'jane_init' };
}

// JANE — Initialize AGENT_STATE (project memory)
async function janeInitNode(state) {
  await broadcastTelemetry('jane', 0, 'working', `🧠 Initializing project memory (AGENT_STATE)...`);

  const agentStateTpl = await readTemplate('AGENT_STATE');

  const response = await geminiFlash.invoke([
    new SystemMessage(`You are Jane, PM/Triage Agent at Agentryx 110 Labs.
Create the initial AGENT_STATE.md for this project. This is the AI agent's memory — the single source of truth for project state.

Fill in:
- IDENTITY section with real project details
- TECH STACK from A2
- CURRENT STATE at 0% — Pre-Dev complete, ready for Dev
- NOT STARTED section with all modules from A3
- KEY DECISIONS from A2's architecture decisions
- FILE MAP skeleton
- WHAT TO DO NEXT: "Phase 1 development — begin with M0 Infrastructure"

Use this template:
--- AGENT_STATE TEMPLATE ---
${agentStateTpl}

Output as FILE BLOCK:
=== FILE: AGENT_STATE.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`A1 Brief:\n${(state.pmdDocs['A1_Solution_Brief'] || '').substring(0, 2000)}\n\nA2 Architecture:\n${(state.pmdDocs['A2_Solution_Architecture'] || '').substring(0, 2000)}\n\nA3 Modules:\n${(state.pmdDocs['A3_Module_Breakdown'] || '').substring(0, 2000)}`)
  ]);

  let pmdDocs = { ...state.pmdDocs };
  await parseAndWriteFiles(response.content, pmdDocs, 'jane');

  await broadcastTelemetry('jane', 0, 'idle', `✅ AGENT_STATE initialized. Project memory ready.`);
  return { pmdDocs, currentAgent: '__end__' };
}

// ── 4. BUILD THE GRAPH ───────────────────────────────────

const workflow = new StateGraph(PreDevState)
  .addNode('picard_scope', picardScopeNode)
  .addNode('sisko', siskoNode)
  .addNode('picard_a6', picardA6Node)
  .addNode('troi', troiNode)
  .addNode('obrien_infra', obrienInfraNode)
  .addNode('picard_p0', picardP0Node)
  .addNode('jane_init', janeInitNode)
  .addEdge('__start__', 'picard_scope')
  .addEdge('picard_scope', 'sisko')
  .addEdge('sisko', 'picard_a6')
  .addEdge('picard_a6', 'troi')
  .addEdge('troi', 'obrien_infra')
  .addEdge('obrien_infra', 'picard_p0')
  .addEdge('picard_p0', 'jane_init')
  .addEdge('jane_init', '__end__');

export const preDevGraph = workflow.compile();

// ── 5. CLI Runner ────────────────────────────────────────

async function main() {
  let task = process.argv.slice(2).join(' ') || 'Create a Node.js REST API with user registration and login using JWT authentication';
  if (task.startsWith('FILE:')) {
    const fs = await import('node:fs/promises');
    task = await fs.readFile(task.substring(5), 'utf-8');
  }
  
  console.log('═══════════════════════════════════════════════════');
  console.log('🖖 AGENTRYX 110 LABS — Pre-Dev Pipeline v4');
  console.log(`📋 Scope: ${task.substring(0, 150)}...`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('Pipeline: Picard(A0+A1+A2) → Sisko(A3+A4+A5) → Picard(A6) → Troi(B4+B6) → O\'Brien(B8) → Picard(P0) → Jane(AGENT_STATE)');
  console.log('');

  const result = await preDevGraph.invoke({
    userRequest: task,
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('✅ PRE-DEV PIPELINE COMPLETE');
  console.log(`📁 Project: ${result._projectDir}`);
  console.log(`📄 Documents Generated: ${Object.keys(result.pmdDocs).length}`);
  console.log('═══════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
