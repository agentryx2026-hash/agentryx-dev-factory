import { StateGraph, Annotation, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { fileReadTool, fileWriteTool, fileListTool, terminalTool, broadcastTelemetry, broadcastWorkItem, setProjectDir, getProjectDir, readTemplate } from "./tools.js";
import 'dotenv/config';

/* ═══════════════════════════════════════════════════════════
   AGENTRYX 110 LABS — Post-Dev Pipeline v1
   
   Post-Dev / Ship & Deliver:
   Crusher → C1 Training Video Plans
   Crusher → C2 Manuals & Guides
   Crusher → C3 Support FAQ
   Jane    → P2 Final Status Report + P5 Handover
   O'Brien → C4 Post-Launch + Final B9 Update + Package
   ═══════════════════════════════════════════════════════════ */

// ── 1. STATE SCHEMA ──────────────────────────────────────
const PostDevState = Annotation.Root({
  userRequest: Annotation({ reducer: (a, b) => b ?? a }),
  currentAgent: Annotation({ reducer: (a, b) => b ?? a }),
  deliveryDocs: Annotation({ reducer: (a, b) => ({ ...a, ...(b || {}) }), default: () => ({}) }),
  _taskId: Annotation({ reducer: (a, b) => b ?? a }),
  _taskName: Annotation({ reducer: (a, b) => b ?? a }),
  _projectDir: Annotation({ reducer: (a, b) => b ?? a }),
});

// ── 2. MODEL ─────────────────────────────────────────────
// USE_ROUTER toggles the multi-provider router (Phase 2B). Default off →
// preserves direct-Gemini behavior. See dev_graph.js for full pattern.
const USE_ROUTER = process.env.USE_ROUTER === 'true';
let RouterChatModel;
if (USE_ROUTER) ({ RouterChatModel } = await import('@agentryx-factory/llm-router'));

const geminiFlash = USE_ROUTER
  ? new RouterChatModel({ task: 'cheap' })
  : new ChatGoogleGenerativeAI({ model: "gemini-2.5-flash", apiKey: process.env.GEMINI_API_KEY, temperature: 0.1 });

console.error(`[post_dev_graph] model backend: ${USE_ROUTER ? 'ROUTER' : 'direct-gemini'}`);

// ── 3. HELPER ────────────────────────────────────────────
async function parseAndWriteFiles(responseContent, docs, agentId) {
  const content = typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent);
  const fileRegex = /=== FILE: (.+?) ===\n?([\s\S]*?)=== END FILE ===/g;
  let match;
  let filesWritten = [];
  while ((match = fileRegex.exec(content)) !== null) {
    const filePath = match[1].trim();
    const fileContent = match[2].trim();
    await fileWriteTool.func(JSON.stringify({ path: filePath, content: fileContent }));
    const docKey = filePath.split('/').pop().replace('.md', '');
    docs[docKey] = fileContent;
    filesWritten.push(filePath);
    if (agentId) await broadcastTelemetry(agentId, 0, 'working', `📄 ${filePath}`);
  }
  return filesWritten;
}

// ── 4. AGENT NODES ───────────────────────────────────────

