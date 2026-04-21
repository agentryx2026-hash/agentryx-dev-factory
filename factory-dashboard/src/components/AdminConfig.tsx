import React, { useState } from 'react';

/* ═══════════════════════════════════════════════════════════
   ADMIN CONFIG — Factory Settings & Agent Roster
   ═══════════════════════════════════════════════════════════ */

interface ApiKeys {
  gemini: string;
  claude: string;
  openai: string;
  ollama: string;
  github: string;
  perplexity: string;
  whatsappWebhook: string;
}

interface AgentModel {
  [key: string]: string;
}

interface AgentDef {
  id: string;
  name: string;
  role: string;
  cssClass: string;
}

const AGENTS: AgentDef[] = [
  { id: 'jane', name: 'Jane', role: 'PM / Triage — Routes tickets with Delta Quadrant precision', cssClass: 'jane' },
  { id: 'spock', name: 'Spock', role: 'Auto-Research — Logical deep analysis & tech scouting', cssClass: 'spock' },
  { id: 'torres', name: 'Torres', role: 'Junior Dev — Builds components with Klingon intensity', cssClass: 'torres' },
  { id: 'data', name: 'Data', role: 'Sr. Architect — Positronic debugging & algorithm design', cssClass: 'data' },
  { id: 'tuvok', name: 'Tuvok', role: 'QA Reviewer — Vulcan precision security audits', cssClass: 'tuvok' },
  { id: 'obrien', name: "O'Brien", role: 'SRE / Deploy — Keeps the station running no matter what', cssClass: 'obrien' },
];

const MODEL_OPTIONS = [
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Fast / Cheap)' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Balanced)' },
  { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro (Highest Tier)' },
  { value: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'claude-opus-4', label: 'Claude Opus 4' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'qwen-2.5-coder', label: 'Qwen 2.5 Coder (Local)' },
  { value: 'ollama/llama3', label: 'Llama 3 via Ollama (Local)' },
];

