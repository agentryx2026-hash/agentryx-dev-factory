import React, { useState, useEffect } from 'react';

const PreDev: React.FC = () => {
  const [projectName, setProjectName] = useState('');
  const [taskInput, setTaskInput] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<{name: string, size: number, data?: string}[]>([]);
  const [factoryRunning, setFactoryRunning] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [pendingProjects, setPendingProjects] = useState<any[]>([]);
  const [pushingDev, setPushingDev] = useState<string | null>(null);
  const [preDevDocCount, setPreDevDocCount] = useState(12);

  // Document Viewer State
  const [viewingProject, setViewingProject] = useState<string | null>(null);
  const [projectDocs, setProjectDocs] = useState<any[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [docContent, setDocContent] = useState<string>('');

  const openViewer = async (projectName: string) => {
    setViewingProject(projectName);
    setProjectDocs([]);
    setSelectedDoc(null);
    setDocContent('');
    try {
      const res = await fetch(`/telemetry/workspace/files?project=${encodeURIComponent(projectName)}`);
      const data = await res.json();
      
      // Flatten the tree or just extract files in PMD/ and docs/
      const docs: any[] = [];
      const extractFiles = (nodes: any[], pathPrefix = '') => {
        nodes.forEach(node => {
          if (node.type === 'file' && /^(A|B|C|P|AGENT_STATE)/.test(node.name)) {
             docs.push({ ...node, fullPath: pathPrefix + node.name });
          } else if (node.type === 'dir' && (node.name === 'PMD' || node.name === 'docs')) {
             extractFiles(node.children || [], `${pathPrefix}${node.name}/`);
          }
         });
      };
      
      if (data.tree) {
         data.tree.forEach((node: any) => extractFiles([node]));
      }
      setProjectDocs(docs);
      
      if (docs.length > 0) {
        viewDoc(projectName, docs[0].fullPath, docs[0]);
      }
    } catch (e) { console.error('Error fetching docs', e); }
  };

  const viewDoc = async (projectName: string, filePath: string, docNode: any) => {
    setSelectedDoc(docNode);
    setDocContent('Loading...');
    try {
      const res = await fetch(`/telemetry/workspace/read?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      setDocContent(data.content);
    } catch (e) {
      setDocContent('Failed to load file');
    }
  };

  const deleteProject = async (projectName: string) => {
    if (!confirm(`Are you sure you want to delete ${projectName}? This cannot be undone.`)) return;
    try {
      await fetch(`/telemetry/workspace/delete?project=${encodeURIComponent(projectName)}`, { method: 'DELETE' });
      fetchPending();
    } catch (e) {
      console.error('Error deleting project', e);
    }
  };

  const fetchPending = async () => {
    try {
      const res = await fetch('/telemetry/workspace/projects');
      const data = await res.json();
      // Only show projects that DO NOT have a B7 report (i.e. Dev hasn't finished/started)
      const pending = data.projects?.filter((p: any) => !p.hasReport) || [];
      setPendingProjects(pending);
    } catch (e) { console.error('Error fetching pending projects', e); }
  };

  useEffect(() => {
    fetchPending();
    // Fetch template count from PMD directory
    fetch('/telemetry/workspace/template-count').then(r => r.json()).then(d => {
      if (d.count) setPreDevDocCount(d.count);
    }).catch(() => {});
    const interval = setInterval(fetchPending, 5000);
    return () => clearInterval(interval);
  }, []);

  const submitRealTask = async () => {
    if (!taskInput.trim() && files.length === 0) return;
    setFactoryRunning(true);
    setSuccessMsg('');
    try {
      const payload = { 
        task: taskInput,
        projectName: projectName,
        files: files.map(f => ({ name: f.name, data: f.data }))
      };
      await fetch('/telemetry/factory/pre-dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setTaskInput('');
      setFiles([]);
      setSuccessMsg('✅ Scope submitted to Picard. Pre-Dev engaged! PMD Docs will appear below shortly.');
      setTimeout(fetchPending, 2000);
    } catch(e) { console.error('Factory Error', e); }
    setTimeout(() => {
      setFactoryRunning(false);
      setTimeout(() => setSuccessMsg(''), 10000);
    }, 2000);
  };

  const pushToDev = async (projectName: string) => {
    setPushingDev(projectName);
    try {
      await fetch('/telemetry/factory/dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectName })
      });
      alert('🚀 Scope pushed to Dev Floor! Switch to the Live Pipeline tab to watch Jane and Torres work.');
    } catch(e) {
      console.error(e);
      alert('Failed to push to dev');
    }
    setPushingDev(null);
  };

  return (
    <div className="fade-in" id="pre-dev-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pre-Dev Intake</h1>
          <p className="page-subtitle">Drop raw scope (SRS/FRS/TOR) to generate standard PMD documents</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(400px, 2fr) 1fr', gap: '20px', marginBottom: '30px' }}>
        {/* Left Side: Dropzone & Input */}
        <div>
          <div className="glass-panel" style={{ marginBottom: '20px' }}>
            <div className="panel-header">
              <h3 className="panel-title">📥 Requirement Ingestion</h3>
            </div>
            <div className="panel-body">
              <div 
                style={{
                  border: `2px dashed ${dragActive ? '#8b5cf6' : 'rgba(255,255,255,0.2)'}`,
                  background: dragActive ? 'rgba(139,92,246,0.1)' : 'rgba(0,0,0,0.3)',
                  borderRadius: '12px',
                  padding: '40px',
                  textAlign: 'center',
                  transition: 'all 0.2s',
                  marginBottom: '16px',
                  cursor: 'pointer'
                }}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  Array.from(e.dataTransfer.files).forEach(f => {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const b64 = (ev.target?.result as string).split(',')[1];
                      setFiles(prev => [...prev, { name: f.name, size: f.size, data: b64 }]);
                    };
                    reader.readAsDataURL(f);
                  });
                }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.onchange = (e) => {
                    const selected = (e.target as HTMLInputElement).files;
                    if (!selected) return;
                    Array.from(selected).forEach(f => {
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const b64 = (ev.target?.result as string).split(',')[1];
                        setFiles(prev => [...prev, { name: f.name, size: f.size, data: b64 }]);
                      };
                      reader.readAsDataURL(f);
                    });
                  };
                  input.click();
                }}
              >
                <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📄</div>
                <h4 style={{ color: '#e2e8f0', marginBottom: '8px' }}>Drag & Drop Scope Documents</h4>
                <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Supports Word, PDF, Markdown, and TXT files containing SRS, FRS, PRD, or TOR scopes.</p>
              </div>

              {files.length > 0 && (
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                  <h5 style={{ color: '#c4b5fd', marginBottom: '8px' }}>Staged Files:</h5>
                  {files.map((f, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#e2e8f0', marginBottom: '4px' }}>
                      <span>📎 {f.name}</span>
                      <span style={{ color: '#64748b' }}>{(f.size/1024).toFixed(1)} KB</span>
                    </div>
                  ))}
                  <button onClick={() => setFiles([])} style={{ marginTop: '8px', background: 'transparent', border: '1px solid rgba(239,68,68,0.5)', color: '#ef4444', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}>Clear Files</button>
                </div>
              )}

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: '#94a3b8', marginBottom: '8px', fontSize: '0.9rem' }}>Project Name (Optional):</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. build-a-react-dashboard"
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#fff',
                    marginBottom: '16px'
                  }}
                />

                <label style={{ display: 'block', color: '#94a3b8', marginBottom: '8px', fontSize: '0.9rem' }}>Or paste plain text requirements:</label>
                <textarea
                  value={taskInput}
                  onChange={(e) => setTaskInput(e.target.value)}
                  placeholder="e.g. 'Build a React dashboard with JWT authentication that allows users to manage widgets...'"
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#fff',
                    minHeight: '120px',
                    resize: 'vertical'
                  }}
                />
              </div>

              <button 
                onClick={submitRealTask} 
                disabled={factoryRunning || (!taskInput.trim() && files.length === 0)}
                style={{ 
                  width: '100%',
                  padding: '12px', 
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                  border: 'none', 
                  borderRadius: '8px', 
                  color: '#fff', 
                  fontWeight: 'bold', 
                  cursor: factoryRunning ? 'not-allowed' : 'pointer',
                  fontSize: '1rem',
                  opacity: (factoryRunning || (!taskInput.trim() && files.length === 0)) ? 0.6 : 1
                }}>
                {factoryRunning ? '⚙️ Initializing Pre-Dev...' : `▶ Convert to Agentryx Standard Pipeline (${preDevDocCount} Docs)`}
              </button>
              
              {successMsg && (
                <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.5)', borderRadius: '8px', color: '#34d399', textAlign: 'center', fontWeight: 600 }}>
                  {successMsg}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Process Info */}
        <div>
          <div className="glass-panel" style={{ height: '100%' }}>
            <div className="panel-header">
              <h3 className="panel-title">🧠 Standard Conversion</h3>
            </div>
            <div className="panel-body" style={{ color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.6 }}>
              <p style={{ marginBottom: '16px' }}>
                Any raw scope dropped here will be intercepted by <strong>Picard, Sisko, and Troi</strong> to generate the standard Agentryx PMD documents before code generation begins.
              </p>
              
              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#c4b5fd' }}>1. Architectural Translation</strong>
                <ul style={{ margin: '4px 0 0 20px', color: '#94a3b8' }}>
                  <li>A1: Solution Brief</li>
                  <li>A2: Solution Architecture</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#c4b5fd' }}>2. Project Breakdown</strong>
                <ul style={{ margin: '4px 0 0 20px', color: '#94a3b8' }}>
                  <li>A3: Solution Modules</li>
                  <li>A4: Dev Plan & Phasing</li>
                  <li>A5: Phase-wise PRD</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#c4b5fd' }}>3. The "110%" Enhancements</strong>
                <ul style={{ margin: '4px 0 0 20px', color: '#94a3b8' }}>
                  <li>B4: AI Enhancement Report</li>
                  <li>B6: Quick Win Injections</li>
                </ul>
              </div>

              <p style={{ color: '#f59e0b', fontSize: '0.85rem', marginTop: '20px', padding: '12px', background: 'rgba(245,158,11,0.1)', borderRadius: '6px' }}>
                <strong>Note:</strong> Files are securely parsed locally. We do not transmit PII out of the Dev Hub.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Pending Scopes Section */}
      <h2 style={{ fontSize: '1.2rem', color: '#e2e8f0', marginBottom: '16px' }}>Awaiting Push to Dev Floor</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '16px', paddingBottom: '40px' }}>
        {pendingProjects.map((p, idx) => (
          <div key={idx} className="glass-panel" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <div style={{ flex: 1, paddingRight: '12px' }}>
                <h4 style={{ color: '#fff', fontSize: '1.05rem', margin: '0 0 6px 0', wordBreak: 'break-all' }}>{p.name}</h4>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', background: p.status === 'generating-scope' ? 'rgba(59,130,246,0.2)' : 'rgba(245,158,11,0.2)', color: p.status === 'generating-scope' ? '#93c5fd' : '#fbbf24', padding: '2px 8px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {p.status === 'generating-scope' ? '⏳ Generating PMD Docs...' : 'Ready for Dev'}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => deleteProject(p.name)} 
                title="Archive / Delete Project"
                style={{ 
                  background: 'rgba(239,68,68,0.1)', 
                  color: '#ef4444', 
                  border: '1px solid rgba(239,68,68,0.3)', 
                  borderRadius: '6px', 
                  padding: '6px 10px', 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.9rem',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.25)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
              >
                🗑️
              </button>
            </div>
            
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '0 0 16px 0' }}>
              <strong>Generated:</strong> {new Date(p.created).toLocaleString()}<br/>
              <strong>Files Ready:</strong> {p.fileCount} (including PMD spec)
            </p>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => openViewer(p.name)}
                disabled={p.status === 'generating-scope'}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'rgba(255,255,255,0.1)',
                  color: '#e2e8f0',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  cursor: p.status === 'generating-scope' ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  opacity: p.status === 'generating-scope' ? 0.4 : 1
                }}
              >
                👀 Review PMD
              </button>
              <button
                onClick={() => pushToDev(p.name)}
                disabled={pushingDev === p.name || p.status === 'generating-scope'}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: pushingDev === p.name ? '#334155' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: (pushingDev === p.name || p.status === 'generating-scope') ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  opacity: p.status === 'generating-scope' ? 0.4 : 1
                }}
              >
                {pushingDev === p.name ? '🚀 Pushing...' : '🚀 Push to Dev Floor'}
              </button>
            </div>
          </div>
        ))}
        {pendingProjects.length === 0 && (
          <div style={{ color: '#64748b', fontStyle: 'italic', padding: '20px 0' }}>
            No pending scopes awaiting dev. Drop a raw scope above to begin.
          </div>
        )}
      </div>

      {/* Document Viewer Modal */}
      {viewingProject && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', zIndex: 1000,
          display: 'flex', flexDirection: 'column', padding: '40px'
        }}>
          <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h3 className="panel-title">PMD Scope Review: {viewingProject}</h3>
              <div>
                <button onClick={() => pushToDev(viewingProject)} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: '4px', marginRight: '12px', cursor: 'pointer', fontWeight: 'bold' }}>
                  🚀 Looks Good — Push to Dev
                </button>
                <button onClick={() => setViewingProject(null)} style={{ background: 'transparent', color: '#ef4444', border: '1px solid currentColor', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>
                  Close
                </button>
              </div>
            </div>
            
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* File List */}
              <div style={{ width: '280px', borderRight: '1px solid rgba(255,255,255,0.1)', overflowY: 'auto', padding: '12px' }}>
                <h4 style={{ color: '#94a3b8', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '12px' }}>Generated Documents</h4>
                {projectDocs.length === 0 ? <p style={{ color: '#64748b', fontSize: '0.9rem' }}>No documents found.</p> : null}
                {projectDocs.map((doc, i) => (
                  <div 
                    key={i} 
                    onClick={() => viewDoc(viewingProject, doc.fullPath, doc)}
                    style={{
                      padding: '8px 12px',
                      marginBottom: '4px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      background: selectedDoc?.fullPath === doc.fullPath ? 'rgba(139,92,246,0.2)' : 'transparent',
                      color: selectedDoc?.fullPath === doc.fullPath ? '#c4b5fd' : '#cbd5e1',
                      borderLeft: `3px solid ${selectedDoc?.fullPath === doc.fullPath ? '#8b5cf6' : 'transparent'}`
                    }}
                  >
                    📄 {doc.name}
                  </div>
                ))}
              </div>
              
              {/* Markdown Content */}
              <div style={{ flex: 1, padding: '24px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', fontFamily: 'monospace', color: '#e2e8f0', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {docContent ? docContent : <span style={{color: '#64748b'}}>Select a document on the left to review...</span>}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default PreDev;
