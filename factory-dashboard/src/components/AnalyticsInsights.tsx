import React, { useState } from 'react';

const agentData = [
  { name: 'JANE (PM / Triage)', model: 'Gemini 2.5 Flash', tokensIn: 1500, tokensOut: 950, time: '2m 14s', tasks: 3, efficiency: 98 },
  { name: 'SPOCK (Research)', model: 'Gemini 3.1 Pro', tokensIn: 2500, tokensOut: 1200, time: '3m 45s', tasks: 2, efficiency: 95 },
  { name: 'TORRES (Sr. Dev)', model: 'Gemini 3.1 Pro', tokensIn: 5000, tokensOut: 4500, time: '7m 12s', tasks: 5, efficiency: 92 },
  { name: 'TUVOK (QA)', model: 'Gemini 3.1 Pro', tokensIn: 7500, tokensOut: 2200, time: '4m 30s', tasks: 4, efficiency: 88 },
  { name: 'DATA (Architect)', model: 'Gemini 3.1 Pro', tokensIn: 8000, tokensOut: 150, time: '1m 20s', tasks: 1, efficiency: 99 },
  { name: 'CRUSHER (Docs)', model: 'Gemini 2.5 Flash', tokensIn: 4200, tokensOut: 3100, time: '2m 10s', tasks: 2, efficiency: 97 },
];

const AnalyticsInsights: React.FC = () => {
  const [selectedProject, setSelectedProject] = useState('HPSEDC Overseas Portal v1');

  // Aggregated Data
  const totalTokensIn = agentData.reduce((acc, curr) => acc + curr.tokensIn, 0);
  const totalTokensOut = agentData.reduce((acc, curr) => acc + curr.tokensOut, 0);
  const totalTokens = totalTokensIn + totalTokensOut;

  return (
    <div className="section-container" style={{ padding: '24px', color: '#f8fafc' }}>
      <header style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: 'bold' }}>Analytics & Insights</h1>
          <p style={{ margin: 0, color: '#94a3b8' }}>Telemetry, token economy, and agent performance tracking.</p>
        </div>
        <select 
          value={selectedProject} 
          onChange={(e) => setSelectedProject(e.target.value)}
          style={{ background: '#1e293b', color: 'white', border: '1px solid #334155', padding: '8px 16px', borderRadius: '8px', outline: 'none' }}
        >
          <option>HPSEDC Overseas Portal v1</option>
          <option>Legacy E-Commerce App</option>
          <option>All Projects Aggregate</option>
        </select>
      </header>

      {/* Top Level Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        <div style={{ background: 'rgba(30,30,40,0.5)', padding: '20px', borderRadius: '12px', border: '1px solid #334155' }}>
          <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Pipeline Time</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#38bdf8' }}>18m 42s</div>
          <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '4px' }}>↑ 12% faster than baseline</div>
        </div>

        <div style={{ background: 'rgba(30,30,40,0.5)', padding: '20px', borderRadius: '12px', border: '1px solid #334155' }}>
          <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>Compute Economy (Tokens)</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#c084fc' }}>{(totalTokens / 1000).toFixed(1)}k</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>In: {totalTokensIn} / Out: {totalTokensOut}</div>
        </div>

        <div style={{ background: 'rgba(30,30,40,0.5)', padding: '20px', borderRadius: '12px', border: '1px solid #334155' }}>
          <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>Average Efficiency</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#10b981' }}>94.8%</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>0 Hallucinations / 0 Rollbacks</div>
        </div>
      </div>

      {/* Agents Breakdown Grid */}
      <h3 style={{ borderBottom: '1px solid #334155', paddingBottom: '12px', marginBottom: '20px', color: '#e2e8f0', fontSize: '1.2rem' }}>Agent Contribution Matrix</h3>
      <div style={{ overflowX: 'auto', background: 'rgba(15,23,42,0.5)', borderRadius: '12px', border: '1px solid #334155' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ background: 'rgba(30,41,59,0.8)' }}>
              <th style={{ padding: '16px', color: '#cbd5e1', fontWeight: '600', borderBottom: '1px solid #334155' }}>Swarm Agent</th>
              <th style={{ padding: '16px', color: '#cbd5e1', fontWeight: '600', borderBottom: '1px solid #334155' }}>Engine Core</th>
              <th style={{ padding: '16px', color: '#cbd5e1', fontWeight: '600', borderBottom: '1px solid #334155' }}>Context In</th>
              <th style={{ padding: '16px', color: '#cbd5e1', fontWeight: '600', borderBottom: '1px solid #334155' }}>Generated Out</th>
              <th style={{ padding: '16px', color: '#cbd5e1', fontWeight: '600', borderBottom: '1px solid #334155' }}>Active Time</th>
              <th style={{ padding: '16px', color: '#cbd5e1', fontWeight: '600', borderBottom: '1px solid #334155' }}>Efficiency Score</th>
            </tr>
          </thead>
          <tbody>
            {agentData.map((agent, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '16px', fontWeight: '500', color: '#fff' }}>{agent.name}</td>
                <td style={{ padding: '16px' }}>
                  <span style={{ background: agent.model.includes('3.1 Pro') ? 'rgba(56, 189, 248, 0.1)' : 'rgba(192, 132, 252, 0.1)', color: agent.model.includes('3.1 Pro') ? '#38bdf8' : '#c084fc', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>
                    {agent.model}
                  </span>
                </td>
                <td style={{ padding: '16px', color: '#94a3b8', fontFamily: 'monospace' }}>{agent.tokensIn.toLocaleString()}</td>
                <td style={{ padding: '16px', color: '#94a3b8', fontFamily: 'monospace' }}>{agent.tokensOut.toLocaleString()}</td>
                <td style={{ padding: '16px', color: '#cbd5e1' }}>{agent.time}</td>
                <td style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flex: 1, background: '#1e293b', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ background: '#10b981', width: `${agent.efficiency}%`, height: '100%' }}></div>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: '#10b981' }}>{agent.efficiency}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
};

export default AnalyticsInsights;