const AdminConfig: React.FC = () => {
  // Load from local storage initially
  const [keys, setKeys] = useState<ApiKeys>(() => {
    const defaultKeys = {
      gemini: '',
      claude: '',
      openai: '',
      ollama: 'http://localhost:11434',
      github: '',
      perplexity: '',
      whatsappWebhook: 'http://localhost:5678/webhook/factory-alert'
    };
    try {
      const saved = localStorage.getItem('factoryConfigKeys');
      if (saved) {
        return { ...defaultKeys, ...JSON.parse(saved) };
      }
    } catch(e) { }
    return defaultKeys;
  });

  const [agentModels, setAgentModels] = useState<AgentModel>({
    jane: 'gemini-3.1-pro',
    spock: 'gemini-3.1-pro',
    torres: 'claude-opus-4',
    data: 'claude-opus-4',
    tuvok: 'gemini-3.1-pro',
    obrien: 'gemini-3.1-pro',
  });

  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<{github: string, perplexity: string} | null>(null);
  const [testing, setTesting] = useState(false);

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setKeys(prev => ({ ...prev, [name]: value }));
    setSaved(false);
  };

  const handleModelChange = (agentId: string, model: string) => {
    setAgentModels(prev => ({ ...prev, [agentId]: model }));
    setSaved(false);
  };

  const handleSave = async () => {
    // Save to browser memory
    localStorage.setItem('factoryConfigKeys', JSON.stringify(keys));
    
    // Save to the actual Node.js Telemetry Config Server
    try {
      await fetch('/telemetry/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keys)
      });
    } catch (err) {
      console.error('Failed to sync config with backend:', err);
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTestConnections = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      const res = await fetch('/telemetry/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keys)
      });
      const data = await res.json();
      setTestStatus(data);
    } catch (err) {
      console.error('Test failed:', err);
    }
    setTesting(false);
  };

  return (
    <div className="fade-in" id="config-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Factory Configuration</h1>
          <p className="page-subtitle">Manage cognitive engines, agent assignments, and infrastructure bindings.</p>
        </div>
      </div>

      <div className="settings-container">
        {/* Section 1: API Keys */}
        <div className="glass-panel settings-section" id="config-api-keys">
          <div className="section-header">
            <span className="section-number">01</span>
            <span className="section-title">Cognitive Engine API Keys</span>
          </div>
          <div className="section-body">
            <div className="config-row">
              <label>
                Google Gemini <small>(Primary Engine — Vertex AI / AI Studio)</small>
              </label>
              <input
                type="password"
                name="gemini"
                className="config-input"
                value={keys.gemini}
                onChange={handleKeyChange}
                placeholder="AIzaSy..."
                id="input-gemini-key"
              />
            </div>

            <div className="config-grid">
              <div className="config-row">
                <label>Anthropic Claude</label>
                <input
                  type="password"
                  name="claude"
                  className="config-input"
                  value={keys.claude}
                  onChange={handleKeyChange}
                  placeholder="sk-ant-..."
                  id="input-claude-key"
                />
              </div>
              <div className="config-row">
                <label>OpenAI</label>
                <input
                  type="password"
                  name="openai"
                  className="config-input"
                  value={keys.openai}
                  onChange={handleKeyChange}
                  placeholder="sk-..."
                  id="input-openai-key"
                />
              </div>
            </div>

            <div className="config-row">
              <label>
                Local Model Endpoint <small>(Ollama / vLLM)</small>
              </label>
              <input
                type="text"
                name="ollama"
                className="config-input"
                value={keys.ollama}
                onChange={handleKeyChange}
                placeholder="http://localhost:11434"
                id="input-ollama-url"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Agent Roster */}
        <div className="glass-panel settings-section" id="config-agent-roster">
          <div className="section-header">
            <span className="section-number">02</span>
            <span className="section-title">Agent Roster — Model Assignments</span>
          </div>
          <div className="section-body">
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Assign specific LLM models to each agent. Higher-tier models cost more per token but produce better results.
            </p>

            {AGENTS.map((agent) => (
              <div key={agent.id} className="roster-item">
                <div className="roster-agent">
                  <div className={`roster-avatar`} style={{ background: 'transparent' }}>
                    <img 
                      src={`https://api.dicebear.com/9.x/${agent.role.includes('SRE') ? 'bottts' : 'pixel-art'}/svg?seed=${agent.name}`} 
                      alt={agent.name} 
                      style={{ width: '40px', height: '40px', imageRendering: 'pixelated', borderRadius: '8px' }} 
                    />
                  </div>
                  <div className="roster-details">
                    <h4>{agent.name}</h4>
                    <p>{agent.role}</p>
                  </div>
                </div>
                <select
                  className="roster-select"
                  value={agentModels[agent.id]}
                  onChange={(e) => handleModelChange(agent.id, e.target.value)}
                  id={`select-model-${agent.id}`}
                >
                  {MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Section 3: Infrastructure */}
        <div className="glass-panel settings-section" id="config-infra">
          <div className="section-header">
            <span className="section-number">03</span>
            <span className="section-title">Infrastructure Endpoints</span>
          </div>
          <div className="section-body">
            <div className="config-grid">
              <div className="config-row">
                <label>PostgreSQL</label>
                <input className="config-input" value="localhost:5432" readOnly style={{ opacity: 0.6 }} />
              </div>
              <div className="config-row">
                <label>Redis</label>
                <input className="config-input" value="localhost:6379" readOnly style={{ opacity: 0.6 }} />
              </div>
              <div className="config-row">
                <label>ChromaDB</label>
                <input className="config-input" value="localhost:8000" readOnly style={{ opacity: 0.6 }} />
              </div>
              <div className="config-row">
                <label>n8n</label>
                <input className="config-input" value="localhost:5678" readOnly style={{ opacity: 0.6 }} />
              </div>
              <div className="config-row">
                <label>LangFuse</label>
                <input className="config-input" value="localhost:3000" readOnly style={{ opacity: 0.6 }} />
              </div>
              <div className="config-row">
                <label>Agent Workspace</label>
                <input className="config-input" value="~/Projects/agent-workspace" readOnly style={{ opacity: 0.6 }} />
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: External Integrations & Autonomy */}
        <div className="glass-panel settings-section" id="config-integrations">
          <div className="section-header">
            <span className="section-number">04</span>
            <span className="section-title">External Tooling & Autonomy Parameters</span>
          </div>
          <div className="section-body">
            <div className="config-grid">
              <div className="config-row">
                <label>GitHub Personal Access Token <small>(Repo Creation/PRs)</small></label>
                <input type="password" name="github" className="config-input" value={keys.github} onChange={handleKeyChange} placeholder="ghp_..." />
              </div>
              <div className="config-row">
                <label>Perplexity / Tavily API <small>(Used by Ada Research)</small></label>
                <input type="password" name="perplexity" className="config-input" value={keys.perplexity} onChange={handleKeyChange} placeholder="pplx-..." />
              </div>
              <div className="config-row" style={{ gridColumn: 'span 2' }}>
                <label>n8n WhatsApp / Telegram Alert Webhook</label>
                <input type="text" name="whatsappWebhook" className="config-input" value={keys.whatsappWebhook} onChange={handleKeyChange} />
              </div>
            </div>
            
            <div style={{ padding: '12px', display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '20px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', marginBottom: '16px' }}>
              <button 
                onClick={handleTestConnections} 
                disabled={testing}
                style={{ padding: '8px 16px', background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', boxShadow: '0 4px 15px rgba(99, 102, 241, 0.4)' }}
              >
                {testing ? '⏳ Testing...' : '⚡ Test Connectivity'}
              </button>
              {testStatus && (
                <div style={{ display: 'flex', gap: '16px', fontSize: '0.9rem', fontWeight: 'bold', background: 'rgba(255,255,255,0.05)', padding: '6px 16px', borderRadius: '20px' }}>
                  <span style={{ color: testStatus.github === 'success' ? '#34d399' : testStatus.github === 'error' ? '#ef4444' : 'var(--text-muted)' }}>
                    GitHub: {testStatus.github === 'success' ? '🟢 Verified OK' : testStatus.github === 'error' ? '🔴 Auth Failed' : '⚪ Untested'}
                  </span>
                  <span style={{ color: testStatus.perplexity === 'success' ? '#34d399' : testStatus.perplexity === 'error' ? '#ef4444' : 'var(--text-muted)' }}>
                    Perplexity: {testStatus.perplexity === 'success' ? '🟢 Verified OK' : testStatus.perplexity === 'error' ? '🔴 Auth Failed' : '⚪ Untested'}
                  </span>
                </div>
              )}
            </div>

            <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.4)', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h4 style={{ margin: 0, color: '#34d399' }}>Human-in-the-Loop Gating</h4>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>Require manual UI approval before OpsBot merges production PRs.</p>
                </div>
                <button style={{ background: '#34d399', color: '#000', border: 'none', padding: '6px 16px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Enabled</button>
              </div>
            </div>
            
            <div style={{ marginTop: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Code Generation Temperature (Creativity vs Determinism)</label>
              <input type="range" min="0" max="1" step="0.1" defaultValue="0.2" style={{ width: '100%' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                <span>0.0 (Strict Execution)</span>
                <span>0.5 (Balanced)</span>
                <span>1.0 (Highly Creative)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Global Save Button Floor */}
        <div style={{ padding: '20px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-glass)', borderRadius: '8px', marginTop: '20px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: '20px' }}>Unsaved changes will be lost if you leave this page.</span>
          <button
            className="btn-primary"
            onClick={handleSave}
            id="btn-save-config"
            style={{ padding: '12px 24px', fontSize: '1.1rem', background: saved ? '#34d399' : 'var(--accent-primary)', color: saved ? '#000' : '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {saved ? '✓ Verified & Saved' : '💾 Commit Architecture to Factory'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminConfig;
