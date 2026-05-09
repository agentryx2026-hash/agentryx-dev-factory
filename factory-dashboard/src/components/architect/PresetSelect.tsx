import React from 'react';

/**
 * Dropdown with 3 presets covering the common 70-80% of cases + a
 * "Custom…" option that reveals a free-text input below. Used wherever the
 * Master Architect page needs a typed-but-extensible field (Role,
 * Output format, Research depth, Dispatcher).
 *
 * Selection logic: if the current value matches one of the presets,
 * the dropdown shows that preset. Otherwise it switches to "Custom…"
 * and renders the textarea/input prefilled with the value.
 */

export interface Preset {
  label: string;
  value: string;
  hint?: string;
}

interface Props {
  presets: Preset[];
  value: string;
  onChange: (val: string) => void;
  customPlaceholder?: string;
  customMultiline?: boolean;
  customRows?: number;
  disabled?: boolean;
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

const PresetSelect: React.FC<Props> = ({
  presets,
  value,
  onChange,
  customPlaceholder = 'Type a custom value…',
  customMultiline = false,
  customRows = 3,
  disabled,
}) => {
  // Find which preset (if any) the current value matches
  const matchedPreset = presets.find(p => p.value === value);
  const isCustom = !matchedPreset && value !== '';
  const selectedKey = matchedPreset ? matchedPreset.value : (isCustom ? '__custom__' : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        disabled={disabled}
        value={selectedKey}
        onChange={e => {
          const next = e.target.value;
          if (next === '__custom__') {
            // Switching to custom — preserve current free-text if any, else empty
            onChange(isCustom ? value : '');
          } else if (next === '') {
            onChange('');
          } else {
            onChange(next);
          }
        }}
        style={inputStyle}
      >
        <option value="" style={{ color: '#64748b' }}>— Select —</option>
        {presets.map(p => (
          <option key={p.value} value={p.value}>{p.label}{p.hint ? ` · ${p.hint}` : ''}</option>
        ))}
        <option value="__custom__">✎ Custom…</option>
      </select>
      {(isCustom || selectedKey === '__custom__') && (
        customMultiline ? (
          <textarea
            disabled={disabled}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={customPlaceholder}
            rows={customRows}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 60, lineHeight: 1.5 }}
          />
        ) : (
          <input
            type="text"
            disabled={disabled}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={customPlaceholder}
            style={inputStyle}
          />
        )
      )}
      {matchedPreset?.hint && (
        <div style={{ color: '#64748b', fontSize: '0.7rem' }}>{matchedPreset.hint}</div>
      )}
    </div>
  );
};

export default PresetSelect;