// CRUSHER — Training & Delivery Docs: C1 Video Plans, C2 Manuals, C3 FAQ
async function crusherDeliveryNode(state) {
  const projectName = state.userRequest.trim();
  const projInfo = setProjectDir(projectName, true);
  const taskId = `SHIP-${Date.now().toString(36).toUpperCase()}`;

  await broadcastWorkItem('create', taskId, projectName, 0, '#22c55e');
  await broadcastTelemetry('crusher', 0, 'working', `📚 Generating delivery documentation: Training, Manuals, FAQ...`);

  // Read existing docs for context
  let b1Api = '', b5Training = '', agentState = '';
  try { b1Api = await fileReadTool.func('docs/B1_API_Reference.md'); } catch(e) {}
  try { b5Training = await fileReadTool.func('docs/B5_Training_Guide.md'); } catch(e) {}
  try { agentState = await fileReadTool.func('AGENT_STATE.md'); } catch(e) {}

  const response = await geminiFlash.invoke([
    new SystemMessage(`You are Crusher, Documentation & Training Agent at Agentryx 110 Labs.
Generate THREE delivery documents:

1. C1_Video_Scripts.md — Training video scripts for each major feature. Include: title, duration estimate, narration text, screen steps, key points to demonstrate.
2. C2_User_Manual.md — Complete end-user manual organized by feature. Include screenshots descriptions, step-by-step procedures, tips, troubleshooting.
3. C3_Support_FAQ.md — Frequently Asked Questions organized by category. Include: General, Account, Features, Technical, Security, Troubleshooting.

RULES:
- C1 video scripts should be ready for screen recording — specific enough that anyone can follow.
- C2 manual should be usable WITHOUT the developer. Plain language, no jargon.
- C3 FAQ should cover the top 20-30 questions a user or admin would ask.

Output as FILE BLOCKS:
=== FILE: docs/C1_Video_Scripts.md ===
(content)
=== END FILE ===
=== FILE: docs/C2_User_Manual.md ===
(content)
=== END FILE ===
=== FILE: docs/C3_Support_FAQ.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`B1 API Reference:\n${b1Api.substring(0, 2000)}\n\nB5 Training Guide:\n${b5Training.substring(0, 2000)}\n\nAGENT_STATE:\n${agentState.substring(0, 1500)}`)
  ]);

  let deliveryDocs = { ...state.deliveryDocs };
  await parseAndWriteFiles(response.content, deliveryDocs, 'crusher');

  await broadcastTelemetry('crusher', 0, 'idle', `✅ C1 Video Scripts + C2 Manual + C3 FAQ complete.`);
  return { deliveryDocs, currentAgent: 'jane_close', _taskId: taskId, _taskName: projectName, _projectDir: projInfo.dirName };
}

// JANE — Final Status Report (P2) + Project Handover (P5)
async function janeCloseNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 0, '#22c55e');
  await broadcastTelemetry('jane', 0, 'working', `📋 Generating final status report and handover document...`);

  let agentState = '', a6Acceptance = '';
  try { agentState = await fileReadTool.func('AGENT_STATE.md'); } catch(e) {}
  try { a6Acceptance = await fileReadTool.func('PMD/A6_Acceptance_Criteria.md'); } catch(e) {}

  const p2Tpl = await readTemplate('P2');
  const p5Tpl = await readTemplate('P5');

  const response = await geminiFlash.invoke([
    new SystemMessage(`You are Jane, PM/Triage Agent at Agentryx 110 Labs.
Generate TWO project management documents:

1. P2_Final_Status_Report.md — Final project status report summarizing what was built, tested, deployed, and any outstanding items.
2. P5_Handover_Closure.md — Formal project handover document with: deliverables checklist, knowledge transfer items, support plan, post-launch responsibilities, and sign-off.

Use templates:
--- P2 TEMPLATE ---
${p2Tpl}
--- P5 TEMPLATE ---
${p5Tpl}

Output as FILE BLOCKS:
=== FILE: docs/P2_Final_Status_Report.md ===
(content)
=== END FILE ===
=== FILE: docs/P5_Handover_Closure.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`AGENT_STATE:\n${agentState.substring(0, 2000)}\n\nA6 Acceptance Criteria:\n${a6Acceptance.substring(0, 2000)}`)
  ]);

  let deliveryDocs = { ...state.deliveryDocs };
  await parseAndWriteFiles(response.content, deliveryDocs, 'jane');

  await broadcastTelemetry('jane', 0, 'idle', `✅ P2 Status Report + P5 Handover complete.`);
  return { deliveryDocs, currentAgent: 'obrien_ship' };
}

