import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { SkeletonChart } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';

type SortKey = 'mentions' | 'positive' | 'negative' | 'avg' | 'name';

const SentimentByEntityChart: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [entityType, setEntityType] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(15);
  const [sortKey, setSortKey] = useState<SortKey>('mentions');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_BASE}/analytics/sentiment-by-entity`, {
        params: { entity_type: entityType || undefined, limit }
      });

      setData(response.data.entities || []);
    } catch (err: any) {
      console.error('Error loading sentiment by entity:', err);
      setError(err?.message || 'Failed to load');
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, limit]);

  const sorted = useMemo(() => {
    const copy = [...data];
    copy.sort((a, b) => {
      switch (sortKey) {
        case 'positive': return (b.positive_count || 0) - (a.positive_count || 0);
        case 'negative': return (b.negative_count || 0) - (a.negative_count || 0);
        case 'avg':      return (b.avg_sentiment || 0) - (a.avg_sentiment || 0);
        case 'name':     return (a.entity_text || '').localeCompare(b.entity_text || '');
        case 'mentions':
        default:         return (b.article_count || 0) - (a.article_count || 0);
      }
    });
    return copy;
  }, [data, sortKey]);

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
    if (avgSentiment > 0.1) return 'var(--positive)'; // positive - green
    if (avgSentiment < -0.1) return 'var(--negative)'; // negative - red
    return 'var(--text-secondary)'; // neutral - gray
  };

  return (
    <div className="sentiment-by-entity-chart">
      <div className="chart-header">
        <h3>Sentiment by Entity</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '8px 0 16px 0' }}>
          How people, organizations, and locations are portrayed in articles (positive, neutral, or negative sentiment)
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="entity-type-select"
          >
            <option value="">All Types</option>
            <option value="PERSON">People</option>
            <option value="ORG">Organizations</option>
            <option value="GPE">Locations</option>
            <option value="NORP">Nationalities</option>
            <option value="EVENT">Events</option>
          </select>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="entity-type-select"
            aria-label="Sort entities"
          >
            <option value="mentions">Sort: Most mentions</option>
            <option value="positive">Sort: Most positive</option>
            <option value="negative">Sort: Most negative</option>
            <option value="avg">Sort: Highest avg sentiment</option>
            <option value="name">Sort: A → Z</option>
          </select>
        </div>
      </div>

      {loading ? (
        <SkeletonChart />
      ) : error ? (
        <EmptyState icon="!" title="Couldn't load sentiment by entity" description={error} action={{ label: 'Retry', onClick: loadData }} />
      ) : sorted.length === 0 ? (
        <EmptyState title="No data available" description="Try a different entity type." />
      ) : (
        <>
          <div className="entity-sentiment-list">
            {sorted.map((entity, idx) => {
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
              <BarChart data={sorted.slice(0, 10)}>
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

          {sorted.length >= limit && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <button
                onClick={() => setLimit(l => l + 15)}
                disabled={loading}
                style={{
                  padding: '6px 14px', fontSize: 13, borderRadius: 6,
                  border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)', cursor: 'pointer',
                }}
              >
                Load 15 more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SentimentByEntityChart;
