/**
 * DateRangePicker — two date inputs plus quick presets.
 *
 * The presets are domain-aware: the corpus is the Dawn newspaper archive from
 * the early 1990s, so we offer "Full archive", "1990", "1991", "1992", and
 * "Gulf War (Aug 1990 – Feb 1991)" — much more useful than a generic
 * "Last 7 days" preset would be.
 *
 * Usage:
 *   const [from, setFrom] = useState(minDate);
 *   const [to, setTo] = useState(maxDate);
 *   <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
 */
import React from 'react';
import { useDateBounds } from '../../hooks/useDataVersion';

interface Props {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  showPresets?: boolean;
  compact?: boolean;
}

interface Preset {
  label: string;
  from: string;
  to: string;
}

const HISTORICAL_PRESETS: Preset[] = [
  { label: '1990', from: '1990-01-01', to: '1990-12-31' },
  { label: '1991', from: '1991-01-01', to: '1991-12-31' },
  { label: '1992', from: '1992-01-01', to: '1992-12-31' },
  { label: 'Gulf War', from: '1990-08-02', to: '1991-02-28' },
];

export const DateRangePicker: React.FC<Props> = ({
  from,
  to,
  onChange,
  showPresets = true,
  compact = false,
}) => {
  const [minBound, maxBound] = useDateBounds();

  const presets: Preset[] = [
    { label: 'Full archive', from: minBound, to: maxBound },
    ...HISTORICAL_PRESETS,
  ];

  const inputStyle: React.CSSProperties = {
    padding: compact ? '4px 8px' : '6px 10px',
    fontSize: compact ? 12 : 13,
    border: '1px solid var(--border-color)',
    borderRadius: 4,
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        gap: '0.5rem',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <input
        type="date"
        value={from}
        min={minBound}
        max={maxBound}
        onChange={e => onChange(e.target.value, to)}
        style={inputStyle}
        aria-label="Start date"
      />
      <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>→</span>
      <input
        type="date"
        value={to}
        min={minBound}
        max={maxBound}
        onChange={e => onChange(from, e.target.value)}
        style={inputStyle}
        aria-label="End date"
      />
      {showPresets && (
        <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {presets.map(p => {
            const active = from === p.from && to === p.to;
            return (
              <button
                key={p.label}
                onClick={() => onChange(p.from, p.to)}
                style={{
                  padding: compact ? '3px 8px' : '4px 10px',
                  fontSize: 12,
                  borderRadius: 12,
                  border: '1px solid var(--border-color)',
                  background: active ? 'var(--primary-color)' : 'var(--bg-secondary)',
                  color: active ? '#fff' : 'var(--text-primary)',
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DateRangePicker;
