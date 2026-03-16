import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { useAnalyticsCache } from '../hooks/useAnalyticsCache';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LineChart, Line
} from 'recharts';

// Summary Cards Component
export const AnalyticsSummary: React.FC = () => {
  const { data: stats, loading } = useAnalyticsCache('summary', async () => {
    const [articlesRes, sentimentRes, entitiesRes] = await Promise.all([
      axios.get(`${API_BASE}/analytics/articles-over-time`),
      axios.get(`${API_BASE}/analytics/sentiment-over-time`),
      axios.get(`${API_BASE}/analytics/top-entities-fixed?limit=1`)
    ]);
    const articles = articlesRes.data.timeline || [];
    const sentiment = sentimentRes.data.timeline || [];
    const totalArticles = articles.reduce((sum: number, item: any) => sum + item.count, 0);
    let totalPos = 0, totalNeut = 0, totalNeg = 0;
    sentiment.forEach((item: any) => { totalPos += item.positive || 0; totalNeut += item.neutral || 0; totalNeg += item.negative || 0; });
    const total = totalPos + totalNeut + totalNeg;
    const avgSentiment = total > 0 ? ((totalPos - totalNeg) / total).toFixed(2) : '0.00';
    const months = articles.map((a: any) => a.month).sort();
    const dateRange = months.length > 0 ? `${months[0]} to ${months[months.length - 1]}` : 'N/A';
    return { totalArticles, avgSentiment, dateRange, topEntitiesCount: entitiesRes.data.entities?.length || 0 };
  });

  if (loading) return <div>Loading summary...</div>;
  if (!stats) return null;

  return (
    <div style={{
      display: 'flex',
      gap: '1rem',
      padding: '0.75rem',
      background: '#f9fafb',
      borderRadius: '8px',
      marginBottom: '1rem',
      fontSize: '14px'
    }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '11px', color: '#6b7280' }}>Total Articles</div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#374151' }}>
            {stats.totalArticles.toLocaleString()}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '11px', color: '#6b7280' }}>Coverage Period</div>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
            {stats.dateRange}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '11px', color: '#6b7280' }}>Overall Sentiment</div>
          <div style={{
            fontSize: '18px',
            fontWeight: '700',
            color: parseFloat(stats.avgSentiment) > 0.1 ? '#10b981' :
                     parseFloat(stats.avgSentiment) < -0.1 ? '#ef4444' : '#6b7280'
          }}>
            {parseFloat(stats.avgSentiment) > 0 ? '+' : ''}{stats.avgSentiment}
          </div>
        </div>
      </div>
    </div>
  );
};

