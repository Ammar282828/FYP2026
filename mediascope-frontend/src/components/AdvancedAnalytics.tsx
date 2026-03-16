import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { API_BASE } from '../config';
import { exportToCSV, exportComparisonToCSV, exportLocationDataToCSV } from '../utils/csvExport';

// Date Range Selector Component
export const DateRangeSelector: React.FC<{
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  granularity?: string;
  onGranularityChange?: (granularity: string) => void;
}> = ({ startDate, endDate, onStartDateChange, onEndDateChange, granularity, onGranularityChange }) => {
  return (
    <div className="date-range-selector">
      <div className="date-input-group">
        <label>Start Date:</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          className="date-input"
        />
      </div>
      <div className="date-input-group">
        <label>End Date:</label>
        <input
          type="date"
          value={endDate}
          onChange={(e) => onEndDateChange(e.target.value)}
          className="date-input"
        />
      </div>
      {granularity && onGranularityChange && (
        <div className="date-input-group">
          <label>Granularity:</label>
          <select
            value={granularity}
            onChange={(e) => onGranularityChange(e.target.value)}
            className="granularity-select"
          >
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
      )}
    </div>
  );
};

// Keyword Frequency Over Time
export const KeywordFrequencyOverTime: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('1990-01-01');
  const [endDate, setEndDate] = useState('1992-12-31');
  const [granularity, setGranularity] = useState('month');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const ctrlStyle = { padding: '5px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', background: 'white' };
  const labelStyle = { fontSize: '13px', fontWeight: '600' as const, color: '#374151', marginRight: '8px' };

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
          style={{ padding: '7px 18px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: 'white', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}
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
                border: `2px solid ${keyword === kw ? '#3b82f6' : '#d1d5db'}`,
                background: keyword === kw ? '#3b82f6' : 'white',
                color: keyword === kw ? 'white' : '#374151',
                fontWeight: keyword === kw ? '600' : '400',
              }}
            >
              {kw}
            </button>
          ))}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.75rem 1rem', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb', marginBottom: '1rem' }}>
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
        <p style={{ margin: '1rem 0', fontSize: '14px', color: '#6b7280' }}>Loading...</p>
      ) : data.length > 0 ? (
        <>
          {/* Stats row */}
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', padding: '0.75rem 1rem', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd', fontSize: '13px' }}>
            <span>Total mentions: <strong style={{ color: '#0369a1' }}>{totalMentions.toLocaleString()}</strong></span>
            <span>Peak: <strong style={{ color: '#0369a1' }}>{peak} in one period</strong></span>
            <span style={{ marginLeft: 'auto' }}>
              <button onClick={() => exportToCSV(data, `keyword_${keyword}_frequency`)}
                style={{ padding: '3px 12px', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', fontSize: '12px', cursor: 'pointer' }}>
                Export CSV
              </button>
            </span>
          </div>
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" height={70} />
              <YAxis tick={{ fontSize: 11 }} label={{ value: 'Mentions', angle: -90, position: 'insideLeft', fontSize: 12 }} />
              <Tooltip contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '12px' }} />
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

