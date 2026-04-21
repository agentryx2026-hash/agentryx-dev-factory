import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = 4401;
const clients = new Set();
let mockInterval = null;

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

  res.writeHead(404); res.end();
});

server.listen(PORT, '0.0.0.0', () => console.log(`📡 Telemetry running on :${PORT}`));