// Sentiment Distribution Pie Chart
export const SentimentDistribution: React.FC = () => {
  const { data: raw, loading } = useAnalyticsCache('sentiment_distribution', async () => {
    const response = await axios.get(`${API_BASE}/analytics/sentiment-over-time`);
    const timeline = response.data.timeline || [];
    let positive = 0, neutral = 0, negative = 0;
    timeline.forEach((item: any) => {
      positive += item.positive || 0;
      neutral += item.neutral || 0;
      negative += item.negative || 0;
    });
    const total = positive + neutral + negative;
    return [
      { name: 'Positive', value: positive, percentage: total > 0 ? ((positive / total) * 100).toFixed(1) : '0.0' },
      { name: 'Neutral', value: neutral, percentage: total > 0 ? ((neutral / total) * 100).toFixed(1) : '0.0' },
      { name: 'Negative', value: negative, percentage: total > 0 ? ((negative / total) * 100).toFixed(1) : '0.0' }
    ];
  });
  const data: any[] = raw || [];

  const COLORS = ['#10b981', '#6b7280', '#ef4444'];

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px', color: '#6b7280' }}>Loading...</p>;
  if (data.length === 0) return (
    <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
      <strong>No sentiment data available.</strong>
    </div>
  );

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Overall Sentiment Distribution</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
        Breakdown of positive, neutral, and negative articles across the entire archive
      </p>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={(entry: any) => `${entry.name}: ${(entry.percent * 100).toFixed(1)}%`}
              outerRadius={110}
              fill="#8884d8"
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '12px' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '1rem' }}>
        {data.map((entry, index) => (
          <div key={entry.name} style={{ textAlign: 'center' }}>
            <div style={{
              width: '12px', height: '12px', borderRadius: '50%',
              background: COLORS[index], display: 'inline-block', marginRight: '6px'
            }} />
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>{entry.name}</span>
            <div style={{ fontSize: '18px', fontWeight: '700', color: COLORS[index], marginTop: '2px' }}>
              {entry.percentage}%
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>{entry.value.toLocaleString()} articles</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Topic Distribution Chart
export const TopicDistribution: React.FC = () => {
  const navigate = useNavigate();
  const { data: raw, loading } = useAnalyticsCache('topic_distribution', async () => {
    const response = await axios.get(`${API_BASE}/topics/`);
    const topics = response.data.topics || [];
    return topics.filter((t: any) => t.count >= 30).sort((a: any, b: any) => b.count - a.count);
  });
  const data: any[] = raw || [];

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px', color: '#6b7280' }}>Loading...</p>;
  if (data.length === 0) return (
    <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
      <strong>No topics found.</strong> Train the topic model first, or topics may need more articles (minimum 30 per topic).
    </div>
  );

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Discovered Topics ({data.length})</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
        Topics discovered from the article archive — click a topic to explore its articles
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {data.map((topic, idx) => {
          const topicColor = `hsl(${(idx * 137.5) % 360}, 65%, 50%)`;
          return (
            <div
              key={topic.topic_id}
              onClick={() => navigate(`/topic/${topic.topic_id}`)}
              style={{
                border: '1px solid #e5e7eb',
                borderLeft: `4px solid ${topicColor}`,
                borderRadius: '8px',
                background: 'white',
                padding: '12px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                transition: 'background 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#f9fafb';
                e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'white';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontWeight: '700', color: '#1f2937', fontSize: '14px' }}>
                    {topic.name}
                  </span>
                  <span style={{
                    background: topicColor,
                    color: 'white',
                    padding: '2px 10px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: '600',
                  }}>
                    {topic.count} articles
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  {topic.keywords.slice(0, 8).join(' • ')}
                </div>
              </div>
              <span style={{ color: '#9ca3af', fontSize: '16px' }}>→</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Enhanced Entity Co-occurrence with Network Visualization
export const EntityCooccurrenceNetwork: React.FC = () => {
  const [entityType, setEntityType] = useState<string>('');
  const [cooccurrences, setCooccurrences] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPair, setExpandedPair] = useState<number | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const loadCooccurrences = async () => {
    setLoading(true);
    setHasLoaded(true);
    try {
      const response = await axios.get(`${API_BASE}/analytics/entity-cooccurrence`, {
        params: {
          entity_type: entityType || undefined,
          min_count: 2,
          limit: 20
        }
      });
      setCooccurrences(response.data.pairs || []);
    } catch (error) {
      console.error('Error loading entity co-occurrences:', error);
      setCooccurrences([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasLoaded) {
      loadCooccurrences();
    }
  }, [entityType]);

  const ENTITY_TYPE_INFO: Record<string, { label: string; icon: string; color: string }> = {
    'PERSON': { label: 'Person', icon: '', color: '#3b82f6' },
    'ORG': { label: 'Organization', icon: '', color: '#8b5cf6' },
    'GPE': { label: 'Location', icon: '', color: '#10b981' },
    'NORP': { label: 'Group', icon: '', color: '#f59e0b' },
    'LOC': { label: 'Place', icon: '', color: '#06b6d4' },
    'EVENT': { label: 'Event', icon: '', color: '#ef4444' }
  };

  return (
    <div className="entity-cooccurrence-network">
      <h3 style={{ marginBottom: '0.5rem' }}>Entity Relationships</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
        Entities that frequently appear together in the same articles — showing connections and relationships
      </p>

      {/* Filter pills */}
      <div style={{
        display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap',
        alignItems: 'center', padding: '0.75rem 1rem', background: '#f9fafb',
        borderRadius: '8px', border: '1px solid #e5e7eb'
      }}>
        <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Filter by type:</span>
        {[
          { value: '', label: 'All' },
          { value: 'PERSON', label: 'People' },
          { value: 'ORG', label: 'Organizations' },
          { value: 'GPE', label: 'Locations' },
        ].map(opt => {
          const active = entityType === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setEntityType(opt.value)}
              style={{
                padding: '4px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                border: `2px solid ${active ? '#3b82f6' : '#d1d5db'}`,
                background: active ? '#3b82f6' : 'white',
                color: active ? 'white' : '#374151',
                fontWeight: active ? '600' : '400',
                transition: 'all 0.15s ease',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {!hasLoaded ? (
        <div style={{ textAlign: 'center', padding: '2rem 0' }}>
          <button
            onClick={loadCooccurrences}
            style={{
              padding: '10px 24px',
              fontSize: '14px',
              fontWeight: '600',
              background: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Load Entity Relationships
          </button>
          <p style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af' }}>
            This query scans all 4,200+ articles and may take 1–2 minutes on first load.
          </p>
        </div>
      ) : loading ? (
        <p style={{ margin: '2rem 0', fontSize: '14px', color: '#6b7280' }}>Loading relationships... (this may take a minute)</p>
      ) : cooccurrences.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {cooccurrences.map((pair, idx) => {
            const entity1Info = ENTITY_TYPE_INFO[pair.entity1_type] || { label: pair.entity1_type, icon: '', color: '#6b7280' };
            const entity2Info = ENTITY_TYPE_INFO[pair.entity2_type] || { label: pair.entity2_type, icon: '', color: '#6b7280' };
            const isExpanded = expandedPair === idx;
            
            return (
              <div key={idx} style={{ marginBottom: '8px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '16px',
                    background: 'white',
                    border: '2px solid #e5e7eb',
                    borderRadius: '10px',
                    gap: '16px',
                    transition: 'all 0.2s',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                    e.currentTarget.style.borderColor = '#3b82f6';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                  onClick={() => setExpandedPair(isExpanded ? null : idx)}
                >
                  {/* Rank Badge */}
                  <div style={{
                    minWidth: '36px',
                    height: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#4f46e5',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '700',
                    color: 'white',
                    boxShadow: '0 2px 4px rgba(102,126,234,0.3)'
                  }}>
                    #{idx + 1}
                  </div>

                  {/* Entity 1 */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        background: entity1Info.color,
                        color: 'white',
                        borderRadius: '4px',
                        fontWeight: '600'
                      }}>
                        {entity1Info.label}
                      </span>
                    </div>
                    <div style={{
                      fontSize: '15px',
                      fontWeight: '600',
                      color: '#111827'
                    }}>
                      {pair.entity1}
                    </div>
                  </div>

                  {/* Connection Arrow */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <div style={{
                      fontSize: '20px',
                      color: '#9ca3af'
                    }}>
                      ↔️
                    </div>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: '700',
                      color: '#3b82f6',
                      background: '#eff6ff',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      whiteSpace: 'nowrap'
                    }}>
                      {pair.cooccurrence_count} articles
                    </div>
                  </div>

                  {/* Entity 2 */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        background: entity2Info.color,
                        color: 'white',
                        borderRadius: '4px',
                        fontWeight: '600'
                      }}>
                        {entity2Info.label}
                      </span>
                    </div>
                    <div style={{
                      fontSize: '15px',
                      fontWeight: '600',
                      color: '#111827'
                    }}>
                      {pair.entity2}
                    </div>
                  </div>

                  {/* Expand indicator */}
                  <div style={{
                    fontSize: '18px',
                    color: '#9ca3af',
                    transition: 'transform 0.2s',
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                  }}>
                    ▼
                  </div>
                </div>

                {/* Relationship Evidence - Expanded Section */}
                {isExpanded && pair.examples && pair.examples.length > 0 && (
                  <div style={{
                    marginTop: '8px',
                    padding: '16px',
                    background: '#f9fafb',
                    border: '2px solid #e5e7eb',
                    borderRadius: '8px'
                  }}>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: '600',
                      color: '#374151',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      Evidence of Relationship ({pair.examples.length} example{pair.examples.length > 1 ? 's' : ''})
                    </div>
                    {pair.examples.map((example: any, exIdx: number) => (
                      <div
                        key={exIdx}
                        style={{
                          padding: '12px',
                          background: 'white',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          marginBottom: exIdx < pair.examples.length - 1 ? '10px' : '0',
                          fontSize: '13px',
                          lineHeight: '1.6'
                        }}
                      >
                        <div style={{
                          fontWeight: '600',
                          color: '#1e40af',
                          marginBottom: '6px',
                          fontSize: '12px'
                        }}>
                          {example.headline}
                        </div>
                        <div style={{
                          color: '#4b5563',
                          fontStyle: 'italic',
                          background: '#fef3c7',
                          padding: '8px',
                          borderRadius: '4px',
                          borderLeft: '3px solid #f59e0b'
                        }}>
                          {example.context}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{
          padding: '40px 20px',
          textAlign: 'center',
          background: '#f9fafb',
          borderRadius: '8px',
          border: '1px dashed #d1d5db'
        }}>
          <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: '#374151' }}>
            No Entity Relationships Found
          </div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>
            Try selecting a different entity type or add more articles to the database
          </div>
        </div>
      )}
    </div>
  );
};

// Entity Timeline - shows top entities with counts and type badges
export const EntityTimeline: React.FC = () => {
  const [topEntities, setTopEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const ENTITY_TYPE_COLORS: Record<string, string> = {
    'PERSON': '#3b82f6',
    'ORG': '#8b5cf6',
    'GPE': '#10b981',
    'NORP': '#f59e0b',
    'LOC': '#06b6d4',
    'EVENT': '#ef4444',
  };
  const ENTITY_TYPE_LABELS: Record<string, string> = {
    'PERSON': 'Person',
    'ORG': 'Org',
    'GPE': 'Location',
    'NORP': 'Group',
    'LOC': 'Place',
    'EVENT': 'Event',
  };

  useEffect(() => {
    const loadEntities = async () => {
      try {
        const entitiesRes = await axios.get(`${API_BASE}/analytics/top-entities-fixed?limit=15`);
        const entities = entitiesRes.data.entities || [];
        setTopEntities(entities);
      } catch (error) {
        console.error('Failed to load entity timeline:', error);
      } finally {
        setLoading(false);
      }
    };
    loadEntities();
  }, []);

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px', color: '#6b7280' }}>Loading...</p>;
  if (topEntities.length === 0) return (
    <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
      <strong>No entity data available.</strong>
    </div>
  );

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Top Entities</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
        Most frequently mentioned people, organizations, and locations across all articles
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {topEntities.map((entity, idx) => {
          const typeColor = ENTITY_TYPE_COLORS[entity.entity_type] || '#6b7280';
          const typeLabel = ENTITY_TYPE_LABELS[entity.entity_type] || entity.entity_type;
          return (
            <div
              key={idx}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '10px 14px', background: 'white',
                border: '1px solid #e5e7eb', borderLeft: `4px solid ${typeColor}`,
                borderRadius: '8px',
              }}
            >
              <div style={{
                minWidth: '28px', height: '28px', display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: '#f3f4f6', borderRadius: '6px',
                fontSize: '12px', fontWeight: '700', color: '#6b7280'
              }}>
                #{idx + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>
                  {entity.text}
                </div>
              </div>
              <span style={{
                fontSize: '11px', padding: '2px 8px',
                background: typeColor, color: 'white',
                borderRadius: '4px', fontWeight: '600'
              }}>
                {typeLabel}
              </span>
              <span style={{
                fontSize: '13px', fontWeight: '700', color: typeColor,
                background: `${typeColor}15`, padding: '4px 10px',
                borderRadius: '12px', whiteSpace: 'nowrap'
              }}>
                {entity.count} mentions
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Article Length Distribution
export const ArticleLengthDistribution: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await axios.get(`${API_BASE}/articles`);
        const articles = response.data.articles || [];

        // Group by word count ranges
        const ranges: any = {
          '0-100': 0,
          '101-300': 0,
          '301-500': 0,
          '501-800': 0,
          '800+': 0
        };

        articles.forEach((article: any) => {
          const wc = article.word_count || 0;
          if (wc <= 100) ranges['0-100']++;
          else if (wc <= 300) ranges['101-300']++;
          else if (wc <= 500) ranges['301-500']++;
          else if (wc <= 800) ranges['501-800']++;
          else ranges['800+']++;
        });

        setData([
          { range: '0-100', count: ranges['0-100'], label: 'Very Short' },
          { range: '101-300', count: ranges['101-300'], label: 'Short' },
          { range: '301-500', count: ranges['301-500'], label: 'Medium' },
          { range: '501-800', count: ranges['501-800'], label: 'Long' },
          { range: '800+', count: ranges['800+'], label: 'Very Long' }
        ]);
      } catch (error) {
        console.error('Failed to load article lengths:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px', color: '#6b7280' }}>Loading...</p>;
  if (data.length === 0) return (
    <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
      <strong>No data available.</strong>
    </div>
  );

  const BAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Article Length Distribution</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
        Distribution of articles by word count — shows typical article length patterns
      </p>
      <ResponsiveContainer width="100%" height={420}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" height={70} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '12px' }}
          />
          <Bar dataKey="count" name="Articles">
            {data.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={BAR_COLORS[index % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

// Coverage Heatmap - Shows publication intensity by month
export const CoverageHeatmap: React.FC = () => {
  const { data: raw, loading } = useAnalyticsCache('coverage_heatmap', async () => {
    const response = await axios.get(`${API_BASE}/analytics/articles-over-time`);
    return response.data.timeline || [];
  });
  const data: any[] = raw || [];

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px', color: '#6b7280' }}>Loading...</p>;
  if (data.length === 0) return (
    <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
      <strong>No coverage data available.</strong>
    </div>
  );

  const maxCount = Math.max(...data.map((d: any) => d.count));

  return (
    <div>
      <h3 style={{ marginBottom: '10px' }}>Coverage Intensity</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
        {data.map((item, idx) => {
          const intensity = item.count / maxCount;
          const bgColor = `rgba(79, 70, 229, ${intensity * 0.85 + 0.08})`;

          return (
            <div
              key={idx}
              style={{
                minWidth: '68px',
                padding: '7px 8px',
                background: bgColor,
                borderRadius: '6px',
                textAlign: 'center',
                color: intensity > 0.5 ? 'white' : '#1f2937',
                fontWeight: 500,
                fontSize: '12px'
              }}
              title={`${item.count} articles`}
            >
              <div>{item.month}</div>
              <div style={{ fontSize: '14px', fontWeight: 700, marginTop: '2px' }}>{item.count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Topic Trends Over Time - Shows how topic prevalence changes
const TOPIC_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
  '#a855f7', '#22c55e', '#eab308', '#f43f5e', '#0ea5e9',
];

// Human-readable names for known topic labels
const TOPIC_NAME_MAP: Record<string, string> = {
  '00_kgs_grams_oil_40 kgs':                                  'Commodities',
  '21_rs 21_rates_buying_selling':                             'Currency Rates',
  '66_67_closing_cotton_fri':                                  'Cotton Market',
  'airconditioning_car_airconditioners_installation_sunny':    'Appliances',
  'arab_israel_iran_syria_iraq':                               'Middle East',
  'artistes_exhibition_arts_paintings_council':                'Arts & Culture',
  'billion_tax_cent_budget_programme':                         'Budget & Tax',
  'car_contact_suzuki_toyota_model':                           'Automotive',
  'cargo_containers_tons_ships_general cargo':                 'Shipping & Cargo',
  'company_directors_general meeting_dividend_year ended':     'Corporate Finance',
  'computer_ibm_machines_quotations_machinery':                'Technology',
  'correspond_clue_black_panel_numbers':                       'Crossword / Puzzles',
  'cotton_bids_bid_seed_ginning':                              'Cotton Trade',
  'doctors_strike_newspaper_patients_protest':                 'Medical Strike',
  'dollar_yen_japanese_japan_cent':                            'Foreign Exchange',
  'dollars_afternoon_kerb_thursday_gold':                      'Forex & Gold',
  'driving_pick drop_instructors_metropole_drop':              'Transport',
  'experience_candidates_applications_apply_years experience': 'Job Listings',
  'fumigation_proofing_tank cleaning_termite_water tank':      'Pest Control',
  'imf_countries_debt_gold_nations':                           'IMF & Debt',
  'iv_ii_results_intermediate_examination':                    'Exam Results',
  'match_cricket_team_final_england':                          'Cricket',
  'mep_export price_price_minimum_export':                     'Export Policy',
  'mqm_kashmir_ppp_sindh_minister':                            'Sindh Politics',
  'mujahideen_sri_kabul_regime_tanai':                         'Afghanistan',
  'news_00 news_35_katrak_transmission':                       'Media / Radio',
  'notice_claim_objection_shall_person':                       'Legal Notices',
  'nuclear_company_radiation_ray_paec':                        'Nuclear (PAEC)',
  'nuclear_french_eec_plant_chamber':                          'Nuclear Energy',
  'oil_opec_petroleum_uae_kuwait':                             'Oil & OPEC',
  'police_injured_shot_dead_killed':                           'Crime & Violence',
  'power_generation_electricity_energy_conservation':          'Electricity & Energy',
  'quality_productivity_process_improvement_continuous':       'Industry',
  'radio_soyem_held_imam_death':                               'Obituaries',
  'refrigerators_household_vcr_airconditioners_cookers':       'Electronics',
  'science_education_university_teaching_educational':         'Science & Education',
  'shares_paisa_modaraba_market_investors':                    'Stock Market',
  'soviet_union_soviet union_europe_gorbachev':                'Soviet Union',
  'students_teachers_schools_college_university':              'Schools & Teachers',
  'technology_hmc_cad_cam_engineering':                        'Engineering',
  'telephone_bills_subscribers_exchange_dates':                'Telecom',
  'tender_tenders_90_earnest money_earnest':                   'Tenders',
  'water_kwsb_supply_areas_colony':                            'Water Supply',
  'wheat_tons_million tons_port_stocks':                       'Wheat & Food',
  'women_health_motherhood_safe motherhood_safe':              "Women's Health",
  'yards_defence_clifton_estate_phone':                        'Real Estate',
};

// Readable name: use map first, then smart fallback
const toReadableTopicName = (raw: string): string => {
  if (TOPIC_NAME_MAP[raw]) return TOPIC_NAME_MAP[raw];
  const seen = new Set<string>();
  const words = raw.split('_')
    .filter(w => w.length > 1 && !/^\d+$/.test(w))
    .filter(w => { if (seen.has(w.toLowerCase())) return false; seen.add(w.toLowerCase()); return true; })
    .map(w => w.charAt(0).toUpperCase() + w.slice(1));
  return words.slice(0, 2).join(' ') || raw;
};

export const TopicTrendsOverTime: React.FC = () => {
  const [rawData, setRawData] = useState<any[]>([]);
  const [allTopics, setAllTopics] = useState<{ raw: string; label: string; total: number }[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'year' | 'month' | 'day'>('month');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const loadTrends = async () => {
    setLoading(true);
    try {
      const params: any = { granularity };
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const response = await axios.get(`${API_BASE}/topics/trends-over-time`, { params });
      const trendsData = response.data.trends || [];

      // Tally total articles per topic across all periods
      const topicTotals: Record<string, number> = {};
      trendsData.forEach((periodData: any) => {
        periodData.topics.forEach((topic: any) => {
          if (topic.topic_name) {
            topicTotals[topic.topic_name] = (topicTotals[topic.topic_name] || 0) + topic.count;
          }
        });
      });

      // Sort topics by total article count descending
      const sortedTopics = Object.entries(topicTotals)
        .sort((a, b) => b[1] - a[1])
        .map(([raw, total]) => ({ raw, label: toReadableTopicName(raw), total }));

      // Transform to recharts format: one object per period
      const allTopicNames = new Set(sortedTopics.map(t => t.raw));
      const transformed = trendsData.map((periodData: any) => {
        const point: any = { period: periodData.period };
        allTopicNames.forEach(name => { point[name] = 0; });
        periodData.topics.forEach((topic: any) => {
          if (topic.topic_name) point[topic.topic_name] = topic.count;
        });
        return point;
      });

      setAllTopics(sortedTopics);
      setRawData(transformed);
      // Pre-select the top 3 topics
      setSelectedTopics(new Set(sortedTopics.slice(0, 3).map(t => t.raw)));
    } catch (error) {
      console.error('Failed to load topic trends:', error);
      setRawData([]);
      setAllTopics([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTrends(); }, [granularity, startDate, endDate]);

  const toggleTopic = (raw: string) => {
    setSelectedTopics(prev => {
      const next = new Set(prev);
      if (next.has(raw)) next.delete(raw);
      else next.add(raw);
      return next;
    });
  };

  const selectedList = allTopics.filter(t => selectedTopics.has(t.raw));

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px' }}>Loading topic trends...</p>;

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Topic Trends Over Time</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
        Select topics below to compare how they rise and fall over time
      </p>

      {/* Controls row */}
      <div style={{
        display: 'flex', gap: '1rem', marginBottom: '1rem',
        flexWrap: 'wrap', alignItems: 'center',
        padding: '0.75rem 1rem', background: '#f9fafb', borderRadius: '8px'
      }}>
        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>Granularity:</label>
          <select value={granularity} onChange={(e) => setGranularity(e.target.value as any)}
            style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', background: 'white' }}>
            <option value="year">Yearly</option>
            <option value="month">Monthly</option>
            <option value="day">Daily</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>From:</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', background: 'white' }} />
        </div>
        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>To:</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', background: 'white' }} />
        </div>
        {(startDate || endDate) && (
          <button onClick={() => { setStartDate(''); setEndDate(''); }}
            style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', fontSize: '13px', cursor: 'pointer', color: '#6b7280' }}>
            Clear
          </button>
        )}
      </div>

      {rawData.length === 0 ? (
        <div style={{ margin: '2rem 0', padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
          <strong>No trend data available.</strong><br />
          Articles don't have topic labels assigned. Upload newspapers and run topic extraction to see trends.
        </div>
      ) : (
        <>
          {/* Topic picker */}
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                Topics ({selectedTopics.size} selected)
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setSelectedTopics(new Set(allTopics.slice(0, 5).map(t => t.raw)))}
                  style={{ padding: '3px 10px', borderRadius: '5px', border: '1px solid #d1d5db', background: 'white', fontSize: '12px', cursor: 'pointer', color: '#374151' }}>
                  Top 5
                </button>
                <button onClick={() => setSelectedTopics(new Set())}
                  style={{ padding: '3px 10px', borderRadius: '5px', border: '1px solid #d1d5db', background: 'white', fontSize: '12px', cursor: 'pointer', color: '#6b7280' }}>
                  Clear all
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {allTopics.map((topic, idx) => {
                const active = selectedTopics.has(topic.raw);
                const color = TOPIC_COLORS[allTopics.findIndex(t => t.raw === topic.raw) % TOPIC_COLORS.length];
                return (
                  <button key={topic.raw} onClick={() => toggleTopic(topic.raw)}
                    title={topic.raw.replace(/_/g, ' ')}
                    style={{
                      padding: '4px 10px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                      border: `2px solid ${active ? color : '#d1d5db'}`,
                      background: active ? color : 'white',
                      color: active ? 'white' : '#374151',
                      fontWeight: active ? '600' : '400',
                      transition: 'all 0.15s ease',
                    }}>
                    {topic.label}
                    <span style={{ marginLeft: '5px', opacity: 0.75, fontSize: '11px' }}>
                      {topic.total}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chart */}
          {selectedList.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#9ca3af', fontSize: '14px', border: '2px dashed #e5e7eb', borderRadius: '8px' }}>
              Select one or more topics above to see their trend lines
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={420}>
              <BarChart data={rawData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: 'Articles', angle: -90, position: 'insideLeft', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '12px' }}
                  formatter={(value: any, name: string | undefined) => [value, name ? toReadableTopicName(name) : name]}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                  formatter={(value) => toReadableTopicName(value)}
                />
                {selectedList.map((topic) => {
                  const colorIdx = allTopics.findIndex(t => t.raw === topic.raw) % TOPIC_COLORS.length;
                  return (
                    <Bar
                      key={topic.raw}
                      dataKey={topic.raw}
                      stackId="a"
                      fill={TOPIC_COLORS[colorIdx]}
                      name={topic.raw}
                    />
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  );
};

// Topic Sentiment Over Time - Track sentiment changes for topics
export const TopicSentimentOverTime: React.FC = () => {
  const [rawData, setRawData] = useState<any[]>([]);
  const [topics, setTopics] = useState<any[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'year' | 'month' | 'day'>('month');

  const SENT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'];

  // Load topics list
  useEffect(() => {
    const fetchTopics = async () => {
      try {
        const response = await axios.get(`${API_BASE}/topics/`);
        const loaded = (response.data.topics || []).filter((t: any) => t.count >= 30);
        setTopics(loaded);
        // Pre-select top 3
        setSelectedTopicIds(new Set(loaded.slice(0, 3).map((t: any) => t.topic_id as number)));
      } catch (error) {
        console.error('Failed to load topics:', error);
      }
    };
    fetchTopics();
  }, []);

  // Load all sentiment data (no topic_id filter — filter client-side)
  const loadSentiment = async () => {
    setLoading(true);
    try {
      const params: any = { granularity };
      const response = await axios.get(`${API_BASE}/topics/sentiment-over-time`, { params });
      const trends = response.data.trends || [];

      // Build a flat map: period -> { topic_id -> avg_sentiment }
      const chartData = trends.map((period: any) => {
        const dataPoint: any = { period: period.period };
        period.topics.forEach((topic: any) => {
          dataPoint[`t_${topic.topic_id}`] = topic.avg_sentiment;
        });
        return dataPoint;
      });

      setRawData(chartData);
    } catch (error) {
      console.error('Failed to load topic sentiment:', error);
      setRawData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSentiment();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity]);

  const toggleTopic = (id: number) => {
    setSelectedTopicIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedList = topics.filter(t => selectedTopicIds.has(t.topic_id));

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px', color: '#6b7280' }}>Loading...</p>;

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Topic Sentiment Over Time</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
        Track how sentiment changes for each topic over time — select topics to compare
      </p>

      {/* Granularity control bar */}
      <div style={{
        display: 'flex', gap: '1rem', marginBottom: '1rem',
        flexWrap: 'wrap', alignItems: 'center',
        padding: '0.75rem 1rem', background: '#f9fafb',
        borderRadius: '8px', border: '1px solid #e5e7eb'
      }}>
        <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Granularity:</label>
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as 'year' | 'month' | 'day')}
          style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', background: 'white' }}
        >
          <option value="year">Yearly</option>
          <option value="month">Monthly</option>
          <option value="day">Daily</option>
        </select>
      </div>

      {rawData.length === 0 ? (
        <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
          <strong>No sentiment data available.</strong><br />
          Make sure topics are trained and articles have sentiment scores.
        </div>
      ) : (
        <>
          {/* Topic pill picker */}
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                Topics ({selectedTopicIds.size} selected)
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setSelectedTopicIds(new Set(topics.slice(0, 3).map(t => t.topic_id)))}
                  style={{ padding: '3px 10px', borderRadius: '5px', border: '1px solid #d1d5db', background: 'white', fontSize: '12px', cursor: 'pointer', color: '#374151' }}
                >
                  Top 3
                </button>
                <button
                  onClick={() => setSelectedTopicIds(new Set())}
                  style={{ padding: '3px 10px', borderRadius: '5px', border: '1px solid #d1d5db', background: 'white', fontSize: '12px', cursor: 'pointer', color: '#6b7280' }}
                >
                  Clear all
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {topics.map((topic, idx) => {
                const active = selectedTopicIds.has(topic.topic_id);
                const color = SENT_COLORS[idx % SENT_COLORS.length];
                const label = toReadableTopicName(topic.keywords?.[0] || `Topic ${topic.topic_id}`);
                return (
                  <button
                    key={topic.topic_id}
                    onClick={() => toggleTopic(topic.topic_id)}
                    title={topic.keywords?.join(', ')}
                    style={{
                      padding: '4px 10px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                      border: `2px solid ${active ? color : '#d1d5db'}`,
                      background: active ? color : 'white',
                      color: active ? 'white' : '#374151',
                      fontWeight: active ? '600' : '400',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {label}
                    <span style={{ marginLeft: '5px', opacity: 0.75, fontSize: '11px' }}>{topic.count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedList.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#9ca3af', fontSize: '14px', border: '2px dashed #e5e7eb', borderRadius: '8px' }}>
              Select one or more topics above to see their sentiment lines
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={420}>
              <LineChart data={rawData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" height={70} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  domain={[-1, 1]}
                  label={{ value: 'Avg Sentiment', angle: -90, position: 'insideLeft', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '12px' }}
                  formatter={(value: any, name?: string) => {
                    if (name && name.startsWith('t_')) {
                      const tid = parseInt(name.replace('t_', ''));
                      const t = topics.find(t => t.topic_id === tid);
                      const label = t ? toReadableTopicName(t.keywords?.[0] || `Topic ${tid}`) : name;
                      return [typeof value === 'number' ? value.toFixed(3) : value, label];
                    }
                    return [value, name];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                  formatter={(value) => {
                    if (value && value.startsWith('t_')) {
                      const tid = parseInt(value.replace('t_', ''));
                      const t = topics.find(t => t.topic_id === tid);
                      return t ? toReadableTopicName(t.keywords?.[0] || `Topic ${tid}`) : value;
                    }
                    return value;
                  }}
                />
                {selectedList.map((topic) => {
                  const color = SENT_COLORS[topics.findIndex(t => t.topic_id === topic.topic_id) % SENT_COLORS.length];
                  return (
                    <Line
                      key={topic.topic_id}
                      type="monotone"
                      dataKey={`t_${topic.topic_id}`}
                      stroke={color}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      name={`t_${topic.topic_id}`}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  );
};

// Entity Sentiment Over Time - Track sentiment for specific entities
export const EntitySentimentOverTime: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [entity, setEntity] = useState<string>('Pakistan');
  const [topEntities, setTopEntities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'year' | 'month' | 'day'>('month');

  // Load top entities
  useEffect(() => {
    const fetchEntities = async () => {
      try {
        const response = await axios.get(`${API_BASE}/analytics/top-entities-fixed?limit=20`);
        const entities = response.data.entities || [];
        const uniqueEntities: string[] = Array.from(new Set(entities.map((e: any) => e.text as string)));
        setTopEntities(uniqueEntities);
        if (uniqueEntities.length > 0 && !entity) {
          setEntity(uniqueEntities[0]);
        }
      } catch (error) {
        console.error('Failed to load entities:', error);
      }
    };
    fetchEntities();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load sentiment data
  const loadSentiment = async () => {
    if (!entity) return;
    setLoading(true);
    try {
      const params: any = { entity, granularity };
      const response = await axios.get(`${API_BASE}/analytics/entity-sentiment-over-time`, { params });
      const trends = response.data.data || [];
      setData(trends.map((t: any) => ({
        period: t.date,
        sentiment: t.sentiment_score,
        count: t.count
      })));
    } catch (error) {
      console.error('Failed to load entity sentiment:', error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (entity) {
      loadSentiment();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, entity]);

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px', color: '#6b7280' }}>Loading...</p>;

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Entity Sentiment Over Time</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
        Track sentiment changes for a specific entity — click a pill to switch entities
      </p>

      {/* Control bar: granularity */}
      <div style={{
        display: 'flex', gap: '1rem', marginBottom: '1rem',
        flexWrap: 'wrap', alignItems: 'center',
        padding: '0.75rem 1rem', background: '#f9fafb',
        borderRadius: '8px', border: '1px solid #e5e7eb'
      }}>
        <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Granularity:</label>
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as 'year' | 'month' | 'day')}
          style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', background: 'white' }}
        >
          <option value="year">Yearly</option>
          <option value="month">Monthly</option>
          <option value="day">Daily</option>
        </select>
      </div>

      {/* Entity pill picker */}
      {topEntities.length > 0 && (
        <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '0.6rem' }}>
            Select entity:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {topEntities.map(ent => {
              const active = entity === ent;
              return (
                <button
                  key={ent}
                  onClick={() => setEntity(ent)}
                  style={{
                    padding: '4px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                    border: `2px solid ${active ? '#3b82f6' : '#d1d5db'}`,
                    background: active ? '#3b82f6' : 'white',
                    color: active ? 'white' : '#374151',
                    fontWeight: active ? '600' : '400',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {ent}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Chart */}
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" height={70} />
            <YAxis
              tick={{ fontSize: 11 }}
              domain={[-1, 1]}
              label={{ value: 'Avg Sentiment', angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '12px' }}
              formatter={(value: any, name?: string) => {
                if (name === 'sentiment') return [typeof value === 'number' ? value.toFixed(3) : value, 'Sentiment'];
                return [value, 'Articles'];
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Line
              type="monotone"
              dataKey="sentiment"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
              name={`${entity} Sentiment`}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
          <strong>No sentiment data available for this entity.</strong>
        </div>
      )}
    </div>
  );
};

// Keyword Sentiment Over Time - Track sentiment for keywords
export const KeywordSentimentOverTime: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [keyword, setKeyword] = useState<string>('election');
  const [inputValue, setInputValue] = useState<string>('election');
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'year' | 'month' | 'day'>('month');

  const QUICK_KEYWORDS = ['election', 'karachi', 'pakistan', 'india', 'kashmir', 'economy', 'government', 'army', 'war', 'cricket'];

  // Load sentiment data
  const loadSentiment = async (kw?: string) => {
    const searchKw = kw !== undefined ? kw : keyword;
    if (!searchKw) return;

    setLoading(true);
    try {
      const params: any = { keyword: searchKw, granularity };
      const response = await axios.get(`${API_BASE}/analytics/keyword-sentiment-over-time`, { params });
      const trends = response.data.trends || [];
      setData(trends.map((t: any) => ({
        period: t.period,
        sentiment: t.avg_sentiment,
        count: t.article_count
      })));
    } catch (error) {
      console.error('Failed to load keyword sentiment:', error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSentiment();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, keyword]);

  const handleSearch = () => {
    setKeyword(inputValue.trim());
  };

  const handlePillClick = (kw: string) => {
    setInputValue(kw);
    setKeyword(kw);
  };

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px', color: '#6b7280' }}>Loading...</p>;

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Keyword Sentiment Over Time</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
        Track sentiment changes for specific keywords across the archive
      </p>

      {/* Control bar */}
      <div style={{
        display: 'flex', gap: '1rem', marginBottom: '1rem',
        flexWrap: 'wrap', alignItems: 'center',
        padding: '0.75rem 1rem', background: '#f9fafb',
        borderRadius: '8px', border: '1px solid #e5e7eb'
      }}>
        <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Keyword:</label>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          placeholder="Enter keyword..."
          style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', background: 'white', minWidth: '160px' }}
        />
        <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>Granularity:</label>
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as 'year' | 'month' | 'day')}
          style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', background: 'white' }}
        >
          <option value="year">Yearly</option>
          <option value="month">Monthly</option>
          <option value="day">Daily</option>
        </select>
        <button
          onClick={handleSearch}
          style={{
            padding: '5px 16px', borderRadius: '6px', border: 'none',
            background: '#3b82f6', color: 'white',
            fontSize: '13px', fontWeight: '600', cursor: 'pointer'
          }}
        >
          Search
        </button>
      </div>

      {/* Quick-select keyword pills */}
      <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '0.5rem' }}>Quick select:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {QUICK_KEYWORDS.map(kw => {
            const active = keyword === kw;
            return (
              <button
                key={kw}
                onClick={() => handlePillClick(kw)}
                style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                  border: `2px solid ${active ? '#10b981' : '#d1d5db'}`,
                  background: active ? '#10b981' : 'white',
                  color: active ? 'white' : '#374151',
                  fontWeight: active ? '600' : '400',
                  transition: 'all 0.15s ease',
                }}
              >
                {kw}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" height={70} />
            <YAxis
              tick={{ fontSize: 11 }}
              domain={[-1, 1]}
              label={{ value: 'Avg Sentiment', angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '12px' }}
              formatter={(value: any, name?: string) => {
                if (name === 'sentiment') return [typeof value === 'number' ? value.toFixed(3) : value, 'Sentiment'];
                return [value, 'Articles'];
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Line
              type="monotone"
              dataKey="sentiment"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
              name={`"${keyword}" Sentiment`}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
          <strong>No sentiment data available for this keyword.</strong>
        </div>
      )}
    </div>
  );
};