// Entity Mentions Over Time with Sentiment
export const EntityMentionsOverTime: React.FC = () => {
  const [entity, setEntity] = useState('');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('1990-01-01');
  const [endDate, setEndDate] = useState('1992-12-31');
  const [granularity, setGranularity] = useState('month');
  const [suggestions, setSuggestions] = useState<any[]>([]);

  const loadSuggestions = async () => {
    try {
      const response = await axios.get(`${API_BASE}/analytics/top-entities-fixed?limit=50`);
      const entities = response.data.entities || [];
      setSuggestions(entities);
      if (entities.length > 0 && !entity) {
        setEntity(entities[0].text);
      }
    } catch (error) {
      console.error('Failed to load entity suggestions:', error);
    }
  };

  const loadData = async () => {
    if (!entity) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        entity,
        granularity,
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate })
      });
      const response = await axios.get(`${API_BASE}/analytics/entity-mentions-over-time?${params}`);
      setData(response.data.data || []);
    } catch (error) {
      console.error('Failed to load entity mentions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuggestions();
  }, []);

  useEffect(() => {
    if (entity) {
      loadData();
    }
  }, [entity]);

  return (
    <div className="analytics-panel">
      <h3>Entity Mentions Over Time</h3>
      <div className="keyword-input-section">
        <select
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          className="keyword-select"
        >
          <option value="">Select an entity...</option>
          {suggestions.map((ent, idx) => (
            <option key={idx} value={ent.text}>{ent.text} ({ent.type})</option>
          ))}
        </select>
        <input
          type="text"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          placeholder="Or type custom entity..."
          className="keyword-input"
        />
        <button onClick={loadData} className="search-button">Analyze</button>
      </div>

      <DateRangeSelector
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      {loading ? (
        <p>Loading...</p>
      ) : data.length > 0 ? (
        <>
          <div className="stats-summary">
            <span>Total Mentions: <strong>{data.reduce((sum, d) => sum + d.count, 0)}</strong></span>
            <span>Avg Sentiment: <strong>{(data.reduce((sum, d) => sum + d.sentiment_score, 0) / data.length).toFixed(2)}</strong></span>
            <button
              onClick={() => exportToCSV(data, `entity_${entity}_mentions`)}
              className="export-button"
            >
              Export CSV
            </button>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="positive" stackId="1" stroke="#10b981" fill="#10b981" name="Positive" />
              <Area type="monotone" dataKey="neutral" stackId="1" stroke="#94a3b8" fill="#94a3b8" name="Neutral" />
              <Area type="monotone" dataKey="negative" stackId="1" stroke="#ef4444" fill="#ef4444" name="Negative" />
            </AreaChart>
          </ResponsiveContainer>
        </>
      ) : (
        <p>No data found for "{entity}"</p>
      )}
    </div>
  );
};

