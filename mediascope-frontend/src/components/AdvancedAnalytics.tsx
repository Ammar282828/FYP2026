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
import { API_BASE } from '../config';
import { exportToCSV } from '../utils/csvExport';
import { SkeletonChart } from './ui/Skeleton';
import { useDateBounds } from '../hooks/useDataVersion';

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

  const ctrlStyle = { padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', background: 'var(--bg-primary)' };
  const labelStyle = { fontSize: '13px', fontWeight: '600' as const, color: 'var(--text-primary)', marginRight: '8px' };

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
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Keyword Frequency Over Time</h3>

      {/* Search bar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') search(inputValue); }}
          placeholder="Type a keyword..."
          style={{ ...ctrlStyle, flex: 1, padding: '7px 12px' }}
        />
        <button
          onClick={() => search(inputValue)}
          style={{ padding: '7px 18px', borderRadius: '6px', border: 'none', background: 'var(--primary-color)', color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
        >
          Search
        </button>
      </div>

      {/* Suggestion pills */}
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
          {suggestions.slice(0, 20).map(kw => (
            <button
              key={kw}
              onClick={() => { setInputValue(kw); search(kw); }}
              style={{
                padding: '3px 10px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                border: `2px solid ${keyword === kw ? 'var(--primary-color)' : 'var(--border-color)'}`,
                background: keyword === kw ? 'var(--primary-color)' : 'var(--bg-primary)',
                color: keyword === kw ? 'white' : 'var(--text-primary)',
                fontWeight: keyword === kw ? '600' : '400',
              }}
            >
              {kw}
            </button>
          ))}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '1rem' }}>
        <div>
          <label style={labelStyle}>Granularity:</label>
          <select value={granularity} onChange={e => setGranularity(e.target.value)} style={ctrlStyle}>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
            <option value="day">Daily</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>From:</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={ctrlStyle} />
        </div>
        <div>
          <label style={labelStyle}>To:</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={ctrlStyle} />
        </div>
      </div>

      {loading ? (
        <SkeletonChart />
      ) : data.length > 0 ? (
        <>
          {/* Stats row */}
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', padding: '0.75rem 1rem', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd', fontSize: '13px' }}>
            <span>Total mentions: <strong style={{ color: '#0369a1' }}>{totalMentions.toLocaleString()}</strong></span>
            <span>Peak: <strong style={{ color: '#0369a1' }}>{peak} in one period</strong></span>
            <span style={{ marginLeft: 'auto' }}>
              <button onClick={() => exportToCSV(data, `keyword_${keyword}_frequency`)}
                style={{ padding: '3px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', fontSize: '12px', cursor: 'pointer' }}>
                Export CSV
              </button>
            </span>
          </div>
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" height={70} />
              <YAxis tick={{ fontSize: 11 }} label={{ value: 'Mentions', angle: -90, position: 'insideLeft', fontSize: 12 }} />
              <Tooltip contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '12px' }} />
              <Bar dataKey="count" fill="#3b82f6" name={`"${keyword}" mentions`} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </>
      ) : keyword ? (
        <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
          No mentions of <strong>"{keyword}"</strong> found in the selected date range.
        </div>
      ) : null}
    </div>
  );
};
