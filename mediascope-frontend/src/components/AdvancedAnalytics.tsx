/**
 * AdvancedAnalytics — historically a kitchen-sink module with five widgets.
 *
 * Most of those widgets had been superseded by interactive equivalents in
 * EnhancedAnalytics / ProfessionalAnalytics, never imported anywhere, and
 * still pulling in heavy chart kinds (Area, multi-axis Bar, etc). They were
 * pruned to keep the bundle lean and the module focused.
 *
 * Only `KeywordFrequencyOverTime` remains — it's the one imported by the
 * dashboard's Keywords sub-tab.
 */
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Search, Download, Tag } from 'lucide-react';
import { API_BASE } from '../config';
import { exportToCSV } from '../utils/csvExport';
import { SkeletonChart } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import { useDateBounds } from '../hooks/useDataVersion';
import { TOOLTIP_STYLE, TOOLTIP_CURSOR, AXIS_STYLE } from '../theme/chartTheme';

// Keyword Frequency Over Time
export const KeywordFrequencyOverTime: React.FC = () => {
  const [minBound, maxBound] = useDateBounds();
  const [inputValue, setInputValue] = useState('');
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(minBound);
  const [endDate, setEndDate] = useState(maxBound);
  const [granularity, setGranularity] = useState('month');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    axios.get(`${API_BASE}/analytics/top-keywords?limit=30`)
      .then(r => {
        const kws: string[] = r.data.keywords?.map((k: any) => k.keyword) || [];
        setSuggestions(kws);
        if (kws.length > 0) { setInputValue(kws[0]); setKeyword(kws[0]); }
      })
      .catch(() => {});
  }, []);

  const search = async (kw: string) => {
    if (!kw.trim()) return;
    setKeyword(kw.trim());
    setLoading(true);
    try {
      const params = new URLSearchParams({ keyword: kw.trim(), granularity, start_date: startDate, end_date: endDate });
      const response = await axios.get(`${API_BASE}/analytics/keyword-frequency-over-time?${params}`);
      setData(response.data.data || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (keyword) search(keyword); }, [granularity, startDate, endDate]);

  const totalMentions = data.reduce((s, d) => s + d.count, 0);
  const peak = data.length > 0 ? Math.max(...data.map(d => d.count)) : 0;

  return (
    <div className="stack">
      <div className="section-header">
        <div className="section-title">Keyword Frequency Over Time</div>
      </div>

      {/* Search bar */}
      <div className="cluster">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') search(inputValue); }}
          placeholder="Type a keyword..."
          className="kw-search-input"
        />
        <button onClick={() => search(inputValue)} className="btn btn--primary">
          <Search size={14} aria-hidden /> Search
        </button>
      </div>

      {/* Suggestion pills */}
      {suggestions.length > 0 && (
        <div className="kw-cloud">
          {suggestions.slice(0, 20).map(kw => (
            <button
              key={kw}
              onClick={() => { setInputValue(kw); search(kw); }}
              className={`kw-pill${keyword === kw ? ' kw-pill--selected' : ''}`}
            >
              {kw}
            </button>
          ))}
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
      ) : data.length > 0 ? (
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
                onClick={() => exportToCSV(data, `keyword_${keyword}_frequency`)}
                className="btn btn--sm"
              >
                <Download size={14} aria-hidden /> Export CSV
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis dataKey="date" tick={AXIS_STYLE} angle={-40} textAnchor="end" height={70} />
              <YAxis tick={AXIS_STYLE} label={{ value: 'Mentions', angle: -90, position: 'insideLeft', fontSize: 12, fill: 'var(--text-tertiary)' }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={TOOLTIP_CURSOR} />
              <Bar dataKey="count" fill="var(--primary-color)" name={`"${keyword}" mentions`} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </>
      ) : keyword ? (
        <EmptyState
          icon={<Tag size={28} aria-hidden />}
          title={`No mentions of "${keyword}" in this window`}
          description="Try widening the date range, switching granularity, or picking a more common keyword from the suggestions above."
        />
      ) : null}
    </div>
  );
};
