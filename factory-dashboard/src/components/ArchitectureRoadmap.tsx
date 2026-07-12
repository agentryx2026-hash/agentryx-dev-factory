import React, { useEffect, useState, useCallback } from 'react';

/**
 * Architecture & Roadmap — single-pane control panel for the dev plan.
 * Replaces "read 24 per-phase markdown docs to know where we are".
 *
 * Backend: /api/factory-admin/roadmap/{summary, bands, phases, phases/:id,
 *          tasks, tasks (POST), tasks/:id (PATCH/DELETE), tasks/:id/move,
 *          tasks/:id/reenable, history}
 * Data:    _roadmap/{phases.json, bands.json, tasks.json, _history.jsonl}
 *
 * Sub-tabs:
 *   Roadmap        — band cards (v0.0.1 → R5) with % complete + open count
 *   <band>         — one tab per release band (v0.0.1, R1, R1+, R2, R3, R4, R5);
 *                    each shows band header + phases-in-band grid + tasks-in-band table
 *   Phase Detail   — single phase metadata + task list with inline actions (drill-in)
 *   History        — recent audit-log entries (creates / patches / moves)
 *
 * Naming convention for new phases (R2+): use prefixed IDs like `R2.1.1`, `R3.1.2`.
 * Existing phases (`phase-01` → `phase-22`) keep their identifiers — band lives in `band_id`.
 *
 * Interactive actions per task:
 *   - status change (pending / in_progress / blocked / done / obsolete)
 *   - move to another phase
 *   - re-enable completed (status: done → in_progress for enhancement)
 *   - edit title + notes
 *   - create new task on a phase
 *   - soft-delete (status: obsolete; preserved in tasks.json + history)
 *
 * All mutations go through PATCH/POST and append to _history.jsonl.
 */

type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done' | 'obsolete';
type PhaseStatus = 'pending' | 'in_progress' | 'partial' | 'done' | 'blocked';

interface Band {
  id: string;
  semver: string;
  label: string;
  status: string;
  achieved_at?: string;
  achieved_tag?: string;
  description?: string;
  task_counts?: { total: number; done: number; in_progress: number; blocked: number; pending: number };
  percent_done?: number;
}

interface Phase {
  id: string;
  number: string;
  name: string;
  tier?: string;
  status: PhaseStatus;
  band_id?: string;
  narrative_doc?: string | null;
  note?: string;
  validated_by?: string;
}

interface Task {
  id: string;
  phase_id: string;
  band_id: string;
  title: string;
  status: TaskStatus;
  notes?: string;
  git_tag?: string;
  pr?: number;
  shipped_at?: string;
  decision_id?: string;
}

interface Summary {
  phases: { total: number; by_status: Record<string, number> };
  bands: Band[];
  tasks: { total: number; by_status: Record<string, number> };
  updated_at: string;
}

type TabKey = 'roadmap' | 'phase-detail' | 'history' | `band:${string}`;

// ─── styling ────────────────────────────────────────────────────────────
const sectionStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.6)',
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: '12px',
  padding: '20px 24px',
  marginBottom: '20px',
};
const labelStyle: React.CSSProperties = {
  fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase',
  letterSpacing: '0.5px', fontWeight: 600, marginBottom: '8px',
};
const cellStyle: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };

