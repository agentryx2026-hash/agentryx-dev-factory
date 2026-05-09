import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PORT = Number(process.env.TELEMETRY_PORT) || 4401;
const clients = new Set();
let mockInterval = null;

// ─── Phase 21-A: Master Architect endpoints ──────────────────────────────
// The architect's Knowledge Base lives at <repo>/_kb/. Modules are loaded
// lazily (first request) so the dev-hub can boot even if architect/ is
// missing or broken.
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const ARCHITECT_KB_ROOT = REPO_ROOT;
const ARCHITECT_DIR = path.join(REPO_ROOT, 'cognitive-engine', 'architect');

let architectModules = null;
async function loadArchitect() {
  if (architectModules) return architectModules;
  const [kbMod, researcherMod, proposerMod, architectMod, schedulerMod, briefMod] = await Promise.all([
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'kb.js')).href),
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'researcher.js')).href),
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'proposer.js')).href),
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'architect.js')).href),
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'scheduler.js')).href),
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'brief.js')).href),
  ]);
  // Phase 15-A proposal store (architect emits proposals into it)
  const storeMod = await import(
    pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'self-improvement', 'store.js')).href
  );
  architectModules = {
    createKnowledgeBase: kbMod.createKnowledgeBase,
    createResearcher: researcherMod.createResearcher,
    createStubDispatcher: researcherMod.createStubDispatcher,
    createArchitectProposer: proposerMod.createArchitectProposer,
    createArchitect: architectMod.createArchitect,
    createProposalStore: storeMod.createProposalStore,
    createCadenceDaemon: schedulerMod.createCadenceDaemon,
    runBrief: briefMod.runBrief,
    composeBriefPrompt: briefMod.composeBriefPrompt,
  };
  return architectModules;
}

// ─── Architect cadence daemon ─────────────────────────────────────────────
// Boots once on telemetry startup. Each tick reads Standing Orders and fires
// any cadence whose configured local time/day matches the current minute.
// Stays paused if baseline.paused === true. All persistence + dedupe goes
// through the KB.
let cadenceDaemonHandle = null;
async function bootCadenceDaemon() {
  if (cadenceDaemonHandle) return cadenceDaemonHandle;
  try {
    const A = await loadArchitect();
    const kb = A.createKnowledgeBase(ARCHITECT_KB_ROOT);
    const proposalStore = A.createProposalStore(ARCHITECT_KB_ROOT);

    cadenceDaemonHandle = A.createCadenceDaemon({
      readStandingOrders: () => kb.readStandingOrders(),
      recordCadenceFire:  (k, p) => kb.recordCadenceFire(k, p),
      lastCadenceFire:    (k)    => kb.lastCadenceFire(k),
      runCadencePass: async (cadenceKind, cadenceConfig) => {
        // For each cadence we run a fresh architect.runPass with the
        // cadence's own dispatcher + budget. The pass label IS the cadence
        // kind so listPasses({pass_kind:"weekly"}) groups cycle reports.
        const proposer = A.createArchitectProposer({ proposalStore, kb });
        const researcher = A.createResearcher({
          dispatchSubagent: A.createStubDispatcher(), // 21-B replaces this with real Sonnet
          budget_usd_per_pass: cadenceConfig.budget_usd ?? 1.5,
        });
        const architect = A.createArchitect({ kb, researcher, proposer });
        const result = await architect.runPass(cadenceKind, {
          cadence: cadenceKind,
          cadence_config: cadenceConfig,
        });

        // If the cadence has report_enabled, synthesize a Report artifact.
        // (For Phase 21-A the report shape is real; the content is synthetic
        // since dispatcher=stub. 21-B fills with real prose.)
        if (cadenceConfig.report_enabled) {
          const findings = await kb.listFindings({ pass_id: result.pass?.id, limit: 200 });
          const sections = [
            {
              heading: `${cadenceKind[0].toUpperCase()}${cadenceKind.slice(1)} cycle summary`,
              kind: "narrative",
              body: `Cadence \`${cadenceKind}\` ran at ${new Date(result.pass?.completed_at || Date.now()).toISOString()}. Produced ${result.findings_count ?? 0} findings, ${result.proposals_count ?? 0} candidate proposals at $${(result.cost_usd ?? 0).toFixed(2)} cost. ${result.cost_usd === 0 ? '_(stub dispatcher — synthetic findings; Phase 21-B replaces with real Sonnet research.)_' : ''}`,
            },
          ];
          if (findings.length) {
            sections.push({
              heading: "Findings by priority area",
              kind: "list",
              body: findings.map(f => `- **[${f.priority_area || 'untagged'}]** ${f.content || '(no content)'}`).join("\n"),
            });
          }
          if (cadenceKind === "monthly") {
            sections.push({
              heading: "Criteria health check",
              kind: "criteria-health",
              body: `_(stub)_ Architect should review the priority-area set against shipped modules and propose adding/removing/renaming areas. Phase 21-B implements this with the real dispatcher.`,
            });
          }
          const report = await kb.writeReport({
            kind: "cycle",
            cadence: cadenceKind,
            pass_id: result.pass?.id,
            title: `${cadenceKind[0].toUpperCase()}${cadenceKind.slice(1)} cycle — ${new Date().toISOString().slice(0,10)}`,
            summary: `Architect ${cadenceKind} cycle: ${result.findings_count ?? 0} findings, ${result.proposals_count ?? 0} proposals.`,
            sections,
            linked_findings: findings.map(f => f.id),
            linked_proposals: [],
            cost_usd: result.cost_usd ?? 0,
          });
          return { pass: result.pass, report };
        }
        return { pass: result.pass };
      },
      onReportProduced: (report) => {
        try {
          addLog('system', `👑 Architect cycle report ready: ${report.id} (${report.cadence})`);
          broadcast();
        } catch {}
      },
      logger: { info: (m) => console.log(m), warn: (m) => console.warn(m) },
    });

    const info = await cadenceDaemonHandle.start();
    console.log(`📅 Architect cadence daemon started (first tick in ${info.alignedFirstTickInMs}ms, period ${info.tickMs}ms)`);
  } catch (err) {
    console.error('[architect.daemon] failed to boot:', err);
    cadenceDaemonHandle = null;
  }
  return cadenceDaemonHandle;
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

// ─── Phase 12-B Tier B: flag-override persistence ────────────────────────
// The admin-substrate registry reads flags from process.env. To make UI
// toggles "live" without a restart, we maintain a small JSON override file
// at <repo>/_factory_runtime/flag_overrides.json. On telemetry startup we
// apply the persisted overrides into process.env. Subsequent reads (incl.
// the architect daemon, child-process spawns that inherit env) see the
// new values immediately.
const RUNTIME_DIR = path.join(REPO_ROOT, '_factory_runtime');
const FLAG_OVERRIDES_FILE = path.join(RUNTIME_DIR, 'flag_overrides.json');

function loadFlagOverrides() {
  try { return JSON.parse(fs.readFileSync(FLAG_OVERRIDES_FILE, 'utf-8')); } catch { return {}; }
}
function saveFlagOverrides(overrides) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const tmp = FLAG_OVERRIDES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(overrides, null, 2) + '\n');
  fs.renameSync(tmp, FLAG_OVERRIDES_FILE);
}
function applyFlagOverrides() {
  const overrides = loadFlagOverrides();
  for (const [envVar, value] of Object.entries(overrides)) {
    if (value === 'on') process.env[envVar] = 'true';
    else if (value === 'off') process.env[envVar] = 'false';
  }
}
applyFlagOverrides(); // run once at module load

