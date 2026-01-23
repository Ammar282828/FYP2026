import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

const API_BASE = 'http://localhost:8000/api';

export const ArticlesOverTime: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await axios.get(`${API_BASE}/analytics/articles-over-time`);
        setData(response.data.timeline || []);
      } catch (error) {
        console.error('Failed to load articles over time:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) return <p>Loading...</p>;
  if (data.length === 0) return <p>No data available</p>;

  return (
    <div>
      <h3>Articles Published Over Time</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
        Monthly publication volume showing when newspapers were processed and archived
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="count" fill="#3b82f6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export const SentimentOverTime: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await axios.get(`${API_BASE}/analytics/sentiment-over-time`);
        setData(response.data.timeline || []);
      } catch (error) {
        console.error('Failed to load sentiment over time:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) return <p>Loading...</p>;
  if (data.length === 0) return <p>No data available</p>;

  return (
    <div>
      <h3>Sentiment Trends Over Time</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
        AI-analyzed sentiment showing how positive, neutral, and negative coverage evolved month-by-month
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="positive" stroke="#10b981" strokeWidth={2} />
          <Line type="monotone" dataKey="neutral" stroke="#6b7280" strokeWidth={2} />
          <Line type="monotone" dataKey="negative" stroke="#ef4444" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export const TopKeywordsCloud: React.FC = () => {
  const [keywords, setKeywords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await axios.get(`${API_BASE}/analytics/top-keywords`);
        setKeywords(response.data.keywords || []);
      } catch (error) {
        console.error('Failed to load keywords:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) return <p>Loading...</p>;
  if (keywords.length === 0) return <p>No keywords available</p>;

  const maxFreq = Math.max(...keywords.map(k => k.frequency));

  return (
    <div>
      <h3>Top Keywords</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
        Most frequently mentioned words across all articles (larger = more frequent)
      </p>
      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap', 
        gap: '12px', 
        padding: '20px',
        justifyContent: 'center'
      }}>
        {keywords.map((kw, idx) => {
          const size = 12 + (kw.frequency / maxFreq) * 24;
          const opacity = 0.4 + (kw.frequency / maxFreq) * 0.6;
          return (
            <span
              key={idx}
              style={{
                fontSize: `${size}px`,
                color: '#3b82f6',
                opacity,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              title={`${kw.frequency} mentions`}
            >
              {kw.keyword}
            </span>
          );
        })}
      </div>
    </div>
  );
};