const TASK_STATUS_META: Record<string, { bg: string; fg: string; label: string }> = {
  pending:     { bg: 'rgba(100,116,139,0.2)', fg: '#cbd5e1', label: 'Pending' },
  in_progress: { bg: 'rgba(245,158,11,0.2)',  fg: '#fde68a', label: 'In Progress' },
  blocked:     { bg: 'rgba(239,68,68,0.2)',   fg: '#fca5a5', label: 'Blocked' },
  done:        { bg: 'rgba(16,185,129,0.2)',  fg: '#6ee7b7', label: 'Done' },
  obsolete:    { bg: 'rgba(100,116,139,0.1)', fg: '#64748b', label: 'Obsolete' },
};
const PHASE_STATUS_META: Record<string, { bg: string; fg: string; label: string }> = {
  pending:     { bg: 'rgba(100,116,139,0.2)', fg: '#cbd5e1', label: 'Pending' },
  in_progress: { bg: 'rgba(245,158,11,0.2)',  fg: '#fde68a', label: 'In Progress' },
  partial:     { bg: 'rgba(168,85,247,0.2)',  fg: '#d8b4fe', label: 'Partial' },
  done:        { bg: 'rgba(16,185,129,0.2)',  fg: '#6ee7b7', label: 'Done' },
  blocked:     { bg: 'rgba(239,68,68,0.2)',   fg: '#fca5a5', label: 'Blocked' },
};
const pill = (status: string, kind: 'task' | 'phase' = 'task'): React.CSSProperties => {
  const meta = (kind === 'phase' ? PHASE_STATUS_META : TASK_STATUS_META)[status] || TASK_STATUS_META.pending;
  return {
    padding: '2px 8px', borderRadius: '4px',
    background: meta.bg, color: meta.fg, fontSize: '0.72rem', fontWeight: 600,
  };
};
const pillLabel = (status: string, kind: 'task' | 'phase' = 'task'): string =>
  (kind === 'phase' ? PHASE_STATUS_META : TASK_STATUS_META)[status]?.label || status;

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  background: active ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
  color: active ? '#a5b4fc' : '#94a3b8',
  border: `1px solid ${active ? 'rgba(99, 102, 241, 0.3)' : 'transparent'}`,
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: active ? 600 : 400,
});
const smallBtn: React.CSSProperties = {
  background: 'rgba(100, 116, 139, 0.2)', color: '#cbd5e1',
  border: '1px solid rgba(100, 116, 139, 0.3)', borderRadius: '4px',
  padding: '3px 10px', cursor: 'pointer', fontSize: '0.75rem', marginRight: '6px',
};
const primaryBtn: React.CSSProperties = {
  background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc',
  border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '4px',
  padding: '3px 10px', cursor: 'pointer', fontSize: '0.75rem', marginRight: '6px',
};
const dangerBtn: React.CSSProperties = {
  background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5',
  border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '4px',
  padding: '3px 10px', cursor: 'pointer', fontSize: '0.75rem', marginRight: '6px',
};
const selectStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.8)', color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px',
  padding: '3px 6px', fontSize: '0.78rem',
};

