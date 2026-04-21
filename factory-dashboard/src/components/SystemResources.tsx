import React, { useState, useEffect, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════
   SYSTEM RESOURCES — Hardware & Infrastructure Monitor
   Live data from /api/metrics (server/metrics.mjs)
   ═══════════════════════════════════════════════════════════ */

interface CpuInfo {
  model: string;
  cores: number;
  speed: number;
  usagePercent: number;
}

interface MemoryInfo {
  totalGB: string;
  usedGB: string;
  freeGB: string;
  percent: number;
}

interface DiskInfo {
  totalGB: string;
  usedGB: string;
  availGB: string;
  percent: number;
  mount: string;
}

interface GpuInfo {
  available: boolean;
  name: string;
  memoryTotalMB: number;
  memoryUsedMB: number;
  utilizationPercent: number;
  temperatureC: number;
}

interface NetworkInterface {
  interface: string;
  ip: string;
}

interface DockerContainer {
  name: string;
  status: string;
  ports: string;
}

interface SystemMetrics {
  timestamp: string;
  hostname: string;
  platform: string;
  os: string;
  arch: string;
  cpu: CpuInfo;
  memory: MemoryInfo;
  disk: DiskInfo;
  gpu: GpuInfo;
  uptime: { seconds: number; formatted: string };
  loadAverage: { '1m': string; '5m': string; '15m': string };
  network: NetworkInterface[];
  processes: number;
  docker: DockerContainer[];
  nodeVersion: string;
}

// Circular gauge component
const CircularGauge: React.FC<{
  value: number;
  label: string;
  color: string;
  sublabel?: string;
  size?: number;
}> = ({ value, label, color, sublabel, size = 120 }) => {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const center = size / 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Background ring */}
        <circle
          cx={center} cy={center} r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={strokeWidth}
        />
        {/* Value ring */}
        <circle
          cx={center} cy={center} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
            filter: `drop-shadow(0 0 6px ${color}40)`,
          }}
        />
        {/* Center text */}
        <text
          x={center} y={center - 4}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--text-primary)"
          fontSize="1.5rem"
          fontWeight="700"
          fontFamily="var(--font-sans)"
          style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}
        >
          {value}%
        </text>
        <text
          x={center} y={center + 18}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--text-muted)"
          fontSize="0.6rem"
          fontWeight="500"
          fontFamily="var(--font-sans)"
          letterSpacing="0.08em"
          style={{ transform: 'rotate(90deg)', transformOrigin: 'center', textTransform: 'uppercase' }}
        >
          {label}
        </text>
      </svg>
      {sublabel && (
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {sublabel}
        </span>
      )}
    </div>
  );
};

// Progress bar component
const ProgressBar: React.FC<{ value: number; color: string; height?: number }> = ({ value, color, height = 6 }) => (
  <div style={{
    width: '100%',
    height: `${height}px`,
    borderRadius: '100px',
    background: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  }}>
    <div style={{
      width: `${value}%`,
      height: '100%',
      borderRadius: '100px',
      background: color,
      boxShadow: `0 0 8px ${color}40`,
      transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
    }} />
  </div>
);

// Color based on percentage
function getHealthColor(percent: number): string {
  if (percent < 50) return '#10b981';
  if (percent < 75) return '#f59e0b';
  return '#ef4444';
}

const METRICS_API = '/api/metrics';