// O'BRIEN — C4 Post-Launch Plan + Final Package + B9 Update
async function obrienShipNode(state) {
  await broadcastWorkItem('move', state._taskId, state._taskName, 0, '#22c55e');
  await broadcastTelemetry('obrien', 0, 'working', `📦 Post-launch plan + final packaging...`);

  let agentState = '', b8Infra = '';
  try { agentState = await fileReadTool.func('AGENT_STATE.md'); } catch(e) {}
  try { b8Infra = await fileReadTool.func('docs/B8_Infrastructure_Plan.md'); } catch(e) {}

  const response = await geminiFlash.invoke([
    new SystemMessage(`You are O'Brien, SRE/Deploy Agent at Agentryx 110 Labs.
Generate the C4 Post-Launch Plan:

1. Monitoring checklist (what to watch in the first 7 days)
2. Common issues and runbook for each
3. Backup verification schedule
4. Performance benchmarks to track
5. SSL renewal reminders
6. First maintenance window plan
7. Escalation matrix

Output as FILE BLOCK:
=== FILE: docs/C4_Post_Launch_Plan.md ===
(content)
=== END FILE ===`),
    new HumanMessage(`B8 Infrastructure:\n${b8Infra.substring(0, 2000)}\n\nAGENT_STATE:\n${agentState.substring(0, 1000)}`)
  ]);

  let deliveryDocs = { ...state.deliveryDocs };
  await parseAndWriteFiles(response.content, deliveryDocs, 'obrien');

  // Update B9 Factory Report with post-dev completion
  try {
    let b9 = await fileReadTool.func('B9_Factory_Report.json');
    let report = JSON.parse(b9);
    report.project.status = 'SHIPPED';
    report.deliverables.documentsGenerated.C_series = ['C1_Video_Scripts', 'C2_User_Manual', 'C3_Support_FAQ', 'C4_Post_Launch_Plan'];
    report.deliverables.documentsGenerated.P_series = ['P2_Final_Status_Report', 'P5_Handover_Closure'];
    await fileWriteTool.func(JSON.stringify({ path: 'B9_Factory_Report.json', content: JSON.stringify(report, null, 2) }));
    await broadcastTelemetry('obrien', 0, 'working', `📄 B9_Factory_Report.json updated → SHIPPED`);
  } catch(e) { /* B9 may not exist */ }

  // Update AGENT_STATE to SHIPPED
  try {
    const agentSt = await fileReadTool.func('AGENT_STATE.md');
    const updated = agentSt.replace(/status: ".*?"/, 'status: "SHIPPED"')
      .replace(/overall_completion: ".*?"/, 'overall_completion: "100%"');
    await fileWriteTool.func(JSON.stringify({ path: 'AGENT_STATE.md', content: updated }));
  } catch(e) {}

  // Final git commit
  try {
    await terminalTool.func('git add -A');
    await terminalTool.func(`git commit -m "Agentryx 110 Labs: ${state._projectDir} — SHIPPED"`);
  } catch(e) {}

  await broadcastWorkItem('complete', state._taskId, state._taskName, 0, '#22c55e');
  await broadcastTelemetry('obrien', 0, 'idle', `✅ ${state._projectDir} SHIPPED. All documents generated.`);
  return { deliveryDocs, currentAgent: '__end__' };
}

// ── 5. BUILD THE GRAPH ───────────────────────────────────

const workflow = new StateGraph(PostDevState)
  .addNode('crusher_delivery', crusherDeliveryNode)
  .addNode('jane_close', janeCloseNode)
  .addNode('obrien_ship', obrienShipNode)
  .addEdge('__start__', 'crusher_delivery')
  .addEdge('crusher_delivery', 'jane_close')
  .addEdge('jane_close', 'obrien_ship')
  .addEdge('obrien_ship', '__end__');

export const postDevGraph = workflow.compile();

// ── 6. CLI Runner ────────────────────────────────────────

async function main() {
  const projectFolder = process.argv[2];
  if (!projectFolder) {
    console.error('Usage: node post_dev_graph.js <project-folder-name>');
    process.exit(1);
  }
  
  console.log('═══════════════════════════════════════════════════');
  console.log('🚀 AGENTRYX 110 LABS — Post-Dev Pipeline v1');
  console.log(`📁 Project: ${projectFolder}`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('Pipeline: Crusher(C1+C2+C3) → Jane(P2+P5) → O\'Brien(C4+B9+package)');
  console.log('');

  const result = await postDevGraph.invoke({
    userRequest: projectFolder,
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('🎉 POST-DEV PIPELINE COMPLETE — PROJECT SHIPPED');
  console.log(`📁 Project: ${result._projectDir}`);
  console.log(`📄 Delivery Docs: ${Object.keys(result.deliveryDocs).length}`);
  console.log('═══════════════════════════════════════════════════');
}

main().catch(console.error);