// ─── component ──────────────────────────────────────────────────────────
const ArchitectureRoadmap: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('roadmap');
  const [summary, setSummary]   = useState<Summary | null>(null);
  const [phases, setPhases]     = useState<Phase[]>([]);
  const [tasks, setTasks]       = useState<Task[]>([]);
  const [openPhaseId, setOpenPhaseId] = useState<string | null>(null);
  const [busy, setBusy]         = useState<string | null>(null);
  const [err, setErr]           = useState<string | null>(null);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);
  const [history, setHistory]   = useState<any[]>([]);

  const flash = (msg: string) => { setFlashMsg(msg); setTimeout(() => setFlashMsg(null), 4000); };

  const loadAll = useCallback(async () => {
    try {
      const [sumRes, phasesRes, tasksRes] = await Promise.all([
        fetch('/telemetry/factory-admin/roadmap/summary'),
        fetch('/telemetry/factory-admin/roadmap/phases'),
        fetch('/telemetry/factory-admin/roadmap/tasks'),
      ]);
      const sum = await sumRes.json();
      const ph  = await phasesRes.json();
      const tk  = await tasksRes.json();
      if (!sumRes.ok)   throw new Error(sum?.error || `summary HTTP ${sumRes.status}`);
      if (!phasesRes.ok) throw new Error(ph?.error || `phases HTTP ${phasesRes.status}`);
      if (!tasksRes.ok) throw new Error(tk?.error || `tasks HTTP ${tasksRes.status}`);
      setSummary(sum);
      setPhases(ph.phases || []);
      setTasks(tk.tasks || []);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/telemetry/factory-admin/roadmap/history?limit=100');
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `history HTTP ${res.status}`);
      setHistory(body.history || []);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (tab === 'history') loadHistory(); }, [tab, loadHistory]);

  // ── task mutations ────────────────────────────────────────────────────
  const patchTask = async (taskId: string, patch: Partial<Task>, successMsg: string) => {
    setBusy(taskId);
    try {
      const res = await fetch(`/telemetry/factory-admin/roadmap/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      flash(successMsg);
      await loadAll();
    } catch (e: any) {
      setErr(`Update failed: ${e?.message || String(e)}`);
    } finally { setBusy(null); }
  };
  const moveTask = async (taskId: string, newPhaseId: string, newBandId?: string) => {
    setBusy(taskId);
    try {
      const res = await fetch(`/telemetry/factory-admin/roadmap/tasks/${encodeURIComponent(taskId)}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: newPhaseId, band_id: newBandId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      flash(`Moved ${taskId} → ${newPhaseId}`);
      await loadAll();
    } catch (e: any) {
      setErr(`Move failed: ${e?.message || String(e)}`);
    } finally { setBusy(null); }
  };
  const reenableTask = async (taskId: string) => {
    setBusy(taskId);
    try {
      const res = await fetch(`/telemetry/factory-admin/roadmap/tasks/${encodeURIComponent(taskId)}/reenable`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      flash(`Re-enabled ${taskId} for enhancement`);
      await loadAll();
    } catch (e: any) {
      setErr(`Re-enable failed: ${e?.message || String(e)}`);
    } finally { setBusy(null); }
  };
  const deleteTask = async (taskId: string) => {
    if (!window.confirm(`Soft-delete ${taskId}? (preserved as status=obsolete; can be undone via patch)`)) return;
    setBusy(taskId);
    try {
      const res = await fetch(`/telemetry/factory-admin/roadmap/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      flash(`Deleted ${taskId} (status: obsolete)`);
      await loadAll();
    } catch (e: any) {
      setErr(`Delete failed: ${e?.message || String(e)}`);
    } finally { setBusy(null); }
  };
  const createTask = async (phaseId: string, defaultBandId: string) => {
    const title = window.prompt('New task title:');
    if (!title || !title.trim()) return;
    const bandInput = window.prompt(`Band id (default: ${defaultBandId})\n\nValid: ${summary?.bands.map(b => b.id).join(', ')}`, defaultBandId);
    if (!bandInput) return;
    setBusy('create');
    try {
      const res = await fetch('/telemetry/factory-admin/roadmap/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: phaseId, band_id: bandInput.trim(), title: title.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      flash(`Created ${body.task.id}`);
      await loadAll();
    } catch (e: any) {
      setErr(`Create failed: ${e?.message || String(e)}`);
    } finally { setBusy(null); }
  };
  const editNotes = async (taskId: string, current?: string) => {
    const next = window.prompt('Task notes:', current || '');
    if (next === null) return;  // cancel
    await patchTask(taskId, { notes: next || undefined } as any, `Updated notes for ${taskId}`);
  };
  const editTitle = async (taskId: string, current: string) => {
    const next = window.prompt('Task title:', current);
    if (!next || !next.trim()) return;
    await patchTask(taskId, { title: next.trim() }, `Updated title for ${taskId}`);
  };

  // ─── tabs ────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 32px', color: '#e2e8f0' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0, color: '#f1f5f9' }}>Architecture &amp; Roadmap</h1>
        <p style={{ color: '#94a3b8', marginTop: '4px' }}>
          Single-pane view of the 22-phase dev plan + the R1→R5 release trajectory. Edit tasks, move them between phases, re-enable completed work for enhancement.
          {summary && <> · Last update: <span style={{ color: '#cbd5e1' }}>{new Date(summary.updated_at).toLocaleString()}</span></>}
        </p>
      </div>

      {/* tab strip */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px', flexWrap: 'wrap' }}>
        <button onClick={() => setTab('roadmap')} style={tabBtn(tab === 'roadmap')}>🛣️ Bands Overview</button>
        {(summary?.bands || []).map(b => {
          const key: TabKey = `band:${b.id}`;
          const isDone = b.status === 'done';
          const dot = isDone ? '✅' : b.status === 'in_progress' ? '🟡' : '⚪';
          return (
            <button key={b.id} onClick={() => setTab(key)} style={tabBtn(tab === key)} title={b.label}>
              {dot} {b.id}
            </button>
          );
        })}
        {openPhaseId && <button onClick={() => setTab('phase-detail')} style={tabBtn(tab === 'phase-detail')}>🔍 Phase Detail · {openPhaseId}</button>}
        <button onClick={() => setTab('history')} style={tabBtn(tab === 'history')}>🕐 History</button>
      </div>

      {flashMsg && (
        <div style={{ ...sectionStyle, background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)', color: '#6ee7b7' }}>{flashMsg}</div>
      )}
      {err && (
        <div style={{ ...sectionStyle, background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>{err}</div>
      )}

      {/* ── ROADMAP tab — band cards ──────────────────────────── */}
      {tab === 'roadmap' && summary && (
        <div>
          <div style={sectionStyle}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
              <Stat label="Phases" value={summary.phases.total} />
              <Stat label="Tasks total" value={summary.tasks.total} />
              <Stat label="Tasks done" value={summary.tasks.by_status?.done ?? 0} color="#6ee7b7" />
              <Stat label="In progress" value={summary.tasks.by_status?.in_progress ?? 0} color="#fde68a" />
              <Stat label="Pending" value={summary.tasks.by_status?.pending ?? 0} />
              <Stat label="Blocked" value={summary.tasks.by_status?.blocked ?? 0} color={(summary.tasks.by_status?.blocked || 0) > 0 ? '#fca5a5' : '#94a3b8'} />
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={labelStyle}>Release bands</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
              {summary.bands.map(b => {
                const isDone = b.status === 'done';
                return (
                  <div key={b.id}
                    onClick={() => setTab(`band:${b.id}`)}
                    style={{
                      background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '8px', padding: '14px 16px', cursor: 'pointer',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'monospace', color: '#a5b4fc', fontSize: '0.85rem' }}>{b.semver}</span>
                      <span style={pill(isDone ? 'done' : (b.status === 'in_progress' ? 'in_progress' : 'pending'))}>{isDone ? 'Achieved' : b.status}</span>
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '0.95rem', color: '#f1f5f9', fontWeight: 500 }}>{b.label}</div>
                    {b.description && <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '6px', lineHeight: 1.4 }}>{b.description}</div>}
                    <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <div style={{ width: `${b.percent_done ?? 0}%`, height: '100%', background: isDone ? '#10b981' : '#fbbf24', transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontSize: '0.78rem', color: '#cbd5e1', fontFamily: 'monospace', minWidth: '60px', textAlign: 'right' }}>
                        {b.task_counts?.done ?? 0}/{b.task_counts?.total ?? 0} ({b.percent_done ?? 0}%)
                      </span>
                    </div>
                    {b.achieved_at && (
                      <div style={{ marginTop: '8px', fontSize: '0.72rem', color: '#64748b' }}>
                        Achieved: {b.achieved_at}{b.achieved_tag && <> · tag <code>{b.achieved_tag}</code></>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── PER-BAND tab — band header + phases-in-band + tasks-in-band ── */}
      {tab.startsWith('band:') && summary && (() => {
        const bandId = tab.slice('band:'.length);
        const band = summary.bands.find(b => b.id === bandId);
        if (!band) return <div style={sectionStyle}>Band <code>{bandId}</code> not found.</div>;
        const bandPhases = phases.filter(p => p.band_id === bandId);
        const bandTasks  = tasks.filter(t => t.band_id === bandId);
        const isDone = band.status === 'done';
        return (
          <div>
            {/* Band header */}
            <div style={sectionStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'monospace', color: '#a5b4fc', fontSize: '0.85rem' }}>{band.semver}</div>
                  <h2 style={{ fontSize: '1.4rem', margin: '4px 0 0 0', color: '#f1f5f9' }}>{band.label}</h2>
                  {band.description && <div style={{ marginTop: '8px', fontSize: '0.88rem', color: '#cbd5e1', lineHeight: 1.5 }}>{band.description}</div>}
                  {band.achieved_at && (
                    <div style={{ marginTop: '10px', fontSize: '0.78rem', color: '#64748b' }}>
                      Achieved: <span style={{ color: '#6ee7b7' }}>{band.achieved_at}</span>
                      {band.achieved_tag && <> · tag <code style={{ color: '#6ee7b7' }}>{band.achieved_tag}</code></>}
                    </div>
                  )}
                </div>
                <div style={{ minWidth: '180px', textAlign: 'right' }}>
                  <span style={pill(isDone ? 'done' : (band.status === 'in_progress' ? 'in_progress' : 'pending'))}>
                    {isDone ? 'Achieved' : band.status}
                  </span>
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{ width: `${band.percent_done ?? 0}%`, height: '100%', background: isDone ? '#10b981' : '#fbbf24' }} />
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '0.78rem', color: '#cbd5e1', fontFamily: 'monospace' }}>
                      {band.task_counts?.done ?? 0}/{band.task_counts?.total ?? 0} tasks ({band.percent_done ?? 0}%)
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Phases in band */}
            <div style={sectionStyle}>
              <div style={labelStyle}>Phases in {band.id} ({bandPhases.length})</div>
              {bandPhases.length === 0 && <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No phases assigned to this band yet.</div>}
              {bandPhases.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                  {bandPhases.map(p => {
                    const taskCount = tasks.filter(t => t.phase_id === p.id).length;
                    const doneCount = tasks.filter(t => t.phase_id === p.id && t.status === 'done').length;
                    return (
                      <div key={p.id}
                        onClick={() => { setOpenPhaseId(p.id); setTab('phase-detail'); }}
                        style={{
                          background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(255,255,255,0.06)',
                          borderRadius: '8px', padding: '14px 16px', cursor: 'pointer',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'monospace', color: '#a5b4fc', fontSize: '0.8rem' }}>Phase {p.number}</span>
                          <span style={pill(p.status, 'phase')}>{pillLabel(p.status, 'phase')}</span>
                        </div>
                        <div style={{ marginTop: '6px', fontSize: '0.95rem', color: '#f1f5f9', fontWeight: 500 }}>{p.name}</div>
                        <div style={{ marginTop: '6px', fontSize: '0.72rem', color: '#94a3b8' }}>
                          Tier {p.tier || '?'} · {doneCount}/{taskCount} tasks done
                        </div>
                        {p.note && <div style={{ marginTop: '6px', fontSize: '0.72rem', color: '#64748b', lineHeight: 1.4, fontStyle: 'italic' }}>{p.note}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tasks in band */}
            <AllTasksView tasks={bandTasks} phases={phases} bands={summary.bands} lockedBandId={bandId} onOpenPhase={(pid) => { setOpenPhaseId(pid); setTab('phase-detail'); }} />
          </div>
        );
      })()}

      {/* ── PHASE DETAIL tab ───────────────────────────────────── */}
      {tab === 'phase-detail' && openPhaseId && (() => {
        const phase = phases.find(p => p.id === openPhaseId);
        if (!phase) return <div style={sectionStyle}>Phase not found.</div>;
        const phaseTasks = tasks.filter(t => t.phase_id === openPhaseId).sort((a, b) => String(b.id).localeCompare(String(a.id)));
        return (
          <div>
            <div style={sectionStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
                <div>
                  <div style={{ fontFamily: 'monospace', color: '#a5b4fc', fontSize: '0.78rem' }}>Phase {phase.number} · Tier {phase.tier || '?'}</div>
                  <h2 style={{ fontSize: '1.3rem', margin: '4px 0 0 0', color: '#f1f5f9' }}>{phase.name}</h2>
                  <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={pill(phase.status, 'phase')}>{pillLabel(phase.status, 'phase')}</span>
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Band <code>{phase.band_id || '-'}</code></span>
                  </div>
                  {phase.note && <div style={{ marginTop: '12px', fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5 }}>{phase.note}</div>}
                  {phase.validated_by && <div style={{ marginTop: '8px', fontSize: '0.78rem', color: '#6ee7b7' }}>Validated by: {phase.validated_by}</div>}
                  {phase.narrative_doc && <div style={{ marginTop: '8px', fontSize: '0.72rem', color: '#64748b' }}>Narrative: <code>{phase.narrative_doc}</code></div>}
                </div>
                <div>
                  <button onClick={() => createTask(phase.id, phase.band_id || 'R1+')} disabled={busy === 'create'} style={primaryBtn}>+ New task</button>
                  <button onClick={() => { const bid = phase.band_id; setOpenPhaseId(null); setTab(bid ? `band:${bid}` : 'roadmap'); }} style={smallBtn}>← Back to {phase.band_id || 'overview'}</button>
                </div>
              </div>
            </div>

            <div style={sectionStyle}>
              <div style={labelStyle}>Tasks ({phaseTasks.length})</div>
              {phaseTasks.length === 0 && <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No tasks yet. Add one with "+ New task" above.</div>}
              {phaseTasks.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th style={cellStyle}>ID</th>
                      <th style={cellStyle}>Title + notes</th>
                      <th style={cellStyle}>Band</th>
                      <th style={cellStyle}>Status</th>
                      <th style={cellStyle}>Shipped / Refs</th>
                      <th style={cellStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phaseTasks.map(t => (
                      <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ ...cellStyle, fontFamily: 'monospace', color: '#a5b4fc' }}>{t.id}</td>
                        <td style={cellStyle}>
                          <div onClick={() => editTitle(t.id, t.title)} style={{ cursor: 'pointer' }} title="Click to edit">{t.title}</div>
                          {t.notes && <div onClick={() => editNotes(t.id, t.notes)} style={{ marginTop: '4px', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.4, cursor: 'pointer' }} title="Click to edit notes">{t.notes}</div>}
                          {!t.notes && <div onClick={() => editNotes(t.id)} style={{ marginTop: '2px', fontSize: '0.7rem', color: '#475569', cursor: 'pointer', fontStyle: 'italic' }}>+ add notes</div>}
                        </td>
                        <td style={cellStyle}>
                          <select value={t.band_id} onChange={(e) => patchTask(t.id, { band_id: e.target.value }, `${t.id} → ${e.target.value}`)} disabled={busy === t.id} style={selectStyle}>
                            {(summary?.bands || []).map(b => <option key={b.id} value={b.id}>{b.id}</option>)}
                          </select>
                        </td>
                        <td style={cellStyle}>
                          <select value={t.status} onChange={(e) => patchTask(t.id, { status: e.target.value as TaskStatus }, `${t.id} → ${e.target.value}`)} disabled={busy === t.id} style={selectStyle}>
                            <option value="pending">pending</option>
                            <option value="in_progress">in_progress</option>
                            <option value="blocked">blocked</option>
                            <option value="done">done</option>
                            <option value="obsolete">obsolete</option>
                          </select>
                        </td>
                        <td style={cellStyle}>
                          {t.shipped_at && <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{t.shipped_at}</div>}
                          {t.git_tag && <div style={{ fontSize: '0.72rem', color: '#6ee7b7', fontFamily: 'monospace' }}>{t.git_tag}</div>}
                          {t.pr && <a href={`https://github.com/agentryx2026-hash/agentryx-dev-factory/pull/${t.pr}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', color: '#a5b4fc', textDecoration: 'none' }}>#{t.pr}</a>}
                          {t.decision_id && <div style={{ fontSize: '0.72rem', color: '#fde68a', fontFamily: 'monospace' }}>{t.decision_id}</div>}
                        </td>
                        <td style={cellStyle}>
                          {t.status === 'done' && <button onClick={() => reenableTask(t.id)} disabled={busy === t.id} style={primaryBtn} title="Set back to in_progress for enhancement">Re-enable</button>}
                          <select onChange={(e) => { if (e.target.value && e.target.value !== t.phase_id) moveTask(t.id, e.target.value); }} value="" disabled={busy === t.id} style={{ ...selectStyle, width: '110px' }}>
                            <option value="">Move to…</option>
                            {phases.filter(p => p.id !== t.phase_id).map(p => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}
                          </select>
                          <button onClick={() => deleteTask(t.id)} disabled={busy === t.id} style={{ ...dangerBtn, marginLeft: '6px' }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── HISTORY tab ─────────────────────────────────────────── */}
      {tab === 'history' && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={labelStyle}>Recent audit log ({history.length})</div>
            <button onClick={loadHistory} style={smallBtn}>↻ Refresh</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '600px', overflowY: 'auto' }}>
            {history.length === 0 && <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No history yet.</div>}
            {history.map((h, i) => (
              <div key={i} style={{ background: 'rgba(2,6,23,0.6)', padding: '8px 12px', borderRadius: '6px', fontSize: '0.78rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span style={{ fontFamily: 'monospace' }}>{h.kind || '?'}</span>
                  <span>{new Date(h.at).toLocaleString()}</span>
                </div>
                <div style={{ color: '#cbd5e1', marginTop: '4px' }}>
                  {h.task_id && <span style={{ fontFamily: 'monospace', color: '#a5b4fc' }}>{h.task_id}</span>}
                  {h.note && <span style={{ marginLeft: '6px' }}>{h.note}</span>}
                  {h.patch && <span style={{ marginLeft: '6px', fontFamily: 'monospace', color: '#fde68a' }}>{JSON.stringify(h.patch)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── All Tasks subview ───────────────────────────────────────────────────
const AllTasksView: React.FC<{
  tasks: Task[]; phases: Phase[]; bands: Band[]; onOpenPhase: (pid: string) => void;
  lockedBandId?: string;
}> = ({ tasks, phases, bands, onOpenPhase, lockedBandId }) => {
  const [filter, setFilter] = useState({ status: '', band: '', q: '' });
  const filtered = tasks.filter(t =>
    (!filter.status || t.status === filter.status) &&
    (!filter.band   || t.band_id === filter.band) &&
    (!filter.q || t.title.toLowerCase().includes(filter.q.toLowerCase()) || (t.notes || '').toLowerCase().includes(filter.q.toLowerCase()))
  ).sort((a, b) => String(b.id).localeCompare(String(a.id)));
  return (
    <div style={sectionStyle}>
      <div style={labelStyle}>{lockedBandId ? `Tasks in ${lockedBandId}` : 'Tasks'} ({filtered.length}{filtered.length !== tasks.length && ` of ${tasks.length}`})</div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input placeholder="Search…" value={filter.q} onChange={(e) => setFilter(f => ({ ...f, q: e.target.value }))}
          style={{ ...selectStyle, flex: 1, minWidth: '200px', padding: '6px 10px' }} />
        <select value={filter.status} onChange={(e) => setFilter(f => ({ ...f, status: e.target.value }))} style={selectStyle}>
          <option value="">all statuses</option>
          {Object.keys(TASK_STATUS_META).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {!lockedBandId && (
          <select value={filter.band} onChange={(e) => setFilter(f => ({ ...f, band: e.target.value }))} style={selectStyle}>
            <option value="">all bands</option>
            {bands.map(b => <option key={b.id} value={b.id}>{b.id}</option>)}
          </select>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <th style={cellStyle}>ID</th>
            <th style={cellStyle}>Phase</th>
            <th style={cellStyle}>Title</th>
            <th style={cellStyle}>Band</th>
            <th style={cellStyle}>Status</th>
            <th style={cellStyle}>Refs</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(t => {
            const phase = phases.find(p => p.id === t.phase_id);
            return (
              <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ ...cellStyle, fontFamily: 'monospace', color: '#a5b4fc' }}>{t.id}</td>
                <td style={cellStyle}>
                  <span onClick={() => onOpenPhase(t.phase_id)} style={{ cursor: 'pointer', color: '#cbd5e1', textDecoration: 'underline' }}>
                    {phase?.number}. {phase?.name || t.phase_id}
                  </span>
                </td>
                <td style={cellStyle}>{t.title}</td>
                <td style={{ ...cellStyle, fontFamily: 'monospace', color: '#94a3b8' }}>{t.band_id}</td>
                <td style={cellStyle}><span style={pill(t.status)}>{pillLabel(t.status)}</span></td>
                <td style={cellStyle}>
                  {t.git_tag && <div style={{ fontSize: '0.72rem', color: '#6ee7b7', fontFamily: 'monospace' }}>{t.git_tag}</div>}
                  {t.pr && <a href={`https://github.com/agentryx2026-hash/agentryx-dev-factory/pull/${t.pr}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', color: '#a5b4fc', textDecoration: 'none' }}>#{t.pr}</a>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: any; color?: string }> = ({ label, value, color }) => (
  <div>
    <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
    <div style={{ fontSize: '1.5rem', fontWeight: 600, color: color || '#f1f5f9' }}>{value}</div>
  </div>
);

export default ArchitectureRoadmap;
