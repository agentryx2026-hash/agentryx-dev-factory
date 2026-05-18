import React, { useState } from 'react';
import PresetSelect from './PresetSelect';

/**
 * Founder R&D Brief form — Phase 21-A.1.
 *
 * 8 fields composed into a structured prompt by the backend:
 *   Title · Role · Background · Research question · Trigger ·
 *   Constraints · Output format · References + Budget + Priority area
 *
 * Two PresetSelect drop-downs (Role, Output format) cover the 70-80%
 * common cases with a Custom… escape hatch (per founder direction).
 */

const ROLE_PRESETS = [
  { value: 'Senior research analyst specializing in tools, MCP servers, and agent infrastructure.',
    label: 'Tool researcher', hint: 'MCP, IDEs, integrations' },
  { value: 'Senior research analyst specializing in foundation models, fine-tuning, and LLM routing.',
    label: 'Model researcher', hint: 'LLMs, routing, fine-tune' },
  { value: 'Senior architecture analyst comparing our codebase against competing patterns and frameworks.',
    label: 'Architecture analyst', hint: 'patterns, frameworks, ROI' },
  // Phase 21-A.1 — Seven (Tool Evaluator). See cognitive-engine/agents/Seven.SOUL.md.
  // Distinct from the three research roles above: Seven measures, probes, and
  // benchmarks rather than surveys. Output is always a structured Evaluation
  // Report (table of measurements + adversarial security probes + baseline
  // comparison + verdict).
  { value: 'You are SEVEN — the Tool Evaluator agent (R&D pipeline). Operate per cognitive-engine/agents/Seven.SOUL.md: evidence over impression, first-hand only, comparative not absolute, adversarial on security claims, reproducible. Produce a structured Evaluation Report with a measurements table, adversarial security probes, and a comparison-to-baseline section against our current implementation. Cite specific Phase modules. Output one ranked verdict (swap / augment / pass / re-evaluate) with rationale.',
    label: 'Seven — Tool Evaluator', hint: 'first-hand benchmarks + adversarial security probes' },
];

const OUTPUT_PRESETS = [
  { value: 'Comparison table — rows = options, columns = criteria, with a 1-paragraph recommendation at the end.',
    label: 'Comparison table' },
  { value: 'Decision memo — 1-page narrative: problem, options considered, recommendation with rationale.',
    label: 'Decision memo' },
  { value: 'Ranked options — list of options sorted by fit, each with one-line pros/cons + a clear pick.',
    label: 'Ranked options' },
];

const PRIORITY_AREAS = ['models', 'agents', 'languages', 'tools', 'output_quality', 'operations'] as const;

