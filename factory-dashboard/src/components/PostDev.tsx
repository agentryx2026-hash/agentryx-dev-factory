import React, { useState, useEffect } from 'react';

const PostDev: React.FC = () => {
  const [workspaceFiles, setWorkspaceFiles] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [runOutput, setRunOutput] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>('http://localhost:5174'); // Default to the HPSEDC portal for now.
  const [iframeKey, setIframeKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const loadProjects = async () => {
    try {
      const res = await fetch('/telemetry/workspace/projects');
      const data = await res.json();
      setWorkspaceFiles(data.projects || []);
      setSelectedFile(null);
      setRunOutput('');
    } catch(e) { console.error(e); }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const renderFileTree = (tree: any[], projectName: string, depth = 0) => {
    return tree.map((item: any) => (
      <div key={item.path} style={{ paddingLeft: depth * 14 }}>
        {item.type === 'dir' ? (
          <div>
            <div style={{ color: '#94a3b8', fontSize: '0.8rem', padding: '2px 0', cursor: 'default' }}>📁 {item.name}</div>
            {item.children && renderFileTree(item.children, projectName, depth + 1)}
          </div>
        ) : (
          <div
            onClick={async (e) => {
              e.stopPropagation();
              try {
                const res = await fetch(`/telemetry/workspace/read?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(item.path)}`);
                const data = await res.json();
                setSelectedFile((prev: any) => ({ ...prev, _viewingFile: item.path, _fileContent: data.content }));
              } catch(err) { console.error(err); }
            }}
            style={{
              color: selectedFile?._viewingFile === item.path ? '#c4b5fd' : '#cbd5e1',
              fontSize: '0.8rem',
              padding: '2px 4px',
              cursor: 'pointer',
              borderRadius: '3px',
              background: selectedFile?._viewingFile === item.path ? 'rgba(139,92,246,0.15)' : 'transparent',
            }}
          >
            📄 {item.name}
          </div>
        )}
      </div>
    ));
  };

  return (
    <div className="fade-in" id="post-dev-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Post-Dev Release Hub</h1>
          <p className="page-subtitle">Manage, Review, and Deploy Completed Projects</p>
        </div>
      </div>

      <div className="glass-panel" style={{ marginTop: '16px' }}>
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="panel-title">📦 Projects — Generated Apps</h3>
          <button onClick={loadProjects} style={{ padding: '6px 16px', background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: '6px', color: '#c4b5fd', cursor: 'pointer', fontWeight: 'bold' }}>
            🔄 Refresh Releases
          </button>
        </div>
        <div className="panel-body">
          {workspaceFiles.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>No finished projects yet. Output from the Factory Floor will appear here.</p>
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                {workspaceFiles.map((proj: any) => (
                  <div
                    key={proj.name}
                    onClick={async () => {
                      try {
                        const res = await fetch(`/telemetry/workspace/files?project=${encodeURIComponent(proj.name)}`);
                        const data = await res.json();
                        setSelectedFile({ ...proj, tree: data.tree || [] });
                        setRunOutput('');
                      } catch(e) { console.error(e); }
                    }}
                    style={{
                      padding: '14px',
                      background: selectedFile?.name === proj.name ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.03)',
                      border: selectedFile?.name === proj.name ? '1px solid rgba(139,92,246,0.5)' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.9rem' }}>📁 {proj.name.replace(/^\d{4}-\d{2}-\d{2}_/, '')}</span>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        background: proj.status === 'PASS' ? 'rgba(34,197,94,0.2)' : proj.status === 'NEEDS_REVIEW' ? 'rgba(245,158,11,0.2)' : proj.status === 'COMPLETE' ? 'rgba(56,189,248,0.2)' : 'rgba(99,102,241,0.2)',
                        color: proj.status === 'PASS' ? '#4ade80' : proj.status === 'NEEDS_REVIEW' ? '#fbbf24' : proj.status === 'COMPLETE' ? '#38bdf8' : '#818cf8',
                        border: `1px solid ${proj.status === 'PASS' ? 'rgba(34,197,94,0.3)' : proj.status === 'NEEDS_REVIEW' ? 'rgba(245,158,11,0.3)' : proj.status === 'COMPLETE' ? 'rgba(56,189,248,0.3)' : 'rgba(99,102,241,0.3)'}`,
                      }}>
                        {proj.status === 'PASS' ? '✅ Passed QC' : proj.status === 'NEEDS_REVIEW' ? '⚠️ Review' : proj.status === 'COMPLETE' ? '📦 Ready' : '🔄 Dev Floor'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', color: '#64748b', fontSize: '0.75rem' }}>
                      <span>📄 {proj.fileCount} files</span>
                      <span>🕐 {new Date(proj.modified).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
                      {proj.hasReport && <span>📊 Factory Report</span>}
                    </div>
                  </div>
                ))}
              </div>

              {selectedFile?.tree && (
                <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '16px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                  <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(255,255,255,0.06)', maxHeight: '600px', overflow: 'auto' }}>
                    <div style={{ color: '#c4b5fd', fontWeight: 600, fontSize: '0.85rem', marginBottom: '8px' }}>Project Explorer</div>
                    {renderFileTree(selectedFile.tree, selectedFile.name)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    
                    {/* Toolbar for the Project */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <span style={{ color: '#c4b5fd', fontWeight: 'bold', fontSize: '0.85rem' }}>
                        {selectedFile._viewingFile ? `📄 ${selectedFile._viewingFile}` : 'No file selected'}
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={async () => {
                          try {
                            const res = await fetch('/telemetry/workspace/run', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ project: selectedFile.name, command: 'npm test 2>&1 || echo "No tests configured"' })
                            });
                            const data = await res.json();
                            setRunOutput(`Exit: ${data.exitCode}\n${data.output}`);
                          } catch(e) { setRunOutput('Run failed: ' + e); }
                        }} style={{ padding: '6px 12px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '6px', color: '#fbbf24', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                          🧪 Run Tests
                        </button>
                        <button onClick={async () => {
                          setRunOutput('Starting Preview Engine in background container...');
                          try {
                            const res = await fetch('/telemetry/workspace/run', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ project: selectedFile.name, command: 'npm run dev -- --port 8888 || npm start', background: true })
                            });
                            const data = await res.json();
                            setRunOutput(`App running on backend.\nProxy target: http://localhost:8888\n\nApp preview rendering...\n${data.message}`);
                            setPreviewUrl('http://localhost:8888');
                          } catch(e) { 
                            setRunOutput('Run failed: ' + e); 
                            setPreviewUrl('http://localhost:5174'); // fallback
                          }
                        }} style={{ padding: '6px 12px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                          ▶ Initialize Workspace
                        </button>
                        <button style={{ padding: '6px 12px', background: 'rgba(56,189,248,0.2)', border: '1px solid rgba(56,189,248,0.4)', borderRadius: '6px', color: '#38bdf8', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                          ☁️ Deploy
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '16px', height: '100%' }}>
                      
                      {/* Code Viewer Panel - Resizable */}
                      <div style={{ 
                        display: 'block', 
                        resize: previewUrl ? 'horizontal' : 'none', 
                        overflow: 'auto', 
                        width: previewUrl ? '50%' : '100%', 
                        minWidth: '300px', 
                        maxWidth: '85%',
                        paddingRight: '12px',
                        marginRight: '-8px', // Compensate for the gap visually
                        borderRight: previewUrl ? '3px solid rgba(139,92,246,0.3)' : 'none',
                        position: 'relative'
                      }}>
                        {/* Drag handle hint for user */}
                        {previewUrl && (
                          <div style={{ position: 'absolute', right: '2px', bottom: '2px', color: '#8b5cf6', fontSize: '18px', pointerEvents: 'none' }}>↘</div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                          {selectedFile._viewingFile ? (
                            <pre style={{ background: 'rgba(0,0,0,0.5)', padding: '16px', borderRadius: '8px', color: '#a5f3fc', fontSize: '0.85rem', overflow: 'auto', maxHeight: '500px', border: '1px solid rgba(255,255,255,0.08)', lineHeight: 1.5, margin: 0, flexGrow: 1 }}>
                              {selectedFile._fileContent || 'Loading...'}
                            </pre>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', color: '#64748b', fontSize: '1rem', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '8px', flexGrow: 1 }}>
                              ← Select a file from the explorer to preview
                            </div>
                          )}
                          {runOutput && (
                            <div style={{ marginTop: '16px' }}>
                              <span style={{ color: '#34d399', fontWeight: 'bold', fontSize: '0.85rem' }}>Console Output:</span>
                              <pre style={{ background: 'rgba(0,0,0,0.7)', padding: '16px', borderRadius: '8px', color: '#fbbf24', fontSize: '0.85rem', marginTop: '8px', border: '1px solid rgba(52,211,153,0.3)', maxHeight: '200px', overflow: 'auto', lineHeight: 1.5 }}>
                                {runOutput}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Interactive App Preview WebView */}
                      {previewUrl && (
                        <div style={{ 
                          border: isFullscreen ? 'none' : '1px solid #334155', 
                          borderRadius: isFullscreen ? '0' : '12px', 
                          overflow: 'hidden', 
                          background: '#0f172a', 
                          display: 'flex', 
                          flexDirection: 'column', 
                          height: isFullscreen ? '100vh' : '100%', 
                          minHeight: '500px', 
                          flex: 1, 
                          minWidth: '300px',
                          ...(isFullscreen ? {
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            zIndex: 9999,
                            width: '100vw'
                          } : {})
                        }}>
                          <div style={{ padding: '10px 16px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexGrow: 1 }}>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444' }}></div>
                                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#f59e0b' }}></div>
                                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#10b981' }}></div>
                              </div>
                              <input type="text" value={previewUrl} readOnly style={{ marginLeft: '10px', color: '#94a3b8', fontSize: '0.8rem', fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '4px 8px', flexGrow: 1 }} />
                            </div>
                            
                            <div style={{ display: 'flex', gap: '12px', marginLeft: '16px', alignItems: 'center' }}>
                              <button onClick={() => setIframeKey(k => k + 1)} title="Manual Refresh" style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center' }}>
                                🔄
                              </button>
                              <button onClick={() => window.open(previewUrl, '_blank')} title="Open in New Tab" style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center' }}>
                                ↗️
                              </button>
                              <button onClick={() => setIsFullscreen(!isFullscreen)} title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center' }}>
                                {isFullscreen ? '↙️' : '🔲'}
                              </button>
                              <button onClick={() => { setPreviewUrl(null); setIsFullscreen(false); }} title="Close Preview" style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', marginLeft: '4px' }}>
                                ✖
                              </button>
                            </div>
                          </div>
                          {/* Key change: using an iframe for exactly what Replit does */}
                          <iframe 
                            key={iframeKey}
                            src={previewUrl} 
                            style={{ width: '100%', height: '100%', border: 'none', flexGrow: 1, background: '#fff' }} 
                            title="App Testing Preview"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                          />
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PostDev;
