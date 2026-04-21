import React from 'react';

/* ═══════════════════════════════════════════════════════════
   SKILL MEMORY — Layer 5.5 Visualization
   Shows learned skills stored in PostgreSQL + ChromaDB
   ═══════════════════════════════════════════════════════════ */

interface SkillDocument {
  id: string;
  agent: string;
  agentClass: string;
  ticketType: string;
  techStack: string[];
  problem: string;
  solution: string;
  tokensSaved: number;
  createdAt: string;
}

// Simulated Skill Documents — will be live from PostgreSQL in Sprint 5
const SIMULATED_SKILLS: SkillDocument[] = [
  {
    id: 'sk-001',
    agent: 'Jane',
    agentClass: 'pm',
    ticketType: 'scope-definition',
    techStack: ['Agile', 'Markdown', 'Mermaid'],
    problem: 'Client provided unstructured PDF for HPSEDC portal without explicit success criteria.',
    solution: 'Parsed PDF contexts and formulated an 8-phase Agile scope document with explicit TDD criteria.',
    tokensSaved: 42500,
    createdAt: '2026-04-02',
  },
  {
    id: 'sk-002',
    agent: 'Data',
    agentClass: 'architect',
    ticketType: 'db-schema',
    techStack: ['PostgreSQL', 'Prisma', 'ERD'],
    problem: 'Complex normalization required for tracking overseas job applications and candidate passports.',
    solution: 'Designed a normalized 5-table schema with cascading deletes for candidates, applications, and documents.',
    tokensSaved: 38200,
    createdAt: '2026-04-02',
  },
  {
    id: 'sk-003',
    agent: 'Geordi',
    agentClass: 'frontend',
    ticketType: 'ui-component',
    techStack: ['React', 'Tailwind', 'Vite'],
    problem: 'HPSEDC UI lacked modern "wow factor" and gradients for a government portal.',
    solution: 'Implemented glassmorphic glass-panels with tailored CSS variables and subtle gradient text.',
    tokensSaved: 18400,
    createdAt: '2026-04-02',
  },
  {
    id: 'sk-004',
    agent: 'Torres',
    agentClass: 'backend',
    ticketType: 'api-routing',
    techStack: ['Node.js', 'Express', 'Multer'],
    problem: 'File uploads for passport verification were timing out and crashing the Express server.',
    solution: 'Implemented Multer with a memory buffer and async S3 stream piping to prevent RAM exhaustion.',
    tokensSaved: 15600,
    createdAt: '2026-04-02',
  },
  {
    id: 'sk-005',
    agent: 'Worf',
    agentClass: 'security',
    ticketType: 'auth-layer',
    techStack: ['JWT', 'Bcrypt', 'Helmet'],
    problem: 'Frontend requests were being blocked due to missing CORS parameters on a proxy architecture.',
    solution: 'Configured restrictive Helmet policies and established a Vite reverse-proxy configuration for CORS bypass.',
    tokensSaved: 22100,
    createdAt: '2026-04-02',
  },
  {
    id: 'sk-006',
    agent: 'Spock',
    agentClass: 'research',
    ticketType: 'anomaly-detection',
    techStack: ['Python', 'Pandas', 'ChromaDB'],
    problem: 'Candidate resumes needed semantic parsing to match perfectly against HPSEDC overseas job requirements.',
    solution: 'Implemented a lightweight vector embedding search using HuggingFace sentence-transformers and ChromaDB.',
    tokensSaved: 51200,
    createdAt: '2026-04-02',
  },
  {
    id: 'sk-007',
    agent: 'Tuvok',
    agentClass: 'qa',
    ticketType: 'e2e-testing',
    techStack: ['Jest', 'Supertest', 'Cypress'],
    problem: 'OTP generation routines were failing randomly during concurrent user login spikes.',
    solution: 'Wrote a deterministic mock for the OTP gateway and implemented 100% route coverage using Supertest.',
    tokensSaved: 19800,
    createdAt: '2026-04-02',
  },
  {
    id: 'sk-008',
    agent: 'Crusher',
    agentClass: 'devops',
    ticketType: 'observability',
    techStack: ['Prometheus', 'Winston', 'Node'],
    problem: 'Factory node server logs were unstructured, making debugging API crashes impossible.',
    solution: 'Configured a Winston structured JSON logger with timestamping and injected correlation IDs into Express requests.',
    tokensSaved: 11000,
    createdAt: '2026-04-02',
  },
  {
    id: 'sk-009',
    agent: 'McCoy',
    agentClass: 'integration',
    ticketType: 'sys-admin',
    techStack: ['Nginx', 'Docker', 'Linux'],
    problem: 'Node processes were dying silently when processing heavily concurrent operations.',
    solution: 'Wrapped application with PM2 process manager and mapped container ports to an Nginx reverse proxy.',
    tokensSaved: 14500,
    createdAt: '2026-04-02',
  },
  {
    id: 'sk-010',
    agent: 'Picard',
    agentClass: 'coordinator',
    ticketType: 'orchestration',
    techStack: ['Typescript', 'Agent-Swarm'],
    problem: 'Agent handover between Phase 1 (PM) and Phase 2 (Arch) resulted in lost context and hallucinations.',
    solution: 'Created highly explicit PMD markdown handovers and enforced strict JSON schema validation for all agent outputs.',
    tokensSaved: 89000,
    createdAt: '2026-04-02',
  }
];

