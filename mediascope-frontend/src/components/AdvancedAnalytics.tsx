/**
 * AdvancedAnalytics — historically a kitchen-sink module with five widgets.
 *
 * Most of those widgets had been superseded by interactive equivalents in
 * EnhancedAnalytics / ProfessionalAnalytics, never imported anywhere, and
 * still pulling in heavy chart kinds (Area, multi-axis Bar, etc). They were
 * pruned to keep the bundle lean and the module focused.
 *
 * Only `KeywordFrequencyOverTime` remains — it's the one imported by the
 * dashboard's Keywords sub-tab. The widget now supports comparing multiple
 * keywords simultaneously: each gets its own bar series at every period.
 */
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Download, Tag } from 'lucide-react';
import { API_BASE } from '../config';
import { exportToCSV } from '../utils/csvExport';
import { SkeletonChart } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import { useDateBounds } from '../hooks/useDataVersion';
import { TOOLTIP_STYLE, TOOLTIP_CURSOR, AXIS_STYLE } from '../theme/chartTheme';

// Keyword Frequency Over Time — supports comparing multiple keywords.
export const KeywordFrequencyOverTime: React.FC = () => {
  const [minBound, maxBound] = useDateBounds();
  const [inputValue, setInputValue] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  // Map keyword → period → count, so the chart row builder can pull each
  // keyword's value for every period in one pass.
  const [series, setSeries] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(minBound);
  const [endDate, setEndDate] = useState(maxBound);
  const [granularity, setGranularity] = useState('month');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Newspaper-toned palette, same hues used by other multi-series charts
  // on this page so the keyword colours feel consistent across tabs.
  const COLORS = ['#8b3a1f', '#5a7a3e', '#a87a3e', '#3b2a1c', '#7a4a2c', '#c47b5a', '#a89378', '#6e5a3a', '#9c5a3c', '#8a7a62'];

  // Seed with the corpus' top keyword on first load so the chart isn't
  // empty when the user opens the tab.
  useEffect(() => {
    axios.get(`${API_BASE}/analytics/top-keywords?limit=30`)
      .then(r => {
        const kws: string[] = r.data.keywords?.map((k: any) => k.keyword) || [];
        setSuggestions(kws);
        if (kws.length > 0 && keywords.length === 0) {
          setKeywords([kws[0]]);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch all currently-selected keywords in parallel; merge into a
  // single chart-friendly dictionary indexed by period.
  const loadAll = async () => {
    if (keywords.length === 0) {
      setSeries({});
      return;
    }
    setLoading(true);
    try {
      const responses = await Promise.all(
        keywords.map(kw => {
          const params = new URLSearchParams({ keyword: kw, granularity, start_date: startDate, end_date: endDate });
          return axios.get(`${API_BASE}/analytics/keyword-frequency-over-time?${params}`)
            .then(r => [kw, r.data.data || []] as [string, any[]])
            .catch(() => [kw, []] as [string, any[]]);
        })
      );
      const next: Record<string, Record<string, number>> = {};
      for (const [kw, points] of responses) {
        next[kw] = {};
        for (const p of points) {
          if (typeof p.count === 'number') next[kw][p.date] = p.count;
        }
      }
      setSeries(next);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [keywords.join('|'), granularity, startDate, endDate]);

  const addKeyword = (raw: string) => {
    const kw = raw.trim().toLowerCase();
    if (!kw || keywords.includes(kw)) return;
    setKeywords([...keywords, kw]);
  };
  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter(k => k !== kw));
  };

  // Build the rows recharts needs: one object per period, each keyword
  // its own numeric field. Periods are the union across all keywords
  // so a term first seen in 1990-06 doesn't compress the x-axis for
  // a term that runs all year.
  const chartData = (() => {
    const periods = new Set<string>();
    for (const kw of keywords) for (const p of Object.keys(series[kw] || {})) periods.add(p);
    return Array.from(periods).sort().map(date => {
      const row: any = { date };
      for (const kw of keywords) {
        row[kw] = series[kw]?.[date] ?? 0;
      }
      return row;
    });
  })();

  const totalMentions = chartData.reduce((sum, row) => {
    let s = 0;
    for (const kw of keywords) s += (row[kw] || 0);
    return sum + s;
  }, 0);
  const peak = chartData.length > 0
    ? Math.max(...chartData.flatMap(row => keywords.map(kw => row[kw] || 0)))
    : 0;

  return (
    <div className="stack">
      <div className="section-header">
        <div className="section-title">Keyword Frequency Over Time</div>
      </div>

      {/* Add-keyword bar */}
      <div className="cluster">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              addKeyword(inputValue);
              setInputValue('');
            }
          }}
          placeholder="Type a keyword and press Enter…"
          className="kw-search-input"
        />
        <button
          onClick={() => { addKeyword(inputValue); setInputValue(''); }}
          className="btn btn--primary"
        >
          Add
        </button>
      </div>

      {/* Selected keyword pills — colored swatches with × to remove */}
      {keywords.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: '-0.4rem' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginRight: 6 }}>
            Showing:
          </span>
          {keywords.map((kw, idx) => (
            <span
              key={kw}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px 4px 12px', borderRadius: 20, fontSize: 12,
                background: COLORS[idx % COLORS.length], color: 'white', fontWeight: 600,
              }}
            >
              {kw}
              <button
                onClick={() => removeKeyword(kw)}
                aria-label={`Remove ${kw}`}
                style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Suggestion pills — click to toggle */}
      {suggestions.length > 0 && (
        <div className="kw-cloud">
          {suggestions.slice(0, 20).map(kw => {
            const active = keywords.includes(kw);
            return (
              <button
                key={kw}
                onClick={() => (active ? removeKeyword(kw) : addKeyword(kw))}
                className={`kw-pill${active ? ' kw-pill--selected' : ''}`}
              >
                {kw}
              </button>
            );
          })}
        </div>
      )}

      {/* Controls */}
      <div className="card card--inset card--quiet kw-controls">
        <label className="kw-control">
          <span className="kw-control__label">Granularity</span>
          <select value={granularity} onChange={e => setGranularity(e.target.value)} className="kw-control__input">
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
            <option value="day">Daily</option>
          </select>
        </label>
        <label className="kw-control">
          <span className="kw-control__label">From</span>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="kw-control__input" />
        </label>
        <label className="kw-control">
          <span className="kw-control__label">To</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="kw-control__input" />
        </label>
      </div>

      {loading ? (
        <SkeletonChart />
      ) : chartData.length > 0 && keywords.length > 0 ? (
        <>
          {/* Stats row */}
          <div className="stat-grid">
            <div className="stat-card stat-card--accent">
              <span className="stat-label">Total mentions</span>
              <span className="stat-value">{totalMentions.toLocaleString()}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Peak in one period</span>
              <span className="stat-value">{peak.toLocaleString()}</span>
            </div>
            <div className="stat-card" style={{ justifyContent: 'center' }}>
              <button
                onClick={() => exportToCSV(chartData, `keywords_${keywords.join('_')}_frequency`)}
                className="btn btn--sm"
              >
                <Download size={14} aria-hidden /> Export CSV
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis dataKey="date" tick={AXIS_STYLE} angle={-40} textAnchor="end" height={70} />
              <YAxis tick={AXIS_STYLE} label={{ value: 'Mentions', angle: -90, position: 'insideLeft', fontSize: 12, fill: 'var(--text-tertiary)' }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={TOOLTIP_CURSOR} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              {keywords.map((kw, idx) => (
                <Bar
                  key={kw}
                  dataKey={kw}
                  fill={COLORS[idx % COLORS.length]}
                  name={`"${kw}"`}
                  radius={[3, 3, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </>
      ) : (
        <EmptyState
          icon={<Tag size={28} aria-hidden />}
          title={keywords.length === 0 ? 'Add a keyword to start' : `No mentions in this window`}
          description="Try widening the date range, switching granularity, or picking a more common keyword from the suggestions above."
        />
      )}
    </div>
  );
};