interface Props {
  busy: boolean;
  onSubmit: (form: any) => Promise<void>;
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '8px 10px',
  color: '#e2e8f0',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
const textareaStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical', minHeight: 60, lineHeight: 1.5 };

const Field: React.FC<{ label: string; required?: boolean; hint?: string; children: React.ReactNode }> = ({ label, required, hint, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
    <span style={{ color: '#94a3b8', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {label}{required && <span style={{ color: '#f87171' }}> *</span>}
    </span>
    {children}
    {hint && <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{hint}</span>}
  </label>
);

const BriefForm: React.FC<Props> = ({ busy, onSubmit }) => {
  const [title, setTitle] = useState('');
  const [role, setRole] = useState(ROLE_PRESETS[0].value);
  const [background, setBackground] = useState('');
  const [researchQuestion, setResearchQuestion] = useState('');
  const [trigger, setTrigger] = useState('');
  const [constraints, setConstraints] = useState('');
  const [outputFormat, setOutputFormat] = useState(OUTPUT_PRESETS[1].value);
  const [referencesText, setReferencesText] = useState('');
  const [budgetUsd, setBudgetUsd] = useState(3);
  const [priorityArea, setPriorityArea] = useState('');

  const valid = title.trim() && researchQuestion.trim() && role && outputFormat;

  const submit = async () => {
    const refs = referencesText
      .split('\n').map(s => s.trim()).filter(Boolean);
    await onSubmit({
      title: title.trim(),
      role,
      background: background.trim(),
      research_question: researchQuestion.trim(),
      trigger: trigger.trim(),
      constraints: constraints.trim(),
      output_format: outputFormat,
      references: refs,
      budget_usd: budgetUsd,
      priority_area: priorityArea || undefined,
    });
    // Reset on success
    setTitle('');
    setBackground('');
    setResearchQuestion('');
    setTrigger('');
    setConstraints('');
    setReferencesText('');
  };

  return (
    <div className="glass-panel" style={{ marginBottom: 20 }}>
      <div className="panel-header">
        <h3 className="panel-title">🔬 New R&D Brief</h3>
        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>founder-driven · ad-hoc research</span>
      </div>
      <div className="panel-body">
        <Field label="Brief title" required hint="header of the report + history list entry">
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Should we adopt Hermes 4 in place of LangGraph?" style={inputStyle} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Role / Persona" required hint="3 presets + Custom…">
            <PresetSelect
              presets={ROLE_PRESETS}
              value={role}
              onChange={setRole}
              customPlaceholder="e.g. Senior security analyst…"
            />
          </Field>
          <Field label="Output format" required hint="how the report should be shaped">
            <PresetSelect
              presets={OUTPUT_PRESETS}
              value={outputFormat}
              onChange={setOutputFormat}
              customMultiline
              customPlaceholder="Describe the desired output structure"
            />
          </Field>
        </div>

        <Field label="Background / Context" hint="ground the agent in our current state">
          <textarea value={background} onChange={e => setBackground(e.target.value)} rows={3} placeholder="e.g. We use LangGraph 0.2.x. Phase 2.75 evaluated Hermes; verdict was hybrid adoption…" style={textareaStyle} />
        </Field>

        <Field label="Research question" required hint="the actual ask">
          <textarea value={researchQuestion} onChange={e => setResearchQuestion(e.target.value)} rows={3} placeholder="e.g. Should we replace LangGraph with Hermes 4 for our pipeline?" style={textareaStyle} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Why now / Trigger" hint="what prompted this">
            <input type="text" value={trigger} onChange={e => setTrigger(e.target.value)} placeholder="e.g. Hermes 4 just shipped" style={inputStyle} />
          </Field>
          <Field label="Constraints / Scope" hint="boundaries, must-haves">
            <input type="text" value={constraints} onChange={e => setConstraints(e.target.value)} placeholder="e.g. Must keep OpenRouter fallback; no rewrite" style={inputStyle} />
          </Field>
        </div>

        <Field label="Anchors / References" hint="URLs, repos, docs — one per line (optional)">
          <textarea value={referencesText} onChange={e => setReferencesText(e.target.value)} rows={2} placeholder="https://github.com/NousResearch/hermes-agent" style={textareaStyle} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
          <Field label="Budget (USD)">
            <input type="number" min={0.5} step={0.5} value={budgetUsd} onChange={e => setBudgetUsd(Number(e.target.value))} style={inputStyle} />
          </Field>
          <Field label="Priority area (optional tag)">
            <select value={priorityArea} onChange={e => setPriorityArea(e.target.value)} style={inputStyle}>
              <option value="">— untagged —</option>
              {PRIORITY_AREAS.map(a => <option key={a} value={a}>{a.replace('_',' ')}</option>)}
            </select>
          </Field>
        </div>

        <button
          onClick={submit}
          disabled={!valid || busy}
          style={{
            width: '100%',
            padding: 12,
            marginTop: 10,
            background: valid && !busy ? 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)' : 'rgba(100,116,139,0.2)',
            border: 'none',
            borderRadius: 8,
            color: valid && !busy ? '#fff' : '#64748b',
            fontWeight: 700,
            cursor: valid && !busy ? 'pointer' : 'not-allowed',
            fontSize: '0.9rem',
          }}
        >
          {busy ? '⏳ Architect running brief…' : '📤 Submit Brief (architect runs in background)'}
        </button>
      </div>
    </div>
  );
};

export default BriefForm;
