import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { AlertCircle, Building2, Calendar, Globe, MapPin, Tag, User, Users } from 'lucide-react';
import { API_BASE } from '../config';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { SkeletonChart } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import { TOOLTIP_STYLE, TOOLTIP_CURSOR, AXIS_STYLE } from '../theme/chartTheme';

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
    const props = { size: 14, 'aria-hidden': true } as const;
    switch(type) {
      case 'PERSON': return <User {...props} />;
      case 'ORG': return <Building2 {...props} />;
      case 'GPE': return <MapPin {...props} />;
      case 'NORP': return <Globe {...props} />;
      case 'EVENT': return <Calendar {...props} />;
      default: return <Tag {...props} />;
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
        <p className="chart-caption">
          How people, organizations, and locations are portrayed in articles (positive, neutral, or negative sentiment)
        </p>
        <div className="cluster">
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
        <EmptyState icon={<AlertCircle size={28} aria-hidden />} title="Couldn't load sentiment by entity" description={error} action={{ label: 'Retry', onClick: loadData }} />
      ) : sorted.length === 0 ? (
        <EmptyState icon={<Users size={28} aria-hidden />} title="No entities matched this filter" description="No people, organizations, or locations of the selected type appeared often enough to score. Try a broader entity type." />
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

          <div className="chart-container chart-container--spaced">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sorted.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis
                  dataKey="entity_text"
                  angle={-45}
                  textAnchor="end"
                  height={100}
                  interval={0}
                  tick={AXIS_STYLE}
                />
                <YAxis tick={AXIS_STYLE} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={TOOLTIP_CURSOR} />
                <Legend />
                <Bar dataKey="positive_count" fill="var(--positive)" name="Positive" />
                <Bar dataKey="neutral_count" fill="var(--text-tertiary)" name="Neutral" />
                <Bar dataKey="negative_count" fill="var(--negative)" name="Negative" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {sorted.length >= limit && (
            <div className="cluster" style={{ justifyContent: 'center', marginTop: 'var(--space-3)' }}>
              <button
                onClick={() => setLimit(l => l + 15)}
                disabled={loading}
                className="btn btn--sm"
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
