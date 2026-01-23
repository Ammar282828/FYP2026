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
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('1990-01-01');
  const [endDate, setEndDate] = useState('1992-12-31');
  const [granularity, setGranularity] = useState('month');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const loadSuggestions = async () => {
    try {
      const response = await axios.get(`${API_BASE}/analytics/top-keywords?limit=50`);
      const keywords = response.data.keywords?.map((k: any) => k.keyword) || [];
      setSuggestions(keywords);
      if (keywords.length > 0 && !keyword) {
        setKeyword(keywords[0]);
      }
    } catch (error) {
      console.error('Failed to load keyword suggestions:', error);
    }
  };

  const loadData = async () => {
    if (!keyword) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        keyword,
        granularity,
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate })
      });
      const response = await axios.get(`${API_BASE}/analytics/keyword-frequency-over-time?${params}`);
      setData(response.data.data || []);
    } catch (error) {
      console.error('Failed to load keyword frequency:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuggestions();
  }, []);

  useEffect(() => {
    if (keyword) {
      loadData();
    }
  }, [keyword]);

  return (
    <div className="analytics-panel">
      <h3>Keyword Frequency Over Time</h3>
      <div className="keyword-input-section">
        <select
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="keyword-select"
        >
          <option value="">Select a keyword...</option>
          {suggestions.map((kw, idx) => (
            <option key={idx} value={kw}>{kw}</option>
          ))}
        </select>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Or type custom keyword..."
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
            <span>Peak: <strong>{Math.max(...data.map(d => d.count))} mentions</strong></span>
            <button
              onClick={() => exportToCSV(data, `keyword_${keyword}_frequency`)}
              className="export-button"
            >
              📥 Export CSV
            </button>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="count" stroke="#667eea" strokeWidth={2} name="Mentions" />
            </LineChart>
          </ResponsiveContainer>
        </>
      ) : (
        <p>No data found for "{keyword}"</p>
      )}
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
              📥 Export CSV
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
              📥 Export Comparison CSV
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
                  positive: stats.sentiment.positive,
                  neutral: stats.sentiment.neutral,
                  negative: stats.sentiment.negative
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
              📥 Export Location Data CSV
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