const SkillMemory: React.FC = () => {
  const totalTokensSaved = SIMULATED_SKILLS.reduce((sum, s) => sum + s.tokensSaved, 0);
  const estimatedMoneySaved = (totalTokensSaved * 0.000003).toFixed(2); // Rough Gemini pricing

  return (
    <div className="fade-in" id="skill-memory-page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Skill Memory</h1>
          <p className="page-subtitle">
            Layer 5.5 — Self-Improving Agent Knowledge Base (PostgreSQL + ChromaDB)
          </p>
        </div>
        <div className="skills-badge" style={{ padding: '6px 14px', fontSize: '0.72rem' }}>
          🧠 {SIMULATED_SKILLS.length} Skills Stored
        </div>
      </div>

      {/* Stats */}
      <div className="stats-bar" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="glass-panel stat-card">
          <div className="stat-icon purple">📚</div>
          <div className="stat-data">
            <span className="stat-value">{SIMULATED_SKILLS.length}</span>
            <span className="stat-label">Total Skills</span>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon green">⚡</div>
          <div className="stat-data">
            <span className="stat-value">{(totalTokensSaved / 1000).toFixed(1)}K</span>
            <span className="stat-label">Tokens Saved</span>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon amber">💰</div>
          <div className="stat-data">
            <span className="stat-value">${estimatedMoneySaved}</span>
            <span className="stat-label">Est. Cost Saved</span>
          </div>
        </div>
      </div>

      {/* Skill Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Learned Skill Documents
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
            Simulated • Awaiting Layer 5.5 integration
          </span>
        </div>

        {SIMULATED_SKILLS.map((skill) => (
          <div key={skill.id} className="glass-panel" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className={`roster-avatar ${skill.agentClass}`} style={{ width: '28px', height: '28px', fontSize: '0.7rem', borderRadius: '6px' }}>
                  {skill.agent[0]}
                </div>
                <div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{skill.agent}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '8px' }}>{skill.createdAt}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <span style={{
                  fontSize: '0.6rem',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '100px',
                  background: 'rgba(99, 102, 241, 0.1)',
                  color: 'var(--accent-secondary)',
                  border: '1px solid rgba(99, 102, 241, 0.15)',
                }}>
                  {skill.ticketType}
                </span>
                <span style={{
                  fontSize: '0.6rem',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '100px',
                  background: 'rgba(16, 185, 129, 0.1)',
                  color: 'var(--status-online)',
                  border: '1px solid rgba(16, 185, 129, 0.15)',
                }}>
                  ~{(skill.tokensSaved / 1000).toFixed(1)}K tokens saved
                </span>
              </div>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--status-error)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Problem
              </span>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.5 }}>
                {skill.problem}
              </p>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--status-online)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Solution
              </span>
              <p style={{
                fontSize: '0.82rem',
                color: 'var(--text-primary)',
                marginTop: '4px',
                lineHeight: 1.5,
                padding: '8px 12px',
                background: 'rgba(16, 185, 129, 0.04)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(16, 185, 129, 0.08)',
                fontFamily: 'var(--font-mono)',
              }}>
                {skill.solution}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {skill.techStack.map((tech, idx) => (
                <span key={idx} style={{
                  fontSize: '0.6rem',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {tech}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SkillMemory;
