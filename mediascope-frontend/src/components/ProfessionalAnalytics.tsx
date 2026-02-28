import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE } from '../config';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

// Entity type labels with descriptions
const ENTITY_TYPE_INFO: Record<string, { label: string; description: string; icon: string; color: string }> = {
  'PERSON': { 
    label: 'People', 
    description: 'Individuals, historical figures, politicians, celebrities',
    icon: '👤',
    color: '#3b82f6'
  },
  'ORG': { 
    label: 'Organizations', 
    description: 'Companies, government bodies, institutions, political parties',
    icon: '🏢',
    color: '#8b5cf6'
  },
  'GPE': { 
    label: 'Locations (Geo-Political)', 
    description: 'Cities, countries, states, regions with governments',
    icon: '🌍',
    color: '#10b981'
  },
  'NORP': { 
    label: 'Nationalities & Groups', 
    description: 'Nationalities, religious groups, political affiliations',
    icon: '🏳️',
    color: '#f59e0b'
  },
  'LOC': { 
    label: 'Locations (Geographic)', 
    description: 'Mountains, rivers, non-political geographic features',
    icon: '🗺️',
    color: '#06b6d4'
  },
  'EVENT': { 
    label: 'Events', 
    description: 'Wars, sports events, conferences, historical events',
    icon: '📅',
    color: '#ef4444'
  },
  'DATE': { 
    label: 'Dates', 
    description: 'Specific dates or time periods',
    icon: '📆',
    color: '#6b7280'
  }
};