// Seeding Standing Orders from example: the architect ships a hand-edited
// `standing_orders.example.yaml` (schema source-of-truth, comments preserved
// for the human reader), and a sibling `standing_orders.example.json` (same
// content, JSON-shaped, for runtime). The seed endpoint copies the JSON
// version directly — no YAML parser needed.
const SEED_JSON_PATH = path.join(ARCHITECT_DIR, 'standing_orders.example.json');

// Merge incoming custom_direction onto existing, preserving fields the
// editor doesn't expose. priority_areas are merged by id (incoming
// overrides existing fields per area; missing areas inherit from existing).
function mergeCustomDirection(existing = {}, incoming = {}) {
  const out = { ...(existing || {}), ...(incoming || {}) };
  if (existing?.overall_stance || incoming?.overall_stance) {
    out.overall_stance = { ...(existing?.overall_stance || {}), ...(incoming?.overall_stance || {}) };
  }
  if (existing?.effective_period || incoming?.effective_period) {
    out.effective_period = { ...(existing?.effective_period || {}), ...(incoming?.effective_period || {}) };
  }
  // Merge priority_areas by id
  const incomingAreas = Array.isArray(incoming?.priority_areas) ? incoming.priority_areas : null;
  const existingAreas = Array.isArray(existing?.priority_areas) ? existing.priority_areas : [];
  if (incomingAreas) {
    const byId = new Map(existingAreas.map(a => [a.id, a]));
    for (const a of incomingAreas) {
      const prev = byId.get(a.id) || {};
      byId.set(a.id, { ...prev, ...a });
    }
    // Preserve the canonical order: models, agents, languages, tools, output_quality, operations
    const ORDER = ['models', 'agents', 'languages', 'tools', 'output_quality', 'operations'];
    out.priority_areas = ORDER.map(id => byId.get(id)).filter(Boolean);
  }
  // strategic_watch and notes pass through (editor doesn't touch yet)
  return out;
}

function getInitialState() {
  return {
    agents: [
      { id: 'picard', name: 'Picard', role: 'Solutions Arch', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'jane', room: 0 },
      { id: 'sisko', name: 'Sisko', role: 'Project Planner', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'spock', room: 0 },
      { id: 'troi', name: 'Troi', role: 'Enhancement', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'data', room: 0 },
      { id: 'jane', name: 'Jane', role: 'PM / Triage', model: 'gemini-2.5-flash', status: 'idle', cssClass: 'jane', room: 0 },
      { id: 'spock', name: 'Spock', role: 'Auto-Research', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'spock', room: 1 },
      { id: 'torres', name: 'Torres', role: 'Junior Dev', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'torres', room: 2 },
      { id: 'data', name: 'Data', role: 'Sr. Architect', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'data', room: 2 },
      { id: 'tuvok', name: 'Tuvok', role: 'QA Reviewer', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'tuvok', room: 3 },
      { id: 'crusher', name: 'Crusher', role: 'Docs & Training', model: 'gemini-2.5-flash', status: 'idle', cssClass: 'spock', room: 5 },
      { id: 'obrien', name: "O'Brien", role: 'SRE / Deploy', model: 'gemini-2.5-flash', status: 'idle', cssClass: 'obrien', room: 5 }
    ],
    logs: [],
    workItems: [],
    completedItems: [] // Modules successfully through the pipeline
  };
}

let currentState = getInitialState();

function broadcast() {
  const data = `data: ${JSON.stringify(currentState)}\n\n`;
  for (const client of clients) client.write(data);
}