const SystemResources: React.FC = () => {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<'hardware' | 'llm'>('hardware');

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(METRICS_API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SystemMetrics = await res.json();
      setMetrics(data);
      setError(null);
      setLastUpdated(new Date());
      setCpuHistory(prev => [...prev.slice(-29), data.cpu.usagePercent]);
      setMemHistory(prev => [...prev.slice(-29), data.memory.percent]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch metrics');
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000); // Poll every 3 seconds
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Mini sparkline chart
  const Sparkline: React.FC<{ data: number[]; color: string; width?: number; height?: number }> = ({
    data, color, width = 200, height = 40,
  }) => {
    if (data.length < 2) return null;
    const max = 100;
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (v / max) * height;
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg width={width} height={height} style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Fill area */}
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill={`url(#grad-${color.replace('#', '')})`}
        />
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Current value dot */}
        {data.length > 0 && (
          <circle
            cx={width}
            cy={height - (data[data.length - 1] / max) * height}
            r="3"
            fill={color}
            style={{ filter: `drop-shadow(0 0 4px ${color})` }}
          />
        )}
      </svg>
    );
  };

  if (error && !metrics) {
    return (
      <div className="fade-in" id="system-resources-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">System Resources</h1>
            <p className="page-subtitle">Hardware & Infrastructure Monitor</p>
          </div>
        </div>
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
          <p style={{ fontSize: '1.2rem', marginBottom: '8px' }}>⚠️ Metrics API Offline</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Start the metrics server: <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: '4px' }}>node server/metrics.mjs</code>
          </p>
          <p style={{ color: 'var(--status-error)', fontSize: '0.75rem' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="fade-in" id="system-resources-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">System Resources</h1>
            <p className="page-subtitle">Loading metrics...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in" id="system-resources-page">
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="page-title">System Resources</h1>
            <p className="page-subtitle">
              {metrics.hostname} • {metrics.os} • Uptime {metrics.uptime.formatted}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {error && (
              <span style={{ fontSize: '0.7rem', color: 'var(--status-error)' }}>⚠ Stale</span>
            )}
            <div className="header-badge badge-online">
              <span className="badge-dot" />
              Live • {lastUpdated.toLocaleTimeString('en-US', { hour12: false })}
            </div>
          </div>
        </div>
        
        {/* Resource Tabs */}
        <div style={{ display: 'flex', gap: '24px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px', zIndex: 10 }}>
          <button 
            onClick={() => setActiveTab('hardware')}
            style={{ 
              background: 'transparent', border: 'none', color: activeTab === 'hardware' ? '#e2e8f0' : '#64748b', 
              fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', paddingBottom: '8px',
              borderBottom: activeTab === 'hardware' ? '2px solid #8b5cf6' : '2px solid transparent',
              transition: 'all 0.2s ease'
            }}
          >
            🖥️ Hardware & Infrastructure
          </button>
          <button 
            onClick={() => setActiveTab('llm')}
            style={{ 
              background: 'transparent', border: 'none', color: activeTab === 'llm' ? '#e2e8f0' : '#64748b', 
              fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', paddingBottom: '8px',
              borderBottom: activeTab === 'llm' ? '2px solid #10b981' : '2px solid transparent',
              transition: 'all 0.2s ease'
            }}
          >
            🧠 LLM Fleet & Quotas
          </button>
        </div>
      </div>

      {/* Tab Content Rendering */}
      {activeTab === 'hardware' && (
        <div className="fade-in">
          {/* Top Stats Row */}
      <div className="stats-bar">
        <div className="glass-panel stat-card" id="stat-cpu-model">
          <div className="stat-icon blue">🖥️</div>
          <div className="stat-data">
            <span className="stat-value" style={{ fontSize: '0.95rem' }}>{metrics.cpu.model.replace('Intel(R) Xeon(R) CPU @ ', 'Xeon ')}</span>
            <span className="stat-label">{metrics.cpu.cores} vCPUs • {metrics.arch}</span>
          </div>
        </div>
        <div className="glass-panel stat-card" id="stat-ram-total">
          <div className="stat-icon purple">🧮</div>
          <div className="stat-data">
            <span className="stat-value">{metrics.memory.totalGB} GB</span>
            <span className="stat-label">Total RAM</span>
          </div>
        </div>
        <div className="glass-panel stat-card" id="stat-disk-total">
          <div className="stat-icon green">💾</div>
          <div className="stat-data">
            <span className="stat-value">{metrics.disk.totalGB} GB</span>
            <span className="stat-label">Disk ({metrics.disk.mount})</span>
          </div>
        </div>
        <div className="glass-panel stat-card" id="stat-processes">
          <div className="stat-icon amber">⚙️</div>
          <div className="stat-data">
            <span className="stat-value">{metrics.processes}</span>
            <span className="stat-label">Processes</span>
          </div>
        </div>
      </div>

      {/* Gauges Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        {/* CPU Gauge */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <CircularGauge
            value={metrics.cpu.usagePercent}
            label="CPU"
            color={getHealthColor(metrics.cpu.usagePercent)}
            sublabel={`Load: ${metrics.loadAverage['1m']} / ${metrics.loadAverage['5m']} / ${metrics.loadAverage['15m']}`}
          />
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>CPU History (90s)</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{metrics.cpu.usagePercent}%</span>
            </div>
            <Sparkline data={cpuHistory} color={getHealthColor(metrics.cpu.usagePercent)} />
          </div>
        </div>

        {/* Memory Gauge */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <CircularGauge
            value={metrics.memory.percent}
            label="RAM"
            color={getHealthColor(metrics.memory.percent)}
            sublabel={`${metrics.memory.usedGB} / ${metrics.memory.totalGB} GB used`}
          />
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Memory History (90s)</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{metrics.memory.percent}%</span>
            </div>
            <Sparkline data={memHistory} color={getHealthColor(metrics.memory.percent)} />
          </div>
        </div>

        {/* Disk Gauge */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <CircularGauge
            value={metrics.disk.percent}
            label="DISK"
            color={getHealthColor(metrics.disk.percent)}
            sublabel={`${metrics.disk.usedGB} / ${metrics.disk.totalGB} GB used`}
          />
          <div style={{ width: '100%', marginTop: '8px' }}>
            <ProgressBar value={metrics.disk.percent} color={getHealthColor(metrics.disk.percent)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
              <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{metrics.disk.availGB} GB free</span>
              <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Mount: {metrics.disk.mount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: GPU + Network + Docker */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
        {/* GPU Panel */}
        <div className="glass-panel" id="gpu-panel">
          <div className="panel-header">
            <span className="panel-title">🎮 GPU</span>
            <span style={{
              fontSize: '0.65rem',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '100px',
              background: metrics.gpu.available ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: metrics.gpu.available ? 'var(--status-online)' : 'var(--status-error)',
              border: `1px solid ${metrics.gpu.available ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
            }}>
              {metrics.gpu.available ? 'Active' : 'Not Available'}
            </span>
          </div>
          <div className="panel-body">
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              {metrics.gpu.name}
            </div>
            {metrics.gpu.available ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Utilization</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{metrics.gpu.utilizationPercent}%</span>
                  </div>
                  <ProgressBar value={metrics.gpu.utilizationPercent} color="#8b5cf6" />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>VRAM</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{metrics.gpu.memoryUsedMB}/{metrics.gpu.memoryTotalMB} MB</span>
                  </div>
                  <ProgressBar value={metrics.gpu.memoryTotalMB > 0 ? (metrics.gpu.memoryUsedMB / metrics.gpu.memoryTotalMB) * 100 : 0} color="#6366f1" />
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>🌡️ {metrics.gpu.temperatureC}°C</span>
              </div>
            ) : (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                No NVIDIA GPU detected on this machine. Local LLM hosting (Ollama/Nemotron) will require a GPU upgrade or cloud API fallback.
              </p>
            )}
          </div>
        </div>

        {/* Network Panel */}
        <div className="glass-panel" id="network-panel">
          <div className="panel-header">
            <span className="panel-title">🌐 Network</span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {metrics.network.map((net, idx) => (
                <div key={idx} className="infra-item">
                  <span className="infra-dot healthy" />
                  <div className="infra-info">
                    <span className="infra-name">{net.interface}</span>
                    <span className="infra-detail">{net.ip}</span>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-glass)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Platform</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{metrics.platform}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Node.js</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{metrics.nodeVersion}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Docker Containers */}
        <div className="glass-panel" id="docker-panel">
          <div className="panel-header">
            <span className="panel-title">🐳 Docker Containers</span>
            <span style={{ fontSize: '0.65rem', color: 'var(--status-online)', fontWeight: 600 }}>
              {metrics.docker.length} Running
            </span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {metrics.docker.map((container, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-glass)',
                }}>
                  <span className="infra-dot healthy" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {container.name}
                    </div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {container.status}
                    </div>
                  </div>
                </div>
              ))}
              {metrics.docker.length === 0 && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No containers running</p>
              )}
            </div>
          </div>
        </div>
      </div>
     </div>
      )}

      {/* LLM Fleet Tab view */}
      {activeTab === 'llm' && (
        <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Top Quota Warning */}
          <div className="glass-panel" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.2)', padding: '10px', borderRadius: '50%' }}>
                <span style={{ fontSize: '1.2rem' }}>💎</span>
              </div>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e2e8f0' }}>API Quota Health: Optimal</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>Current aggregate utilization is within limits. No rate limiting detected.</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
               <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600, letterSpacing: '0.5px' }}>GLOBAL RATE</div>
               <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)', color: '#e2e8f0' }}>~ 45 req/min</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            
            {/* Model Card: Gemini 1.5 Pro */}
            <div className="glass-panel">
               <div className="panel-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '16px', marginBottom: '16px' }}>
                 <div>
                   <span className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                     <span style={{ color: '#4285F4' }}>G</span> Gemini 1.5 Pro
                   </span>
                   <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px' }}>Primary Code Generation • Architecture</div>
                 </div>
                 <span className="badge-online" style={{ fontSize: '0.65rem', padding: '2px 8px' }}>API ACTIVE</span>
               </div>
               <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                 <div>
                   <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                     <span style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>Token Quota (Daily)</span>
                     <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#94a3b8' }}>1.2M / 4.0M</span>
                   </div>
                   <ProgressBar value={30} color="#4285F4" />
                 </div>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '8px' }}>
                    <div style={{ background: 'var(--bg-tertiary)', padding: '10px', borderRadius: '8px' }}>
                      <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>Avg Latency</div>
                      <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', color: '#e2e8f0', marginTop: '2px' }}>1.2s</div>
                    </div>
                    <div style={{ background: 'var(--bg-tertiary)', padding: '10px', borderRadius: '8px' }}>
                      <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>State</div>
                      <div style={{ fontSize: '0.85rem', color: '#8b5cf6', fontWeight: 600, marginTop: '2px' }}>Engaged</div>
                    </div>
                 </div>
               </div>
            </div>

            {/* Model Card: Gemini 1.5 Flash */}
            <div className="glass-panel">
               <div className="panel-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '16px', marginBottom: '16px' }}>
                 <div>
                   <span className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                     <span style={{ color: '#F4B400' }}>G</span> Gemini 1.5 Flash
                   </span>
                   <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px' }}>Triage • Documentation • Testing</div>
                 </div>
                 <span className="badge-online" style={{ fontSize: '0.65rem', padding: '2px 8px' }}>API ACTIVE</span>
               </div>
               <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                 <div>
                   <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                     <span style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>Token Quota (Daily)</span>
                     <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: '#94a3b8' }}>850K / 15.0M</span>
                   </div>
                   <ProgressBar value={15} color="#F4B400" />
                 </div>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '8px' }}>
                    <div style={{ background: 'var(--bg-tertiary)', padding: '10px', borderRadius: '8px' }}>
                      <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>Avg Latency</div>
                      <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', color: '#e2e8f0', marginTop: '2px' }}>0.4s</div>
                    </div>
                    <div style={{ background: 'var(--bg-tertiary)', padding: '10px', borderRadius: '8px' }}>
                      <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>State</div>
                      <div style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 600, marginTop: '2px' }}>Polling</div>
                    </div>
                 </div>
               </div>
            </div>

            {/* Model Card: Ollama Local */}
            <div className="glass-panel" style={{ opacity: 0.8 }}>
               <div className="panel-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '16px', marginBottom: '16px' }}>
                 <div>
                   <span className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>🦙 Ollama (Llama 3)</span>
                   <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px' }}>Local Fallback • Offline Mode</div>
                 </div>
                 <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '100px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--status-error)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>OFFLINE</span>
               </div>
               <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                 <p style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>
                   Local inference engine is suspended. Waiting for discrete GPU hardware to be attached to the node for activation.
                 </p>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '8px' }}>
                    <div style={{ background: 'var(--bg-tertiary)', padding: '10px', borderRadius: '8px', opacity: 0.5 }}>
                      <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>Req/min</div>
                      <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', color: '#64748b', marginTop: '2px' }}>0</div>
                    </div>
                    <div style={{ background: 'var(--bg-tertiary)', padding: '10px', borderRadius: '8px', opacity: 0.5 }}>
                      <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase' }}>VRAM Target</div>
                      <div style={{ fontSize: '1rem', fontFamily: 'var(--font-mono)', color: '#64748b', marginTop: '2px' }}>~6 GB</div>
                    </div>
                 </div>
               </div>
            </div>

            {/* Model Card: Claude 3.5 Sonnet */}
            <div className="glass-panel" style={{ opacity: 0.8 }}>
               <div className="panel-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '16px', marginBottom: '16px' }}>
                 <div>
                   <span className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>🤖 Claude 3.5</span>
                   <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px' }}>Tooling • Specialty UX</div>
                 </div>
                 <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '100px', background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.2)' }}>STANDBY</span>
               </div>
               <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                 <p style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>
                   Anthropic API is enabled in config but requires an API Key in <code style={{fontFamily:'var(--font-mono)', background:'var(--bg-secondary)', padding:'2px 4px', borderRadius:'4px'}}>.env</code> to engage.
                 </p>
               </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default SystemResources;