// Interactive Keyword Component
export const InteractiveKeywords: React.FC = () => {
  const navigate = useNavigate();
  const [keywords, setKeywords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeyword, setSelectedKeyword] = useState<any>(null);
  const [keywordArticles, setKeywordArticles] = useState<any[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await axios.get(`${API_BASE}/analytics/top-keywords?limit=50`);
        setKeywords(response.data.keywords || []);
      } catch (error) {
        console.error('Failed to load keywords:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleKeywordClick = async (keyword: any) => {
    setSelectedKeyword(keyword);
    setLoadingArticles(true);
    try {
      const response = await axios.post(`${API_BASE}/search/keyword`, {
        keyword: keyword.keyword,
        limit: 20
      });
      setKeywordArticles(response.data.articles || []);
    } catch (error) {
      console.error('Failed to load articles:', error);
    } finally {
      setLoadingArticles(false);
    }
  };

  if (loading) return <div style={{ padding: '20px' }}>Loading keywords...</div>;

  const maxFreq = Math.max(...keywords.map(k => k.frequency));

  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      padding: '24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '600' }}>
        📊 Top Keywords
      </h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 20px 0' }}>
        Click any keyword to see articles where it appears
      </p>

      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap', 
        gap: '12px', 
        marginBottom: '24px'
      }}>
        {keywords.slice(0, 30).map((kw, idx) => {
          const size = 12 + (kw.frequency / maxFreq) * 16;
          return (
            <button
              key={idx}
              onClick={() => handleKeywordClick(kw)}
              style={{
                fontSize: `${size}px`,
                color: selectedKeyword?.keyword === kw.keyword ? '#ffffff' : '#3b82f6',
                background: selectedKeyword?.keyword === kw.keyword ? '#3b82f6' : '#eff6ff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '20px',
                cursor: 'pointer',
                fontWeight: 600,
                transition: 'all 0.2s',
                boxShadow: selectedKeyword?.keyword === kw.keyword ? '0 2px 8px rgba(59,130,246,0.3)' : 'none'
              }}
              onMouseEnter={(e) => {
                if (selectedKeyword?.keyword !== kw.keyword) {
                  e.currentTarget.style.background = '#dbeafe';
                  e.currentTarget.style.transform = 'scale(1.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (selectedKeyword?.keyword !== kw.keyword) {
                  e.currentTarget.style.background = '#eff6ff';
                  e.currentTarget.style.transform = 'scale(1)';
                }
              }}
            >
              {kw.keyword} <span style={{ opacity: 0.7, fontSize: '0.8em' }}>({kw.frequency})</span>
            </button>
          );
        })}
      </div>

      {selectedKeyword && (
        <div style={{
          borderTop: '2px solid #e5e7eb',
          paddingTop: '20px'
        }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600' }}>
            Articles mentioning "{selectedKeyword.keyword}" ({keywordArticles.length} found)
          </h4>
          
          {loadingArticles ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
              Loading articles...
            </div>
          ) : keywordArticles.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto' }}>
              {keywordArticles.map((article) => (
                <div
                  key={article.id}
                  onClick={() => navigate(`/article/${article.id}`)}
                  style={{
                    padding: '16px',
                    background: '#f9fafb',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    border: '1px solid #e5e7eb'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f3f4f6';
                    e.currentTarget.style.borderColor = '#3b82f6';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px', color: '#111827' }}>
                    {article.headline}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                    {new Date(article.publication_date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </div>
                  <div style={{ fontSize: '13px', color: '#4b5563', lineHeight: '1.5' }}>
                    {article.content_preview}...
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
              No articles found
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Interactive Entity Explorer
export const InteractiveEntityExplorer: React.FC = () => {
  const navigate = useNavigate();
  const [entityType, setEntityType] = useState<string>('all');
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntity, setSelectedEntity] = useState<any>(null);
  const [entityArticles, setEntityArticles] = useState<any[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);

  useEffect(() => {
    loadEntities();
  }, [entityType]);

  const loadEntities = async () => {
    setLoading(true);
    try {
      const params: any = { limit: 30 };
      if (entityType !== 'all') {
        params.entity_type = entityType;
      }
      const response = await axios.get(`${API_BASE}/analytics/top-entities-fixed`, { params });
      setEntities(response.data.entities || []);
    } catch (error) {
      console.error('Failed to load entities:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEntityClick = async (entity: any) => {
    setSelectedEntity(entity);
    setLoadingArticles(true);
    try {
      const entityName = entity.text || entity.entity || '';
      console.log('Searching for entity:', entityName);
      const response = await axios.post(`${API_BASE}/search/entity`, {
        entity_name: entityName,
        limit: 20
      });
      setEntityArticles(response.data.articles || []);
    } catch (error: any) {
      console.error('Failed to load articles:', error);
      console.error('Error details:', error.response?.data);
      setEntityArticles([]);
    } finally {
      setLoadingArticles(false);
    }
  };

  const entityTypes = ['all', 'PERSON', 'ORG', 'GPE', 'NORP', 'LOC', 'EVENT'];

  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      padding: '24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '600' }}>
        🏷️ Named Entity Explorer
      </h3>
      <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 20px 0' }}>
        Discover people, organizations, and locations mentioned in articles
      </p>

      {/* Entity Type Selector with Descriptions */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          {entityTypes.map((type) => {
            const info = type === 'all' 
              ? { label: 'All Entities', icon: '🌟', color: '#6b7280' }
              : ENTITY_TYPE_INFO[type] || { label: type, icon: '📌', color: '#6b7280' };
            
            return (
              <button
                key={type}
                onClick={() => setEntityType(type)}
                style={{
                  padding: '10px 16px',
                  background: entityType === type ? info.color : 'white',
                  color: entityType === type ? 'white' : '#374151',
                  border: `2px solid ${entityType === type ? info.color : '#e5e7eb'}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '13px',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>{info.icon}</span>
                {info.label}
              </button>
            );
          })}
        </div>

        {/* Description for selected type */}
        {entityType !== 'all' && ENTITY_TYPE_INFO[entityType] && (
          <div style={{
            padding: '12px 16px',
            background: '#f9fafb',
            borderLeft: `4px solid ${ENTITY_TYPE_INFO[entityType].color}`,
            borderRadius: '6px',
            fontSize: '13px',
            color: '#4b5563'
          }}>
            <strong>{ENTITY_TYPE_INFO[entityType].label}:</strong> {ENTITY_TYPE_INFO[entityType].description}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
          Loading entities...
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          {entities.map((entity, idx) => {
            const info = ENTITY_TYPE_INFO[entity.type] || { icon: '📌', color: '#6b7280', label: entity.type };
            return (
              <button
                key={idx}
                onClick={() => handleEntityClick(entity)}
                style={{
                  padding: '16px',
                  background: selectedEntity?.text === entity.text ? '#eff6ff' : 'white',
                  border: `2px solid ${selectedEntity?.text === entity.text ? info.color : '#e5e7eb'}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = info.color;
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  if (selectedEntity?.text !== entity.text) {
                    e.currentTarget.style.borderColor = '#e5e7eb';
                  }
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '20px' }}>{info.icon}</span>
                  <span style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    background: info.color,
                    color: 'white',
                    borderRadius: '4px',
                    fontWeight: '600'
                  }}>
                    {info.label}
                  </span>
                </div>
                <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px', color: '#111827' }}>
                  {entity.text || entity.entity}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  {entity.count} mentions
                  {entity.avg_sentiment !== undefined && entity.avg_sentiment !== null && (
                    <>
                      {' • Sentiment: '}
                      <span style={{
                        color: entity.avg_sentiment > 0.1 ? '#10b981' : entity.avg_sentiment < -0.1 ? '#ef4444' : '#6b7280',
                        fontWeight: '600'
                      }}>
                        {entity.avg_sentiment > 0 ? '+' : ''}{entity.avg_sentiment.toFixed(2)}
                      </span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedEntity && (
        <div style={{
          borderTop: '2px solid #e5e7eb',
          paddingTop: '20px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <span style={{ fontSize: '28px' }}>
              {ENTITY_TYPE_INFO[selectedEntity.type]?.icon || '📌'}
            </span>
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: '600' }}>
                {selectedEntity.text || selectedEntity.entity}
              </h4>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>
                {ENTITY_TYPE_INFO[selectedEntity.type]?.label || selectedEntity.type} • 
                {selectedEntity.count} mentions across {entityArticles.length} articles
              </div>
            </div>
          </div>
          
          {loadingArticles ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
              Loading articles...
            </div>
          ) : entityArticles.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto' }}>
              {entityArticles.map((article) => (
                <div
                  key={article.id}
                  onClick={() => navigate(`/article/${article.id}`)}
                  style={{
                    padding: '16px',
                    background: '#f9fafb',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    border: '1px solid #e5e7eb'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f3f4f6';
                    e.currentTarget.style.borderColor = '#3b82f6';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px', color: '#111827' }}>
                    {article.headline}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                    {new Date(article.publication_date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </div>
                  <div style={{ fontSize: '13px', color: '#4b5563', lineHeight: '1.5' }}>
                    {article.content_preview}...
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
              No articles found
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default { InteractiveKeywords, InteractiveEntityExplorer };