function addLog(agentId, message) {
  currentState.logs.unshift({
    time: new Date().toLocaleTimeString('en-US', {timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'}),
    agent: agentId || 'system',
    agentLabel: currentState.agents.find(a => a.id === agentId)?.name || 'System',
    message: message
  });
  if (currentState.logs.length > 50) currentState.logs.pop();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runSimulationLoop() {
  if (mockInterval) return;
  currentState = getInitialState();
  mockInterval = true;
  
  const t1 = { id: 'PR-101', name: 'UI Update', color: '#60a5fa' };
  const t2 = { id: 'BUG-40', name: 'Auth Fix', color: '#fb923c' };
  const t3 = { id: 'FEAT-9', name: 'Payments', color: '#c084fc' };
  
  const flow = [
    // Step 1: T1 enters Backlog
    async () => {
      currentState.workItems.push({ ...t1, room: 0 }); // Backlog
      currentState.agents.find(a=>a.id==='jane').status = 'working';
      addLog('jane', `Ingesting ${t1.id} into Backlog.`);
    },
    // Step 2: T1 to Build, T2 enters Backlog
    async () => {
      currentState.workItems.find(w=>w.id===t1.id).room = 2; // Build
      currentState.workItems.push({ ...t2, room: 0 });
      currentState.agents.find(a=>a.id==='torres').room = 2;
      currentState.agents.find(a=>a.id==='torres').status = 'working';
      addLog('torres', `Started dev on ${t1.id}.`);
      addLog('jane', `Triaging new ticket ${t2.id}.`);
    },
    // Step 3: T1 to QA, T2 to Build, T3 enters Backlog
    async () => {
      currentState.workItems.find(w=>w.id===t1.id).room = 3; // QA
      currentState.workItems.find(w=>w.id===t2.id).room = 2; // Build
      currentState.workItems.push({ ...t3, room: 0 });
      currentState.agents.find(a=>a.id==='jane').status = 'idle';
      currentState.agents.find(a=>a.id==='tuvok').status = 'working';
      currentState.agents.find(a=>a.id==='data').room = 2;
      currentState.agents.find(a=>a.id==='data').status = 'working';
      addLog('tuvok', `Testing ${t1.id} logic.`);
      addLog('data', `Jumping in to build ${t2.id}.`);
    },
    // Step 4: T1 to Review, T2 to QA, T3 to Build
    async () => {
      currentState.workItems.find(w=>w.id===t1.id).room = 4; // Review
      currentState.workItems.find(w=>w.id===t2.id).room = 3; // QA
      currentState.workItems.find(w=>w.id===t3.id).room = 2; // Build
      currentState.agents.find(a=>a.id==='data').room = 4; // Data reviews
      addLog('data', `Reviewing ${t1.id} PR.`);
      addLog('tuvok', `Testing ${t2.id} edge cases.`);
      addLog('torres', `Starting ${t3.id} architecture.`);
    },
    // Step 5: T1 to Ship, T2 to Review, T3 to QA
    async () => {
      currentState.workItems.find(w=>w.id===t1.id).room = 5; // Ship
      currentState.workItems.find(w=>w.id===t2.id).room = 4; // Review
      currentState.workItems.find(w=>w.id===t3.id).room = 3; // QA
      currentState.agents.find(a=>a.id==='obrien').status = 'working';
      currentState.agents.find(a=>a.id==='jane').room = 4; // PM reviews
      currentState.agents.find(a=>a.id==='jane').status = 'working';
      addLog('obrien', `Deploying ${t1.id} to production.`);
      addLog('jane', `Reviewing rushed ${t2.id}...`);
      addLog('tuvok', `QA passed for ${t3.id}...`);
    },
    // Step 6: T1 done, T2 to Ship, T3 to Review
    async () => {
      currentState.workItems = currentState.workItems.filter(w=>w.id!==t1.id);
      currentState.completedItems.unshift({ ...t1, status: 'Live', time: new Date().toLocaleTimeString() });
      currentState.workItems.find(w=>w.id===t2.id).room = 5;
      currentState.workItems.find(w=>w.id===t3.id).room = 4;
      currentState.agents.find(a=>a.id==='data').room = 4; // Data reviews t3
      addLog('obrien', `Deploying ${t2.id} to production.`);
      addLog('system', `${t1.id} successfully shipped!`);
    },
    // Step 7: T2 done, T3 to Ship
    async () => {
      currentState.workItems = currentState.workItems.filter(w=>w.id!==t2.id);
      currentState.completedItems.unshift({ ...t2, status: 'Live', time: new Date().toLocaleTimeString() });
      currentState.workItems.find(w=>w.id===t3.id).room = 5;
      currentState.agents.find(a=>a.id==='data').status = 'idle';
      currentState.agents.find(a=>a.id==='jane').status = 'idle';
      currentState.agents.find(a=>a.id==='tuvok').status = 'idle';
      currentState.agents.find(a=>a.id==='torres').status = 'idle';
      addLog('obrien', `Deploying ${t3.id} to production.`);
    },
    // Step 8: Complete
    async () => {
      currentState.workItems = [];
      currentState.completedItems.unshift({ ...t3, status: 'Live', time: new Date().toLocaleTimeString() });
      currentState.agents.forEach(a => a.status = 'idle');
      addLog('system', `All batches deployed. Pipeline clear.`);
    }
  ];

  for (const step of flow) {
    await step();
    broadcast();
    await sleep(4000);
  }

  mockInterval = null;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }

  if (req.url === '/api/telemetry/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(currentState)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Trigger Mock Pipeline
  if (req.url === '/api/telemetry/simulate' && req.method === 'POST') {
    runSimulationLoop(); // async background loop
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Simulation Pipeline Started' }));
    return;
  }

  // 🧠 REAL FACTORY: Pre-Dev Scope Ingestion
  if (req.url === '/api/factory/pre-dev' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
      try {
        const payloadStr = Buffer.concat(body).toString('utf-8');
        const payload = JSON.parse(payloadStr);
        let finalTask = payload.task || '';

        if (payload.projectName && payload.projectName.trim() !== '') {
          finalTask = `PROJECT_NAME: ${payload.projectName.trim()}\n\n` + finalTask;
        }

        // Phase 4 — feature-flagged alternative path: spawn pre_dev_graph.js
        // (real LLM pipeline incl. Genovi intake) instead of the inline
        // template substitution below. Default off; flip PRE_DEV_USE_GRAPH=true
        // in env (or systemd unit) when OpenRouter credit is sufficient for
        // a full pipeline run (~\$0.50-\$2.00 per invocation).
        if (process.env.PRE_DEV_USE_GRAPH === 'true') {
          addLog('system', `🖖 Pre-Dev Pipeline engaged via cognitive-engine graph (real LLM)`);
          broadcast();
          const child = spawn('node', ['/home/subhash.thakur.india/Projects/agentryx-factory/cognitive-engine/pre_dev_graph.js', finalTask], {
            cwd: '/home/subhash.thakur.india/Projects/agentryx-factory/cognitive-engine',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
          });
          child.stdout.on('data', (data) => {
            const line = data.toString().trim();
            if (line) { addLog('system', line.substring(0, 120)); broadcast(); }
          });
          child.stderr.on('data', (data) => {
            const line = data.toString().trim();
            if (line && !line.includes('ExperimentalWarning')) {
              addLog('system', `⚠️ ${line.substring(0, 120)}`);
              broadcast();
            }
          });
          child.on('close', (code) => {
            addLog('system', code === 0 ? '✅ Pre-Dev graph complete (real docs via LLM).' : `❌ Pre-Dev graph exited with code ${code}`);
            broadcast();
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Pre-Dev pipeline engaged via cognitive-engine graph', mode: 'graph' }));
          return;
        }
        // Default path (template substitution) continues below — preserved for
        // credit-constrained operation and instant UI feedback during demos.

        if (payload.files && payload.files.length > 0) {
          addLog('system', `📥 Received ${payload.files.length} supplementary documents. Parsing...`);
          broadcast();
          finalTask += '\n\n--- INGESTED DOCUMENTATION ---\n';
          
          for (const file of payload.files) {
            if (!file.data) continue;
            try {
               const buf = Buffer.from(file.data, 'base64');
               let text = '';
               if (file.name.toLowerCase().endsWith('.pdf')) {
                 const pdfParse = (await import('pdf-parse')).default;
                 const data = await pdfParse(buf);
                 text = data.text;
               } else if (file.name.toLowerCase().endsWith('.docx')) {
                 const mammoth = (await import('mammoth')).default;
                 const data = await mammoth.extractRawText({buffer: buf});
                 text = data.value;
               } else {
                 text = buf.toString('utf-8');
               }
               finalTask += `\n[File: ${file.name}]\n${text}\n`; 
               addLog('system', `📄 Parsed ${file.name} successfully.`);
            } catch(e) { 
               console.error('Parse error:', e); 
               addLog('system', `⚠️ Error parsing ${file.name}: ${e.message}. Using raw text fallback.`);
               // Fallback: try raw text extraction
               try { 
                 const fallbackText = buf.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
                 if (fallbackText.length > 50) {
                   finalTask += `\n[File: ${file.name} (raw)]\n${fallbackText}\n`;
                   addLog('system', `📄 ${file.name} loaded via raw text fallback.`);
                 }
               } catch(e2) { /* truly unrecoverable */ }
            }
          }
        }
        
        if (!finalTask) { res.writeHead(400); res.end(JSON.stringify({ error: 'No task provided' })); return; }
        
        // Write FRS to temp file
        const taskFile = `/tmp/factory_run_${Date.now()}.txt`;
        fs.writeFileSync(taskFile, finalTask);
        
        let displayTask = payload.task || 'Document Upload';
        addLog('system', `🖖 Pre-Dev Pipeline engaged! Scope: "${displayTask.substring(0, 80)}"`);
        broadcast();

        // Determine project directory
        const datePrefix = new Date().toISOString().split('T')[0];
        const projNameRaw = payload.projectName || 'ingested-documentation';
        const safeName = projNameRaw.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
        const projDirName = `${datePrefix}_${safeName}`;
        const base = path.join('/home/subhash.thakur.india/Projects/agent-workspace', projDirName);
        const pmdDir = path.join(base, 'PMD');
        const docsDir = path.join(base, 'docs');
        fs.mkdirSync(pmdDir, { recursive: true });
        fs.mkdirSync(docsDir, { recursive: true });
        fs.mkdirSync(path.join(base, 'src'), { recursive: true });
        fs.mkdirSync(path.join(base, 'tests'), { recursive: true });

        // Generate docs directly using templates + FRS content
        const templateBase = '/home/subhash.thakur.india/Projects/PMD/Agentryx Dev Plan';
        const projectLabel = safeName.replace(/-/g, ' ');
        const frsSnippet = finalTask.substring(0, 2000);

        const loadTemplate = (section, prefix) => {
          try {
            const tplPath = path.join(templateBase, section);
            const files = fs.readdirSync(tplPath);
            const tpl = files.find(f => f.startsWith(prefix));
            if (tpl) {
              let content = fs.readFileSync(path.join(tplPath, tpl), 'utf-8');
              content = content.replace(/\{Project Name\}/gi, projectLabel);
              content = content.replace(/\{Date\}/gi, datePrefix);
              content = content.replace(/\[Insert.*?\]/gi, frsSnippet.substring(0, 500));
              return content;
            }
          } catch(_) {}
          return null;
        };

        addLog('system', '📋 Picard analyzing source document...'); broadcast();

        // A-series (7 docs)
        const aSeries = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
        for (const id of aSeries) {
          let content = loadTemplate('A.Solution Scope', id);
          if (!content) {
            content = `# ${id}: Document — ${projectLabel}\n\n> Generated: ${datePrefix}\n\n## FRS Source\n\`\`\`\n${frsSnippet}\n\`\`\`\n`;
          }
          content += `\n\n---\n## Source FRS Extract\n\`\`\`\n${frsSnippet}\n\`\`\`\n`;
          fs.writeFileSync(path.join(pmdDir, `${id}_${id === 'A0' ? 'Source_Analysis' : id === 'A1' ? 'Solution_Brief' : id === 'A2' ? 'Solution_Architecture' : id === 'A3' ? 'Module_Breakdown' : id === 'A4' ? 'Dev_Plan_Phasing' : id === 'A5' ? 'PRD_Phase1' : 'Acceptance_Criteria'}.md`), content);
          addLog('system', `📄 ${id} generated`); broadcast();
        }

        addLog('system', '🔮 Troi injecting 110% enhancements...'); broadcast();

        // B-series (3 docs: B4, B6, B8)
        for (const id of ['B4', 'B6', 'B8']) {
          let content = loadTemplate('B.Agentryx Edge', id);
          if (!content) {
            content = `# ${id}: Document — ${projectLabel}\n\n> Generated: ${datePrefix}\n`;
          }
          fs.writeFileSync(path.join(docsDir, `${id}_${id === 'B4' ? 'AI_Enhancement_Report' : id === 'B6' ? 'Quick_Wins_110' : 'Infrastructure_Plan'}.md`), content);
          addLog('system', `📄 ${id} generated`); broadcast();
        }

        addLog('system', '🖖 Picard drafting executive summary...'); broadcast();

        // P0 Executive Summary
        let p0Content = loadTemplate('P.Project Management', 'P0');
        if (!p0Content) p0Content = `# P0: Executive Summary — ${projectLabel}\n\n> Generated: ${datePrefix}\n`;
        fs.writeFileSync(path.join(docsDir, 'P0_Executive_Summary.md'), p0Content);
        addLog('system', '📄 P0 generated'); broadcast();

        // AGENT_STATE
        fs.writeFileSync(path.join(base, 'AGENT_STATE.md'), `# AGENT_STATE — ${projectLabel}\n\n## IDENTITY\n\`\`\`yaml\nproject_name: "${projectLabel}"\nworkspace: "${projDirName}"\ncreated: "${datePrefix}"\n\`\`\`\n\n## CURRENT STATE\n\`\`\`yaml\nstatus: "Pre-Dev Complete"\noverall_completion: "15%"\ncurrent_phase: 0\nphases_total: 3\n\`\`\`\n\n## COMPLETED\n\`\`\`yaml\ndocuments: [A0, A1, A2, A3, A4, A5, A6, B4, B6, B8, P0, AGENT_STATE]\n\`\`\`\n\n## FRS SOURCE\n\`\`\`\n${frsSnippet}\n\`\`\`\n`);
        addLog('system', '📄 AGENT_STATE initialized'); broadcast();

        addLog('system', `✅ Pre-Dev complete! 12 documents generated in ${projDirName}`);
        broadcast();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Pre-Dev pipeline complete', project: projDirName }));
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 🧠 REAL FACTORY: Dev Pipeline (Jane to O'Brien)
  if (req.url === '/api/factory/dev' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { project } = JSON.parse(body);
        if (!project) { res.writeHead(400); res.end(JSON.stringify({ error: 'No project provided' })); return; }
        
        // Spawn dev_graph.js with the project name
        const child = spawn('node', ['/home/subhash.thakur.india/Projects/agentryx-factory/cognitive-engine/dev_graph.js', project], {
          cwd: '/home/subhash.thakur.india/Projects/cognitive-engine',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env }
        });
        
        addLog('system', `🏭 Dev floor engaged! Project: "${project}"`);
        broadcast();
        
        child.stdout.on('data', (data) => {
          const line = data.toString().trim();
          if (line) { addLog('system', line.substring(0, 120)); broadcast(); }
        });
        child.stderr.on('data', (data) => {
          const line = data.toString().trim();
          if (line && !line.includes('ExperimentalWarning')) {
            addLog('system', `⚠️ ${line.substring(0, 120)}`);
            broadcast();
          }
        });
        child.on('close', (code) => {
          addLog('system', code === 0 ? '✅ Dev complete. App deployed.' : `❌ Dev exited with code ${code}`);
          broadcast();
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Dev pipeline spawned' }));
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Save Config from UI
  // 🚀 POST-DEV: Ship & Deliver Pipeline (Crusher + Jane + O'Brien)
  if (req.url === '/api/factory/post-dev' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { project } = JSON.parse(body);
        if (!project) { res.writeHead(400); res.end(JSON.stringify({ error: 'No project provided' })); return; }
        
        const child = spawn('node', ['/home/subhash.thakur.india/Projects/agentryx-factory/cognitive-engine/post_dev_graph.js', project], {
          cwd: '/home/subhash.thakur.india/Projects/cognitive-engine',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env }
        });
        
        addLog('system', `🚀 Post-Dev pipeline engaged! Project: "${project}"`);
        broadcast();
        
        child.stdout.on('data', (data) => {
          const line = data.toString().trim();
          if (line) { addLog('system', line.substring(0, 120)); broadcast(); }
        });
        child.stderr.on('data', (data) => {
          const line = data.toString().trim();
          if (line && !line.includes('ExperimentalWarning')) {
            addLog('system', `⚠️ ${line.substring(0, 120)}`);
            broadcast();
          }
        });
        child.on('close', (code) => {
          addLog('system', code === 0 ? '🎉 Post-Dev complete. Project SHIPPED.' : `❌ Post-Dev exited with code ${code}`);
          broadcast();
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Post-Dev pipeline spawned' }));
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Save Config from UI
  if (req.url === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        let envContent = '';
        if (config.github) envContent += `GITHUB_PAT=${config.github}\n`;
        if (config.perplexity) envContent += `PERPLEXITY_API_KEY=${config.perplexity}\n`;
        if (config.whatsappWebhook) envContent += `WHATSAPP_WEBHOOK=${config.whatsappWebhook}\n`;
        
        fs.writeFileSync(path.join(process.cwd(), '.env.factory'), envContent);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    }); return;
  }

  // Test Connectivity API
  if (req.url === '/api/test-connection' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const config = JSON.parse(body);
        let githubStatus = 'untested';
        let perplexityStatus = 'untested';

        if (config.github) {
          try {
            const ghRes = await fetch('https://api.github.com/user', {
              headers: { 'Authorization': `token ${config.github}`, 'User-Agent': 'Agentryx-Factory' }
            });
            githubStatus = ghRes.ok ? 'success' : 'error';
          } catch(e) { githubStatus = 'error'; }
        }

        if (config.perplexity) {
          try {
            const pRes = await fetch('https://api.perplexity.ai/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${config.perplexity}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'sonar', messages: [{role: 'user', content: 'test'}] })
            });
            perplexityStatus = pRes.ok ? 'success' : 'error';
          } catch(e) { perplexityStatus = 'error'; }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ github: githubStatus, perplexity: perplexityStatus }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
    }); return;
  }

  // Remote agent states + workItem management
  if (req.url === '/api/telemetry/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        
        // Agent state updates
        if (update.agentId) {
            const agent = currentState.agents.find(a => a.id === update.agentId);
            if (agent) {
                if (update.room !== undefined) agent.room = update.room;
                if (update.status !== undefined) agent.status = update.status;
            }
        }
        
        // WorkItem lifecycle
        if (update.workItem) {
          const wi = update.workItem;
          if (wi.action === 'create') {
            currentState.workItems.push({ id: wi.id, name: wi.name, room: wi.room || 0, color: wi.color || '#60a5fa' });
          } else if (wi.action === 'move') {
            const item = currentState.workItems.find(w => w.id === wi.id);
            if (item) item.room = wi.room;
          } else if (wi.action === 'complete') {
            currentState.workItems = currentState.workItems.filter(w => w.id !== wi.id);
            currentState.completedItems.unshift({ id: wi.id, name: wi.name, color: wi.color || '#60a5fa', status: 'Live', time: new Date().toLocaleTimeString() });
          }
        }
        
        if (update.log) addLog(update.agentId, update.log);
        broadcast();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    }); return;
  }

  // Template count — reads the Agentryx Dev Plan directory for doc counts
  if (req.url === '/api/workspace/template-count' && req.method === 'GET') {
    try {
      const pmdBase = '/home/subhash.thakur.india/Projects/PMD/Agentryx Dev Plan';
      const countDir = (dir) => { try { return fs.readdirSync(path.join(pmdBase, dir)).filter(f => f.endsWith('.md') || f.endsWith('.json')).length; } catch(_) { return 0; } };
      const a = countDir('A.Solution Scope');
      const b = countDir('B.Agentryx Edge');
      const c = countDir('C.Project Delivery');
      const p = countDir('P.Project Management');
      const hasState = (() => { try { fs.accessSync(path.join(pmdBase, 'AGENT_STATE_TEMPLATE.md')); return 1; } catch(_) { return 0; } })();
      // Pre-Dev generates: A0-A6 (7) + B4,B6 (2) + B8 (1) + P0 (1) + AGENT_STATE (1) = 12
      const preDev = a + 2 + 1 + 1 + hasState; // A-series + Troi(B4,B6) + O'Brien(B8) + Picard(P0) + Jane(AGENT_STATE)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: preDev, total: a + b + c + p + hasState, preDev, a, b, c, p }));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: 12 })); // fallback
    }
    return;
  }

  // List all projects in workspace
  if (req.url === '/api/workspace/projects' && req.method === 'GET') {
    const agentWs = '/home/subhash.thakur.india/Projects/agent-workspace';
    try {
      const entries = fs.readdirSync(agentWs, { withFileTypes: true });
      const projects = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => {
          const projPath = path.join(agentWs, e.name);
          const stat = fs.statSync(projPath);
          const reportPath = path.join(projPath, 'B7_Factory_Report.json');
          let report = null;
          try { report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')); } catch(_) {}
          let completion = '0%';
          try {
            const stateContent = fs.readFileSync(path.join(projPath, 'AGENT_STATE.md'), 'utf-8');
            const match = stateContent.match(/overall_completion:\s*"?([^"\n]+)"?/);
            if (match) completion = match[1];
          } catch(_) {}
          // Count files recursively
          function countFiles(dir) {
            let count = 0;
            try {
              const items = fs.readdirSync(dir, { withFileTypes: true });
              for (const item of items) {
                if (item.name.startsWith('.') || item.name === 'node_modules') continue;
                if (item.isFile()) count++;
                else count += countFiles(path.join(dir, item.name));
              }
            } catch(_) {}
            return count;
          }
          return {
            name: e.name,
            created: stat.birthtime,
            modified: stat.mtime,
            fileCount: countFiles(projPath),
            status: report ? (report.qaVerdict || 'unknown') : (countFiles(projPath) < 3 ? 'generating-scope' : 'ready-for-dev'),
            hasReport: !!report,
            completion: completion
          };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ projects }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ projects: [] }));
    }
    return;
  }

  // Delete a specific project
  const deleteMatch = req.url?.match(/^\/api\/workspace\/delete\?project=(.+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const project = decodeURIComponent(deleteMatch[1]);
    const projPath = path.join('/home/subhash.thakur.india/Projects/agent-workspace', project);
    try {
      fs.rmSync(projPath, { recursive: true, force: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // List files within a specific project (recursive tree)
  const filesMatch = req.url?.match(/^\/api\/workspace\/files\?project=(.+)$/);
  if (filesMatch && req.method === 'GET') {
    const project = decodeURIComponent(filesMatch[1]);
    const projPath = path.join('/home/subhash.thakur.india/Projects/agent-workspace', project);
    try {
      function buildTree(dir, prefix = '') {
        const items = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          const relPath = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) {
            items.push({ name: e.name, path: relPath, type: 'dir', children: buildTree(path.join(dir, e.name), relPath) });
          } else {
            const stat = fs.statSync(path.join(dir, e.name));
            items.push({ name: e.name, path: relPath, type: 'file', size: stat.size });
          }
        }
        return items;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ project, tree: buildTree(projPath) }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ project, tree: [] }));
    }
    return;
  }

  // Read a specific file from a project
  if (req.url?.startsWith('/api/workspace/read?') && req.method === 'GET') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const project = params.get('project');
    const file = params.get('file');
    if (!project || !file) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing project or file' })); return; }
    const filePath = path.join('/home/subhash.thakur.india/Projects/agent-workspace', project, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ file, content }));
    } catch (err) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'File not found' }));
    }
    return;
  }

  // Run a file or npm command within a project
  if (req.url === '/api/workspace/run' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { project, command, background } = JSON.parse(body);
        const projPath = path.join('/home/subhash.thakur.india/Projects/agent-workspace', project || '');
        const cmd = command || 'npm start';
        
        if (background) {
            // Kill any previously running preview process on 8888
            try { execSync('lsof -ti:8888 | xargs kill -9 2>/dev/null || true'); } catch(e){}
            const bgChild = spawn('bash', ['-c', `PORT=8888 ${cmd}`], { cwd: projPath, detached: true, stdio: 'ignore' });
            bgChild.unref();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Preview server started on background port 8888', url: '/preview/' }));
            return;
        }

        const child = spawn('bash', ['-c', cmd], { cwd: projPath, timeout: 15000 });
        let output = '';
        child.stdout.on('data', d => output += d.toString());
        child.stderr.on('data', d => output += d.toString());
        child.on('close', (code) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ exitCode: code, output }));
        });
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    }); return;
  }

  // ─── Phase 12-B Tier B (Admin) — flags / configs / audit / modules / queue / cost ─────
  // All routes namespaced /api/factory-admin/* (frontend hits via /telemetry/factory-admin/*).
  // Distinct from the existing /admin/api/* on port 4402 (the Phase 2.5 Key Console),
  // distinct from the architect routes. Read-only for v1 except flag toggles.

  if (req.url === '/api/factory-admin/flags' && req.method === 'GET') {
    (async () => {
      try {
        const { snapshotAllFlags } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'feature-flags.js')).href);
        applyFlagOverrides(); // ensure process.env reflects persisted overrides
        const snap = snapshotAllFlags();
        const overrides = loadFlagOverrides();
        // augment with override-source metadata so the UI can show "set via UI" vs "default"
        return jsonResponse(res, 200, {
          flags: snap.map(s => ({ ...s, override_source: overrides[s.flag.env_var] ? 'ui' : null })),
          overrides_path: FLAG_OVERRIDES_FILE,
        });
      } catch (err) {
        console.error('[factory-admin/flags GET]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.match(/^\/api\/factory-admin\/flags\/([^/]+)\/toggle$/) && req.method === 'POST') {
    (async () => {
      try {
        const envVar = req.url.match(/^\/api\/factory-admin\/flags\/([^/]+)\/toggle$/)[1];
        const body = await readRequestBody(req);
        const targetState = body.to === 'on' ? 'on' : body.to === 'off' ? 'off' : null;
        if (!targetState) return jsonResponse(res, 400, { error: 'body.to must be "on" or "off"' });

        const { isKnownFlag, readFlag } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'feature-flags.js')).href);
        if (!isKnownFlag(envVar)) return jsonResponse(res, 404, { error: `unknown flag: ${envVar}` });

        // Persist override + apply to running process
        const overrides = loadFlagOverrides();
        overrides[envVar] = targetState;
        saveFlagOverrides(overrides);
        process.env[envVar] = targetState === 'on' ? 'true' : 'false';

        // Best-effort audit (lib append; non-blocking)
        try {
          const { appendAudit } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'audit.js')).href);
          await appendAudit({
            actor: body.actor || 'founder',
            action: 'flag.toggle',
            target: envVar,
            details: { to: targetState, prior: readFlag(envVar) },
          });
        } catch {}

        addLog('system', `🚦 Flag ${envVar} → ${targetState}`);
        broadcast();
        return jsonResponse(res, 200, { env_var: envVar, effective: targetState, persisted: true });
      } catch (err) {
        console.error('[factory-admin/flags toggle]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/factory-admin/configs' && req.method === 'GET') {
    (async () => {
      try {
        const { CONFIG_ENTRIES } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'registry.js')).href);
        const { snapshotConfig } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'config-store.js')).href);
        const out = [];
        for (const entry of CONFIG_ENTRIES) {
          let value = null;
          try { value = await snapshotConfig(entry.id); } catch {}
          out.push({ entry, value });
        }
        return jsonResponse(res, 200, { configs: out });
      } catch (err) {
        console.error('[factory-admin/configs]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.startsWith('/api/factory-admin/audit') && req.method === 'GET') {
    (async () => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const { readAudit } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'audit.js')).href);
        const entries = await readAudit({
          actor: url.searchParams.get('actor') || undefined,
          action: url.searchParams.get('action') || undefined,
          target: url.searchParams.get('target') || undefined,
          limit: Number(url.searchParams.get('limit')) || 100,
        });
        return jsonResponse(res, 200, { entries });
      } catch (err) {
        console.error('[factory-admin/audit]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/factory-admin/modules' && req.method === 'GET') {
    (async () => {
      try {
        const { createMarketplaceStore } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'marketplace', 'store.js')).href);
        const store = createMarketplaceStore(REPO_ROOT);
        // store may need to be initialized; built-ins live in the registry
        const list = typeof store.list === 'function' ? store.list() : [];
        const stats = typeof store.stats === 'function' ? store.stats() : null;
        // If the store is empty (built-ins haven't been registered in this telemetry process),
        // surface the catalogue manifests directly so the UI isn't blank.
        let modules = list;
        if (!modules.length) {
          try {
            const { BUILTIN_MANIFESTS } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'marketplace', 'catalogue.js')).href);
            modules = BUILTIN_MANIFESTS.map(m => ({ ...m, status: 'catalogued' }));
          } catch (e) { console.warn('[factory-admin/modules] catalogue fallback failed:', e?.message); }
        }
        return jsonResponse(res, 200, { modules, stats });
      } catch (err) {
        console.error('[factory-admin/modules]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/factory-admin/queue' && req.method === 'GET') {
    (async () => {
      try {
        const { createQueue } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'queue.js')).href);
        const queue = createQueue(REPO_ROOT);
        const [stats, queued, inFlight] = await Promise.all([
          queue.stats(),
          queue.listQueued(),
          queue.listInFlight(),
        ]);
        return jsonResponse(res, 200, { stats, queued, in_flight: inFlight });
      } catch (err) {
        console.error('[factory-admin/queue]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.startsWith('/api/factory-admin/cost') && req.method === 'GET') {
    (async () => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const { getRollup } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'cost-tracker', 'service.js')).href);
        const since = url.searchParams.get('since') || undefined;
        const until = url.searchParams.get('until') || undefined;
        const rollup = await getRollup({
          workspace_root: REPO_ROOT,
          since,
          until,
        }, { source: 'artifacts' });
        return jsonResponse(res, 200, { rollup, period: { since, until } });
      } catch (err) {
        console.error('[factory-admin/cost]', err);
        // Cost-tracker may have no data yet — return an empty rollup rather than 500
        return jsonResponse(res, 200, { rollup: null, error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Phase 21-A: Master Architect ─────────────────────────────────────
  // All routes are namespaced under /api/architect/* and read/write the
  // factory's KB at <repo>/_kb/. The architect ships with a stub
  // dispatcher (= $0 cost), so "Run a pass" is safe to invoke from the UI.

  if (req.url === '/api/architect/state' && req.method === 'GET') {
    (async () => {
      try {
        const { createKnowledgeBase, createProposalStore } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const store = createProposalStore(ARCHITECT_KB_ROOT);
        const [standing_orders, summary, passes, findings, allProposals, briefs, reports, unreadCount] = await Promise.all([
          kb.readStandingOrders(),
          kb.summary(),
          kb.listPasses({ limit: 5 }),
          kb.listFindings({ limit: 30 }),
          store.list(),
          kb.listBriefs({ limit: 30 }),
          kb.listReports({ limit: 30 }),
          kb.unreadReportCount(),
        ]);
        // Architect-owned proposal kinds only — keep the surface focused
        const ARCH_KINDS = new Set(['tool_adoption', 'kb_update', 'research_finding']);
        const proposals = allProposals
          .filter(p => ARCH_KINDS.has(p.kind))
          .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
          .slice(0, 25);
        return jsonResponse(res, 200, {
          standing_orders,
          summary,
          passes,
          findings,
          proposals,
          briefs,
          reports,
          unread_report_count: unreadCount,
          paused: standing_orders?.baseline?.paused === true,
          kb_root: ARCHITECT_KB_ROOT,
          has_seed: fs.existsSync(SEED_JSON_PATH),
        });
      } catch (err) {
        console.error('[architect/state]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/architect/seed' && req.method === 'POST') {
    (async () => {
      try {
        if (!fs.existsSync(SEED_JSON_PATH)) {
          return jsonResponse(res, 404, { error: `seed not found: ${SEED_JSON_PATH}` });
        }
        const seed = JSON.parse(fs.readFileSync(SEED_JSON_PATH, 'utf-8'));
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const existing = await kb.readStandingOrders();
        if (existing) {
          return jsonResponse(res, 409, {
            error: 'Standing Orders already exist; refusing to overwrite. Edit _kb/standing_orders.json directly or delete it first.',
          });
        }
        await kb.writeStandingOrders(seed);
        addLog('system', '👑 Architect: Standing Orders seeded from example (v1).');
        broadcast();
        return jsonResponse(res, 200, { success: true, seeded: true, version: seed.version });
      } catch (err) {
        console.error('[architect/seed]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/architect/standing_orders' && req.method === 'POST') {
    // Founder save from the Standing Orders editor. Body shape:
    //   { standing_orders: <partial-or-full SO>, bump_version?: boolean }
    // The handler MERGES the incoming object onto whatever is on disk
    // (so the editor can ship without exposing every field), then writes
    // via kb.writeStandingOrders which validates + appends history.
    (async () => {
      try {
        const body = await readRequestBody(req);
        const incoming = body.standing_orders;
        if (!incoming || typeof incoming !== 'object') {
          return jsonResponse(res, 400, { error: 'standing_orders object required in body' });
        }
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const existing = (await kb.readStandingOrders()) || {};

        // Deep-merge custom_direction so the editor can omit arrays it
        // doesn't expose (hard_constraints, anti_goals, etc.) without
        // wiping them. Priority areas are merged by id.
        const merged = {
          ...existing,
          ...incoming,
          baseline: { ...(existing.baseline || {}), ...(incoming.baseline || {}) },
          custom_direction: mergeCustomDirection(existing.custom_direction, incoming.custom_direction),
        };

        // Bump version unless caller opted out (default: bump on every save
        // so the architect's version-watermark detector picks it up).
        if (body.bump_version !== false) {
          merged.version = Number(existing.version || 0) + 1;
        } else if (typeof merged.version !== 'number') {
          merged.version = Number(existing.version || 1);
        }

        const written = await kb.writeStandingOrders(merged);
        addLog('system', `👑 Architect: Standing Orders saved (v${written.version}).`);
        broadcast();
        return jsonResponse(res, 200, { success: true, version: written.version, standing_orders: written });
      } catch (err) {
        console.error('[architect/standing_orders POST]', err);
        return jsonResponse(res, 400, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/architect/run_pass' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readRequestBody(req);
        const passKind = body.passKind || 'manual';
        const {
          createKnowledgeBase, createResearcher, createStubDispatcher,
          createArchitectProposer, createArchitect, createProposalStore,
        } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const so = await kb.readStandingOrders();
        if (!so) {
          return jsonResponse(res, 412, {
            error: 'No Standing Orders configured. Click "Seed from example" first, or write _kb/standing_orders.json directly.',
          });
        }
        const proposalStore = createProposalStore(ARCHITECT_KB_ROOT);
        const proposer = createArchitectProposer({ proposalStore, kb });
        const researcher = createResearcher({
          dispatchSubagent: createStubDispatcher(),
          budget_usd_per_pass: so.baseline?.daily_budget_usd ?? 1.5,
        });
        const architect = createArchitect({ kb, researcher, proposer });

        addLog('system', `👑 Architect: launching ${passKind} research pass (stub dispatcher, $0)…`);
        broadcast();
        const result = await architect.runPass(passKind);
        const findingsCount = result.findings_count ?? 0;
        const proposalsCount = result.proposals_count ?? 0;
        addLog(
          'system',
          `👑 Architect: pass ${result.pass?.id || ''} done — ${findingsCount} findings, ${proposalsCount} proposals.`,
        );
        broadcast();
        return jsonResponse(res, 200, result);
      } catch (err) {
        console.error('[architect/run_pass]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Pause / resume the cadence daemon (writes baseline.paused) ───────
  if ((req.url === '/api/architect/pause' || req.url === '/api/architect/resume') && req.method === 'POST') {
    (async () => {
      try {
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const so = await kb.readStandingOrders();
        if (!so) return jsonResponse(res, 412, { error: 'no Standing Orders configured' });
        const paused = req.url.endsWith('pause');
        const merged = { ...so, baseline: { ...(so.baseline || {}), paused } };
        merged.version = Number(so.version || 0) + 1;
        const written = await kb.writeStandingOrders(merged);
        addLog('system', `👑 Architect ${paused ? 'paused' : 'resumed'} (v${written.version}).`);
        broadcast();
        return jsonResponse(res, 200, { success: true, paused, version: written.version });
      } catch (err) {
        console.error('[architect/pause-resume]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Briefs (Founder R&D Brief tab) ───────────────────────────────────
  if (req.url === '/api/architect/brief' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readRequestBody(req);
        const A = await loadArchitect();
        const kb = A.createKnowledgeBase(ARCHITECT_KB_ROOT);
        const proposalStore = A.createProposalStore(ARCHITECT_KB_ROOT);
        const proposer = A.createArchitectProposer({ proposalStore, kb });
        const researcher = A.createResearcher({
          dispatchSubagent: A.createStubDispatcher(),
          budget_usd_per_pass: body.budget_usd || 3,
        });
        const architect = A.createArchitect({ kb, researcher, proposer });

        addLog('system', `🔬 Architect: brief submitted — "${(body.title || '').slice(0, 60)}"`);
        broadcast();

        const out = await A.runBrief({ kb, architect, briefInput: body });
        addLog('system', `🔬 Architect: brief ${out.brief.id} done · ${out.report?.id || 'no report'}`);
        broadcast();
        return jsonResponse(res, 200, out);
      } catch (err) {
        console.error('[architect/brief POST]', err);
        return jsonResponse(res, 400, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.startsWith('/api/architect/briefs') && req.method === 'GET') {
    (async () => {
      try {
        const m = req.url.match(/^\/api\/architect\/briefs(?:\/([^/?]+))?(?:\?.*)?$/);
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        if (m && m[1]) {
          const b = await kb.readBrief(m[1]);
          if (!b) return jsonResponse(res, 404, { error: 'brief not found' });
          return jsonResponse(res, 200, b);
        }
        const briefs = await kb.listBriefs({ limit: 50 });
        return jsonResponse(res, 200, { briefs });
      } catch (err) {
        console.error('[architect/briefs]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Reports (cycle reports + brief reports) ──────────────────────────
  if (req.url?.startsWith('/api/architect/reports') && req.method === 'GET') {
    (async () => {
      try {
        const m = req.url.match(/^\/api\/architect\/reports(?:\/([^/?]+))?(?:\?.*)?$/);
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        if (m && m[1]) {
          const r = await kb.readReport(m[1]);
          if (!r) return jsonResponse(res, 404, { error: 'report not found' });
          return jsonResponse(res, 200, r);
        }
        // List
        const url = new URL(req.url, 'http://localhost');
        const reports = await kb.listReports({
          limit: Number(url.searchParams.get('limit')) || 30,
          kind: url.searchParams.get('kind') || undefined,
          cadence: url.searchParams.get('cadence') || undefined,
          unread_only: url.searchParams.get('unread_only') === 'true',
        });
        const unreadCount = await kb.unreadReportCount();
        return jsonResponse(res, 200, { reports, unread_count: unreadCount });
      } catch (err) {
        console.error('[architect/reports]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.match(/^\/api\/architect\/reports\/([^/]+)\/read$/) && req.method === 'POST') {
    (async () => {
      try {
        const id = req.url.match(/^\/api\/architect\/reports\/([^/]+)\/read$/)[1];
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const updated = await kb.markReportRead(id);
        if (!updated) return jsonResponse(res, 404, { error: 'report not found' });
        return jsonResponse(res, 200, updated);
      } catch (err) {
        console.error('[architect/reports/read]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Manual cadence run (for "Run a [weekly] now" buttons in the UI) ──
  if (req.url?.match(/^\/api\/architect\/cadence\/(daily|weekly|monthly)\/run$/) && req.method === 'POST') {
    (async () => {
      try {
        const cadenceKind = req.url.match(/^\/api\/architect\/cadence\/(daily|weekly|monthly)\/run$/)[1];
        await bootCadenceDaemon(); // ensure handler exists
        if (!cadenceDaemonHandle) return jsonResponse(res, 500, { error: 'daemon failed to boot' });
        // Manually invoke the same code path as a scheduled tick — but force
        // the cadence regardless of clock. We do this by calling runCadencePass
        // through a fresh architect setup, mirroring what the daemon would do.
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const so = await kb.readStandingOrders();
        if (!so) return jsonResponse(res, 412, { error: 'no Standing Orders configured' });
        const cfg = so.baseline?.cadences?.[cadenceKind] || { budget_usd: 1.5, report_enabled: true };
        // Reuse the daemon's runCadencePass via a public hook. We exposed it
        // through a tiny adapter on the closure earlier — call it via a fresh
        // architect setup here for simplicity.
        const A = await loadArchitect();
        const proposalStore = A.createProposalStore(ARCHITECT_KB_ROOT);
        const proposer = A.createArchitectProposer({ proposalStore, kb });
        const researcher = A.createResearcher({
          dispatchSubagent: A.createStubDispatcher(),
          budget_usd_per_pass: cfg.budget_usd ?? 1.5,
        });
        const architect = A.createArchitect({ kb, researcher, proposer });
        const result = await architect.runPass(cadenceKind);
        await kb.recordCadenceFire(cadenceKind, result.pass?.id);
        let report = null;
        if (cfg.report_enabled !== false) {
          const findings = await kb.listFindings({ pass_id: result.pass?.id, limit: 200 });
          report = await kb.writeReport({
            kind: "cycle",
            cadence: cadenceKind,
            pass_id: result.pass?.id,
            title: `${cadenceKind[0].toUpperCase()}${cadenceKind.slice(1)} cycle — ${new Date().toISOString().slice(0,10)}`,
            summary: `Architect ${cadenceKind} cycle: ${result.findings_count ?? 0} findings, ${result.proposals_count ?? 0} proposals.`,
            sections: [
              { heading: "Summary", kind: "narrative", body: `Manually-triggered ${cadenceKind} cycle. ${result.findings_count ?? 0} findings, ${result.proposals_count ?? 0} proposals. ${result.cost_usd === 0 ? '_(stub dispatcher — synthetic.)_' : ''}` },
              { heading: "Findings", kind: "list", body: findings.map(f => `- **[${f.priority_area || 'untagged'}]** ${f.content || '(no content)'}`).join("\n") || "_(none)_" },
            ],
            linked_findings: findings.map(f => f.id),
            cost_usd: result.cost_usd ?? 0,
          });
        }
        addLog('system', `👑 Architect manual ${cadenceKind} cycle done${report ? ` (report ${report.id})` : ''}`);
        broadcast();
        return jsonResponse(res, 200, { pass: result.pass, report });
      } catch (err) {
        console.error('[architect/cadence/run]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.startsWith('/api/architect/proposal/') && req.method === 'POST') {
    // /api/architect/proposal/:id/:action  where action is approve|reject
    (async () => {
      try {
        const m = req.url.match(/^\/api\/architect\/proposal\/([^/]+)\/(approve|reject)$/);
        if (!m) return jsonResponse(res, 400, { error: 'expected /proposal/:id/:action' });
        const [, id, action] = m;
        const body = await readRequestBody(req);
        const { createProposalStore } = await loadArchitect();
        const store = createProposalStore(ARCHITECT_KB_ROOT);
        const reviewer = body.reviewer || 'founder';
        const note = body.note;
        let updated;
        if (action === 'reject') {
          // reject is allowed from any non-terminal state
          updated = await store.reject(id, { reviewer, note });
        } else {
          // The architect ships proposals in `draft`. Per Phase 21-A design
          // (D190 + README), research_finding and kb_update fast-track since
          // they're low-stakes / informational; tool_adoption is the only
          // founder-gated kind. Walk the chain explicitly so the audit log
          // captures every transition.
          const proposal = await store.get(id);
          if (!proposal) return jsonResponse(res, 404, { error: `proposal ${id} not found` });
          const chain = ['evaluating', 'ready', 'approved'];
          let cur = proposal;
          for (const next of chain) {
            if (cur.state === next) continue;
            if (cur.state === 'approved') break;
            cur = await store.transition(id, next, { actor: reviewer, note });
          }
          updated = cur;
        }
        addLog('system', `👑 Architect: proposal ${id} ${action}d.`);
        broadcast();
        return jsonResponse(res, 200, updated);
      } catch (err) {
        console.error('[architect/proposal]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Telemetry running on :${PORT}`);
  // Phase 21-A.1 — boot the architect cadence daemon. Failures are
  // logged but don't crash the telemetry server (architect is optional).
  bootCadenceDaemon().catch(err => console.error('[architect.daemon] boot error:', err));
});