// Multi-Entity Comparison
export const MultiEntityComparison: React.FC = () => {
  const [entities, setEntities] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('1990-01-01');
  const [endDate, setEndDate] = useState('1992-12-31');
  const [suggestions, setSuggestions] = useState<any[]>([]);

  const presetComparisons = [
    'Benazir Bhutto,Nawaz Sharif,Zia ul Haq',
    'Pakistan,India,Afghanistan',
    'Israel,Palestine,Lebanon',
    'USSR,America,Iraq'
  ];

  const loadSuggestions = async () => {
    try {
      const response = await axios.get(`${API_BASE}/analytics/top-entities-fixed?limit=30`);
      const entities = response.data.entities || [];
      setSuggestions(entities);
      // Set default to first preset
      if (!entities.length && presetComparisons.length > 0) {
        setEntities(presetComparisons[0]);
      }
    } catch (error) {
      console.error('Failed to load entity suggestions:', error);
    }
  };

  const loadData = async () => {
    if (!entities) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        entities,
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate })
      });
      const response = await axios.get(`${API_BASE}/analytics/compare-entities?${params}`);
      setData(response.data.comparison || {});
    } catch (error) {
      console.error('Failed to load entity comparison:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuggestions();
  }, []);

  useEffect(() => {
    if (entities) {
      loadData();
    }
  }, [entities]);

  return (
    <div className="analytics-panel">
      <h3>Compare Entities</h3>
      <div className="comparison-preset-section">
        <label>Preset Comparisons:</label>
        <div className="preset-buttons">
          {presetComparisons.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => setEntities(preset)}
              className={`preset-button ${entities === preset ? 'active' : ''}`}
            >
              {preset.split(',').join(' vs ')}
            </button>
          ))}
        </div>
      </div>
      <div className="keyword-input-section">
        <input
          type="text"
          value={entities}
          onChange={(e) => setEntities(e.target.value)}
          placeholder="Enter entities separated by commas (max 5)..."
          className="keyword-input"
        />
        <button onClick={loadData} className="search-button">Compare</button>
      </div>

      <DateRangeSelector
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
      />

      {loading ? (
        <p>Loading...</p>
      ) : data && Object.keys(data).length > 0 ? (
        <div className="entity-comparison-results">
          <div style={{ marginBottom: '1rem', textAlign: 'right' }}>
            <button
              onClick={() => exportComparisonToCSV(data, entities.split(',').map(e => e.trim()), 'entity_comparison')}
              className="export-button"
            >
              Export Comparison CSV
            </button>
          </div>
          <div className="comparison-charts">
            <div className="chart-section">
              <h4>Total Mentions</h4>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={Object.entries(data).map(([name, stats]: [string, any]) => ({
                  name,
                  mentions: stats.total_mentions
                }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="mentions" fill="#667eea" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-section">
              <h4>Sentiment Comparison</h4>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={Object.entries(data).map(([name, stats]: [string, any]) => ({
                  name,
                  positive: stats.sentiment?.positive || 0,
                  neutral: stats.sentiment?.neutral || 0,
                  negative: stats.sentiment?.negative || 0
                }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="positive" stackId="a" fill="#10b981" name="Positive" />
                  <Bar dataKey="neutral" stackId="a" fill="#94a3b8" name="Neutral" />
                  <Bar dataKey="negative" stackId="a" fill="#ef4444" name="Negative" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="entity-details-grid">
            {Object.entries(data).map(([name, stats]: [string, any]) => (
              <div key={name} className="entity-detail-card">
                <h4>{name}</h4>
                <div className="detail-stats">
                  <div className="stat-item">
                    <span className="stat-label">Total Mentions:</span>
                    <span className="stat-value">{stats.total_mentions}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Sentiment Score:</span>
                    <span className={`stat-value ${stats.sentiment.score > 0 ? 'positive' : stats.sentiment.score < 0 ? 'negative' : 'neutral'}`}>
                      {stats.sentiment.score.toFixed(2)}
                    </span>
                  </div>
                </div>
                {stats.top_topics && stats.top_topics.length > 0 && (
                  <div className="top-topics">
                    <strong>Top Topics:</strong>
                    <ul>
                      {stats.top_topics.map(([topic, count]: [string, number], idx: number) => (
                        <li key={idx}>{topic} ({count})</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p>Enter entity names to compare (separated by commas)</p>
      )}
    </div>
  );
};

// Topic Volume Over Time
export const TopicVolumeOverTime: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('1990-01-01');
  const [endDate, setEndDate] = useState('1992-12-31');
  const [granularity, setGranularity] = useState('month');

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        granularity,
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate })
      });
      const response = await axios.get(`${API_BASE}/analytics/topic-volume-over-time?${params}`);
      setData(response.data.data || []);
    } catch (error) {
      console.error('Failed to load topic volume:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="analytics-panel">
      <h3>Topic Volume Over Time</h3>

      <DateRangeSelector
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      <button onClick={loadData} className="search-button">Refresh</button>

      {loading ? (
        <p>Loading...</p>
      ) : data.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            {Object.keys(data[0]).filter(key => key !== 'date').map((topic, idx) => (
              <Area
                key={topic}
                type="monotone"
                dataKey={topic}
                stackId="1"
                stroke={`hsl(${idx * 60}, 70%, 50%)`}
                fill={`hsl(${idx * 60}, 70%, 60%)`}
                name={topic}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <p>No topic data available</p>
      )}
    </div>
  );
};

// Location Analytics
export const LocationAnalytics: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('1990-01-01');
  const [endDate, setEndDate] = useState('1992-12-31');
  const [selectedLocation, setSelectedLocation] = useState<any>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate })
      });
      const response = await axios.get(`${API_BASE}/analytics/location-analytics?${params}`);
      setData(response.data.locations || []);
    } catch (error) {
      console.error('Failed to load location analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="analytics-panel">
      <h3>Geographic Analytics</h3>

      <DateRangeSelector
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
      />

      <button onClick={loadData} className="search-button">Refresh</button>

      {loading ? (
        <p>Loading...</p>
      ) : data.length > 0 ? (
        <>
          <div style={{ marginBottom: '1rem', textAlign: 'right' }}>
            <button
              onClick={() => exportLocationDataToCSV(data, 'location_analytics')}
              className="export-button"
            >
              Export Location Data CSV
            </button>
          </div>
          <div className="location-grid">
            {data.slice(0, 10).map((location, idx) => (
              <div
                key={idx}
                className={`location-card ${selectedLocation === location ? 'selected' : ''}`}
                onClick={() => setSelectedLocation(location === selectedLocation ? null : location)}
              >
                <div className="location-rank">#{idx + 1}</div>
                <h4>{location.location}</h4>
                <div className="location-stats">
                  <span className="stat-item">{location.total_mentions} mentions</span>
                  <span className={`sentiment-score ${location.sentiment_score > 0 ? 'positive' : location.sentiment_score < 0 ? 'negative' : 'neutral'}`}>
                    Sentiment: {location.sentiment_score.toFixed(2)}
                  </span>
                </div>
                {location.top_topics && location.top_topics.length > 0 && (
                  <div className="location-topics">
                    <strong>Topics:</strong> {location.top_topics.map(([t]: [string, number]) => t).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          {selectedLocation && (
            <div className="location-detail-panel">
              <h4>{selectedLocation.location} - Timeline</h4>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={selectedLocation.timeline}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#667eea" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      ) : (
        <p>No location data available</p>
      )}
    </div>
  );
};
