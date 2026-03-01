import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LineChart, Line
} from 'recharts';

// Summary Cards Component
export const AnalyticsSummary: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [articlesRes, sentimentRes, entitiesRes] = await Promise.all([
          axios.get(`${API_BASE}/analytics/articles-over-time`),
          axios.get(`${API_BASE}/analytics/sentiment-over-time`),
          axios.get(`${API_BASE}/analytics/top-entities-fixed?limit=1`)
        ]);

        const articles = articlesRes.data.timeline || [];
        const sentiment = sentimentRes.data.timeline || [];

        const totalArticles = articles.reduce((sum: number, item: any) => sum + item.count, 0);

        // Calculate overall sentiment
        let totalPos = 0, totalNeut = 0, totalNeg = 0;
        sentiment.forEach((item: any) => {
          totalPos += item.positive || 0;
          totalNeut += item.neutral || 0;
          totalNeg += item.negative || 0;
        });
        const total = totalPos + totalNeut + totalNeg;
        const avgSentiment = total > 0 ? ((totalPos - totalNeg) / total).toFixed(2) : '0.00';

        // Date range
        const months = articles.map((a: any) => a.month).sort();
        const dateRange = months.length > 0 ? `${months[0]} to ${months[months.length - 1]}` : 'N/A';

        setStats({
          totalArticles,
          avgSentiment,
          dateRange,
          topEntitiesCount: entitiesRes.data.entities?.length || 0
        });
      } catch (error) {
        console.error('Failed to load summary stats:', error);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

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
        <span style={{ fontSize: '20px' }}>📚</span>
        <div>
          <div style={{ fontSize: '11px', color: '#6b7280' }}>Total Articles</div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#374151' }}>
            {stats.totalArticles.toLocaleString()}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '20px' }}>📅</span>
        <div>
          <div style={{ fontSize: '11px', color: '#6b7280' }}>Coverage Period</div>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
            {stats.dateRange}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '20px' }}>
          {parseFloat(stats.avgSentiment) > 0.1 ? '😊' :
           parseFloat(stats.avgSentiment) < -0.1 ? '😟' : '😐'}
        </span>
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
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await axios.get(`${API_BASE}/analytics/sentiment-over-time`);
        const timeline = response.data.timeline || [];

        let positive = 0, neutral = 0, negative = 0;
        timeline.forEach((item: any) => {
          positive += item.positive || 0;
          neutral += item.neutral || 0;
          negative += item.negative || 0;
        });

        const total = positive + neutral + negative;
        setData([
          { name: 'Positive', value: positive, percentage: ((positive / total) * 100).toFixed(1) },
          { name: 'Neutral', value: neutral, percentage: ((neutral / total) * 100).toFixed(1) },
          { name: 'Negative', value: negative, percentage: ((negative / total) * 100).toFixed(1) }
        ]);
      } catch (error) {
        console.error('Failed to load sentiment distribution:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const COLORS = ['#10b981', '#6b7280', '#ef4444'];

  if (loading) return <p>Loading...</p>;
  if (data.length === 0) return <p>No data available</p>;

  return (
    <div>
      <h3>Overall Sentiment Distribution</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
        Breakdown of positive, neutral, and negative articles across the entire archive
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={(entry: any) => `${entry.name}: ${(entry.percent * 100).toFixed(1)}%`}
            outerRadius={100}
            fill="#8884d8"
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

// Topic Distribution Chart
export const TopicDistribution: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await axios.get(`${API_BASE}/topics/`);
        const topics = response.data.topics || [];
        const meaningfulTopics = topics
          .filter((topic: any) => topic.count >= 30)
          .sort((a: any, b: any) => b.count - a.count);
        setData(meaningfulTopics);
      } catch (error) {
        console.error('Failed to load topics:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px' }}>Loading topics...</p>;
  if (data.length === 0) return (
    <div style={{ margin: '1rem 0', padding: '1rem', background: '#fef3c7', borderRadius: '6px', fontSize: '13px' }}>
      <strong>No topics found.</strong> Train the topic model first, or topics may need more articles (minimum 30 per topic).
    </div>
  );

  return (
    <div>
      <h3 style={{ marginBottom: '0.75rem' }}>Discovered Topics ({data.length})</h3>
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
    'PERSON': { label: 'Person', icon: '👤', color: '#3b82f6' },
    'ORG': { label: 'Organization', icon: '🏢', color: '#8b5cf6' },
    'GPE': { label: 'Location', icon: '🌍', color: '#10b981' },
    'NORP': { label: 'Group', icon: '🏳️', color: '#f59e0b' },
    'LOC': { label: 'Place', icon: '🗺️', color: '#06b6d4' },
    'EVENT': { label: 'Event', icon: '📅', color: '#ef4444' }
  };

  return (
    <div className="entity-cooccurrence-network">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>🔗 Entity Relationships</h3>
      </div>
      <div style={{
        padding: '12px 16px',
        background: '#eff6ff',
        border: '1px solid #dbeafe',
        borderRadius: '8px',
        marginBottom: '16px',
        fontSize: '13px',
        lineHeight: '1.6',
        color: '#1e40af'
      }}>
        <strong>What this shows:</strong> Entities (people, organizations, locations) that frequently appear together in the same articles.
        This helps you understand relationships and connections mentioned in the news.
        <div style={{ marginTop: '8px', fontSize: '12px' }}>
          <strong>Example:</strong> If "Pakistan" and "India" appear together 15 times, they were mentioned in 15 articles together.
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ marginRight: '10px', fontWeight: 500, fontSize: '14px' }}>Filter by type:</label>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          <option value="">All Types</option>
          <option value="PERSON">👤 People Only</option>
          <option value="ORG">🏢 Organizations Only</option>
          <option value="GPE">🌍 Locations Only</option>
        </select>
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
            const entity1Info = ENTITY_TYPE_INFO[pair.entity1_type] || { label: pair.entity1_type, icon: '🏷️', color: '#6b7280' };
            const entity2Info = ENTITY_TYPE_INFO[pair.entity2_type] || { label: pair.entity2_type, icon: '🏷️', color: '#6b7280' };
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
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
                      <span style={{ fontSize: '18px' }}>{entity1Info.icon}</span>
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
                      <span style={{ fontSize: '18px' }}>{entity2Info.icon}</span>
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
                      <span style={{ fontSize: '16px' }}>📰</span>
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
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔍</div>
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

// Entity Timeline - shows when entities were mentioned over time
export const EntityTimeline: React.FC = () => {
  const [topEntities, setTopEntities] = useState<string[]>([]);
  const [timelineData, setTimelineData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTimeline = async () => {
      try {
        // Get top 5 entities
        const entitiesRes = await axios.get(`${API_BASE}/analytics/top-entities-fixed?limit=5`);
        const entities = entitiesRes.data.entities || [];
        const entityNames = entities.map((e: any) => e.text);
        setTopEntities(entityNames);

        // For now, show placeholder - would need backend endpoint to get entity mentions over time
        // This is a simplified version
        setTimelineData([]);
      } catch (error) {
        console.error('Failed to load entity timeline:', error);
      } finally {
        setLoading(false);
      }
    };
    loadTimeline();
  }, []);

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h3>Top Entities</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
        Most frequently mentioned people, organizations, and locations
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        {topEntities.map((entity, idx) => (
          <div
            key={idx}
            style={{
              padding: '10px 16px',
              background: '#f3f4f6',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            {entity}
          </div>
        ))}
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

  if (loading) return <p>Loading...</p>;
  if (data.length === 0) return <p>No data available</p>;

  return (
    <div>
      <h3>Article Length Distribution</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
        Distribution of articles by word count - shows typical article length patterns
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="count" fill="#f59e0b" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

// Coverage Heatmap - Shows publication intensity by month
export const CoverageHeatmap: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await axios.get(`${API_BASE}/analytics/articles-over-time`);
        const timeline = response.data.timeline || [];

        setData(timeline);
      } catch (error) {
        console.error('Failed to load coverage data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) return <p>Loading...</p>;
  if (data.length === 0) return <p>No data available</p>;

  const maxCount = Math.max(...data.map((d: any) => d.count));

  return (
    <div>
      <h3>Coverage Intensity</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
        Heatmap showing article publication density - darker colors indicate higher coverage
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '20px' }}>
        {data.map((item, idx) => {
          const intensity = item.count / maxCount;
          const bgColor = `rgba(102, 126, 234, ${intensity * 0.9 + 0.1})`;

          return (
            <div
              key={idx}
              style={{
                minWidth: '80px',
                padding: '12px',
                background: bgColor,
                borderRadius: '8px',
                textAlign: 'center',
                color: intensity > 0.5 ? 'white' : '#1f2937',
                fontWeight: 500,
                fontSize: '13px'
              }}
              title={`${item.count} articles`}
            >
              <div>{item.month}</div>
              <div style={{ fontSize: '18px', marginTop: '4px' }}>{item.count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Topic Trends Over Time - Shows how topic prevalence changes
export const TopicTrendsOverTime: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
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
      console.log('Topic trends raw response:', response.data);
      const trendsData = response.data.trends || [];
      console.log('Trends data length:', trendsData.length);

      // First, collect all unique topic names across all periods
      const allTopicNames = new Set<string>();
      trendsData.forEach((periodData: any) => {
        periodData.topics.forEach((topic: any) => {
          if (topic.topic_name) allTopicNames.add(topic.topic_name);
        });
      });

      // Transform data for Recharts BarChart
      // Each period should be an object with period key and topic counts as values
      const transformedData = trendsData.map((periodData: any) => {
        const dataPoint: any = { period: periodData.period };

        // Initialize all topics to 0 to ensure stacked bars render correctly
        allTopicNames.forEach(name => {
          dataPoint[name] = 0;
        });

        periodData.topics.forEach((topic: any) => {
          if (topic.topic_name) dataPoint[topic.topic_name] = topic.count;
        });

        return dataPoint;
      });

      console.log('Transformed data:', transformedData.slice(0, 2));
      setData(transformedData);
    } catch (error) {
      console.error('Failed to load topic trends:', error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrends();
  }, [granularity, startDate, endDate]);

  // Get all unique topic names for the legend
  const topicNames = data.length > 0
    ? Array.from(new Set(data.flatMap(d => Object.keys(d).filter(k => k !== 'period'))))
    : [];

  // Color palette for topics
  const TOPIC_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
  ];

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px' }}>Loading topic trends...</p>;

  return (
    <div>
      <h3 style={{ marginBottom: '0.75rem' }}>Topic Trends Over Time</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
        Track how different topics gain or lose prominence over time
      </p>

      {/* Controls */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '1rem',
        background: '#f9fafb',
        borderRadius: '8px'
      }}>
        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>
            Granularity:
          </label>
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as 'year' | 'month' | 'day')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              background: 'white'
            }}
          >
            <option value="year">Yearly</option>
            <option value="month">Monthly</option>
            <option value="day">Daily</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>
            Start Date:
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              background: 'white'
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>
            End Date:
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              background: 'white'
            }}
          />
        </div>

        {(startDate || endDate) && (
          <button
            onClick={() => {
              setStartDate('');
              setEndDate('');
            }}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              background: 'white',
              fontSize: '13px',
              cursor: 'pointer',
              color: '#6b7280'
            }}
          >
            Clear Dates
          </button>
        )}
      </div>

      {/* Chart */}
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={500}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              label={{ value: 'Article Count', angle: -90, position: 'insideLeft', fontSize: 12 }}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '12px'
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px' }}
              iconType="square"
            />
            {topicNames.slice(0, 10).map((topicName, idx) => (
              <Bar
                key={topicName}
                dataKey={topicName}
                stackId="a"
                fill={TOPIC_COLORS[idx % TOPIC_COLORS.length]}
                name={topicName}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div style={{
          margin: '2rem 0',
          padding: '2rem',
          background: '#fef3c7',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '13px'
        }}>
          <strong>No trend data available.</strong>
          <br />
          Articles don't have topic labels assigned. Upload newspapers and run topic extraction to see trends.
          <br />
          <small style={{ marginTop: '8px', display: 'block', color: '#92400e' }}>
            Topics are automatically assigned during newspaper processing.
          </small>
        </div>
      )}
    </div>
  );
};

