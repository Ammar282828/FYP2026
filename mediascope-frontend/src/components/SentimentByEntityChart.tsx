import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Removed - using config

const SentimentByEntityChart: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [entityType, setEntityType] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/analytics/sentiment-by-entity`, {
        params: { entity_type: entityType || undefined, limit: 15 }
      });

      setData(response.data.entities || []);
    } catch (error) {
      console.error('Error loading sentiment by entity:', error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [entityType]);

  const getEntityIcon = (type: string) => {
    switch(type) {
      case 'PERSON': return 'P';
      case 'ORG': return 'O';
      case 'GPE': return 'L';
      case 'NORP': return 'G';
      case 'EVENT': return 'E';
      default: return 'T';
    }
  };

  const getSentimentColor = (avgSentiment: number) => {
    if (avgSentiment > 0.1) return '#10b981'; // positive - green
    if (avgSentiment < -0.1) return '#ef4444'; // negative - red
    return '#6b7280'; // neutral - gray
  };

  return (
    <div className="sentiment-by-entity-chart">
      <div className="chart-header">
        <h3>Sentiment by Entity</h3>
        <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
          How people, organizations, and locations are portrayed in articles (positive, neutral, or negative sentiment)
        </p>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="entity-type-select"
        >
          <option value="">All Types</option>
          <option value="PERSON">People</option>
          <option value="ORG">Organizations</option>
          <option value="GPE">Locations</option>
          <option value="NORP">Groups</option>
          <option value="EVENT">Events</option>
        </select>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : data.length === 0 ? (
        <div className="no-data">No data available</div>
      ) : (
        <>
          <div className="entity-sentiment-list">
            {data.map((entity, idx) => {
              const totalArticles = entity.article_count;
              const positivePercent = (entity.positive_count / totalArticles) * 100;
              const neutralPercent = (entity.neutral_count / totalArticles) * 100;
              const negativePercent = (entity.negative_count / totalArticles) * 100;

              return (
                <div key={idx} className="entity-sentiment-item">
                  <div className="entity-info">
                    <span className="entity-icon">{getEntityIcon(entity.entity_type)}</span>
                    <div className="entity-details">
                      <div className="entity-name">{entity.entity_text}</div>
                      <div className="entity-meta">
                        {entity.article_count} articles • Avg:
                        <span style={{ color: getSentimentColor(entity.avg_sentiment) }}>
                          {' '}{entity.avg_sentiment > 0 ? '+' : ''}
                          {entity.avg_sentiment.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="sentiment-breakdown-bar">
                    <div
                      className="sentiment-bar positive"
                      style={{ width: `${positivePercent}%` }}
                      title={`${entity.positive_count} positive (${positivePercent.toFixed(1)}%)`}
                    />
                    <div
                      className="sentiment-bar neutral"
                      style={{ width: `${neutralPercent}%` }}
                      title={`${entity.neutral_count} neutral (${neutralPercent.toFixed(1)}%)`}
                    />
                    <div
                      className="sentiment-bar negative"
                      style={{ width: `${negativePercent}%` }}
                      title={`${entity.negative_count} negative (${negativePercent.toFixed(1)}%)`}
                    />
                  </div>

                  <div className="sentiment-counts">
                    <span className="count positive">+{entity.positive_count}</span>
                    <span className="count neutral">={entity.neutral_count}</span>
                    <span className="count negative">-{entity.negative_count}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="chart-container" style={{ marginTop: '24px' }}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="entity_text"
                  angle={-45}
                  textAnchor="end"
                  height={100}
                  interval={0}
                />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="positive_count" fill="#10b981" name="Positive" />
                <Bar dataKey="neutral_count" fill="#6b7280" name="Neutral" />
                <Bar dataKey="negative_count" fill="#ef4444" name="Negative" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
};

export default SentimentByEntityChart;