// Topic Sentiment Over Time - Track sentiment changes for topics
export const TopicSentimentOverTime: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [topics, setTopics] = useState<any[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'year' | 'month' | 'day'>('month');

  // Load topics
  useEffect(() => {
    const fetchTopics = async () => {
      try {
        const response = await axios.get(`${API_BASE}/topics/`);
        setTopics(response.data.topics || []);
      } catch (error) {
        console.error('Failed to load topics:', error);
      }
    };
    fetchTopics();
  }, []);

  // Load sentiment data
  const loadSentiment = async () => {
    setLoading(true);
    try {
      const params: any = { granularity };
      if (selectedTopicId !== null) params.topic_id = selectedTopicId;

      const response = await axios.get(`${API_BASE}/topics/sentiment-over-time`, { params });
      const trends = response.data.trends || [];

      // Transform data for chart
      const chartData = trends.map((period: any) => {
        const dataPoint: any = { period: period.period };

        period.topics.forEach((topic: any) => {
          const topicName = topics.find(t => t.topic_id === topic.topic_id)?.keywords?.[0] || `Topic ${topic.topic_id}`;
          dataPoint[topicName] = topic.avg_sentiment;
        });

        return dataPoint;
      });

      setData(chartData);
    } catch (error) {
      console.error('Failed to load topic sentiment:', error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (topics.length > 0) {
      loadSentiment();
    }
  }, [granularity, selectedTopicId, topics]);

  const topicNames = data.length > 0
    ? Array.from(new Set(data.flatMap(d => Object.keys(d).filter(k => k !== 'period'))))
    : [];

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px' }}>Loading sentiment trends...</p>;

  return (
    <div>
      <h3 style={{ marginBottom: '0.75rem' }}>Topic Sentiment Over Time</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
        Track how sentiment changes for each topic over time
      </p>

      {/* Controls */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '1rem',
        background: '#f9fafb',
        borderRadius: '8px'
      }}>
        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>
            Topic:
          </label>
          <select
            value={selectedTopicId ?? ''}
            onChange={(e) => setSelectedTopicId(e.target.value ? parseInt(e.target.value) : null)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              background: 'white',
              minWidth: '200px'
            }}
          >
            <option value="">All Topics</option>
            {topics.map(topic => (
              <option key={topic.topic_id} value={topic.topic_id}>
                Topic {topic.topic_id}: {topic.keywords?.[0] || 'Unknown'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>
            Granularity:
          </label>
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as 'year' | 'month' | 'day')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              background: 'white'
            }}
          >
            <option value="year">Yearly</option>
            <option value="month">Monthly</option>
            <option value="day">Daily</option>
          </select>
        </div>
      </div>

      {/* Chart */}
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              label={{ value: 'Average Sentiment', angle: -90, position: 'insideLeft', fontSize: 12 }}
              tick={{ fontSize: 12 }}
              domain={[-1, 1]}
            />
            <Tooltip
              contentStyle={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '12px'
              }}
              formatter={(value: any) => [value.toFixed(3), 'Sentiment']}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            {topicNames.map((topicName, idx) => (
              <Line
                key={topicName}
                type="monotone"
                dataKey={topicName}
                stroke={COLORS[idx % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                name={topicName}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={{
          margin: '2rem 0',
          padding: '2rem',
          background: '#fef3c7',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '13px'
        }}>
          <strong>No sentiment data available.</strong>
          <br />
          Make sure topics are trained and articles have sentiment scores.
        </div>
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
        // Deduplicate entity names (some entities appear with multiple types)
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
  }, [granularity, entity]);

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px' }}>Loading sentiment trends...</p>;

  return (
    <div>
      <h3 style={{ marginBottom: '0.75rem' }}>Entity Sentiment Over Time</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
        Track sentiment changes for specific entities
      </p>

      {/* Controls */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '1rem',
        background: '#f9fafb',
        borderRadius: '8px'
      }}>
        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>
            Entity:
          </label>
          <select
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              background: 'white',
              minWidth: '200px'
            }}
          >
            {topEntities.map(ent => (
              <option key={ent} value={ent}>{ent}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>
            Granularity:
          </label>
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as 'year' | 'month' | 'day')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              background: 'white'
            }}
          >
            <option value="year">Yearly</option>
            <option value="month">Monthly</option>
            <option value="day">Daily</option>
          </select>
        </div>
      </div>

      {/* Chart */}
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              label={{ value: 'Average Sentiment', angle: -90, position: 'insideLeft', fontSize: 12 }}
              tick={{ fontSize: 12 }}
              domain={[-1, 1]}
            />
            <Tooltip
              contentStyle={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '12px'
              }}
              formatter={(value: any, name?: string) => {
                if (name === 'sentiment') return [value.toFixed(3), 'Sentiment'];
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
        <div style={{
          margin: '2rem 0',
          padding: '2rem',
          background: '#fef3c7',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '13px'
        }}>
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
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'year' | 'month' | 'day'>('month');

  // Load sentiment data
  const loadSentiment = async () => {
    if (!keyword) return;

    setLoading(true);
    try {
      const params: any = { keyword, granularity };
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
    if (keyword) {
      loadSentiment();
    }
  }, [granularity, keyword]);

  if (loading) return <p style={{ margin: '1rem 0', fontSize: '14px' }}>Loading sentiment trends...</p>;

  return (
    <div>
      <h3 style={{ marginBottom: '0.75rem' }}>Keyword Sentiment Over Time</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '8px 0 16px 0' }}>
        Track sentiment changes for specific keywords
      </p>

      {/* Controls */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '1rem',
        background: '#f9fafb',
        borderRadius: '8px'
      }}>
        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>
            Keyword:
          </label>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Enter keyword..."
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              background: 'white',
              minWidth: '200px'
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: '#374151' }}>
            Granularity:
          </label>
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as 'year' | 'month' | 'day')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              background: 'white'
            }}
          >
            <option value="year">Yearly</option>
            <option value="month">Monthly</option>
            <option value="day">Daily</option>
          </select>
        </div>

        <button
          onClick={loadSentiment}
          style={{
            padding: '6px 16px',
            borderRadius: '6px',
            border: 'none',
            background: '#3b82f6',
            color: 'white',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          Search
        </button>
      </div>

      {/* Chart */}
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              label={{ value: 'Average Sentiment', angle: -90, position: 'insideLeft', fontSize: 12 }}
              tick={{ fontSize: 12 }}
              domain={[-1, 1]}
            />
            <Tooltip
              contentStyle={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '12px'
              }}
              formatter={(value: any, name?: string) => {
                if (name === 'sentiment') return [value.toFixed(3), 'Sentiment'];
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
        <div style={{
          margin: '2rem 0',
          padding: '2rem',
          background: '#fef3c7',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '13px'
        }}>
          <strong>No sentiment data available for this keyword.</strong>
        </div>
      )}
    </div>
  );
};
