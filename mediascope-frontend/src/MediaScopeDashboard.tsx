import React, { useState, useEffect } from 'react';
import axios from 'axios';
import SearchPanel from './components/SearchPanel';
import ArticleList from './components/ArticleList';
import SearchResultsSummary from './components/SearchResultsSummary';
import {
  AnalyticsSummary,
  TopicDistribution,
  TopicTrendsOverTime,
  EntityCooccurrenceNetwork,
  TopicSentimentOverTime,
  EntitySentimentOverTime,
  KeywordSentimentOverTime
} from './components/EnhancedAnalytics';
import {
  KeywordFrequencyOverTime,
  EntityMentionsOverTime
} from './components/AdvancedAnalytics';
import ImageAnalysisTab from './components/ImageAnalysisTab';
import OCRTab from './components/OCRTab';
import { API_BASE } from './config';

const api = {
  getTopEntities: async (type?: string, limit = 10, startDate?: string, endDate?: string) => {
    const response = await axios.get(`${API_BASE}/analytics/top-entities-fixed`, {
      params: {
        entity_type: type,
        limit,
        start_date: startDate,
        end_date: endDate
      }
    });
    return response.data;
  },

  getSentimentOverview: async () => {
    const response = await axios.get(`${API_BASE}/analytics/sentiment-fixed`);
    return response.data;
  }
};

const TopEntitiesPanel: React.FC = () => {
  const [entityType, setEntityType] = useState<string>('');
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('1990-01-01');
  const [endDate, setEndDate] = useState('1992-12-31');

  const loadTopEntities = async () => {
    setLoading(true);
    try {
      const data = await api.getTopEntities(entityType || undefined, 15, startDate, endDate);
      setEntities(data.entities || []);
    } catch (error) {
      console.error('Error loading entities:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTopEntities();
  }, [entityType]);

  const getEntityIcon = (type: string) => {
    switch(type) {
      case 'PERSON': return '👤';
      case 'ORG': return '🏢';
      case 'GPE': return '📍';
      case 'NORP': return '🌐';
      default: return '🏷️';
    }
  };

  const getEntityColor = (type: string) => {
    switch(type) {
      case 'PERSON': return '#667eea';
      case 'ORG': return '#f59e0b';
      case 'GPE': return '#10b981';
      case 'NORP': return '#8b5cf6';
      default: return '#6b7280';
    }
  };

  return (
    <div className="top-entities-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Top Entities</h3>
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '4px' }}>
          <option value="">All Types</option>
          <option value="PERSON">👤 People</option>
          <option value="ORG">🏢 Organizations</option>
          <option value="GPE">📍 Locations</option>
          <option value="NORP">🌐 Nationalities</option>
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
               style={{ padding: '4px 8px', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px' }} />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
               style={{ padding: '4px 8px', fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '4px' }} />
        <button onClick={loadTopEntities}
                style={{ padding: '4px 12px', fontSize: '13px', background: '#667eea', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      {loading ? (
        <p style={{ margin: '1rem 0', fontSize: '14px' }}>Loading...</p>
      ) : entities.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.5rem' }}>
          {entities.map((entity, idx) => (
            <div key={idx} style={{
              padding: '8px',
              border: '1px solid #e5e7eb',
              borderLeft: `3px solid ${getEntityColor(entity.type)}`,
              borderRadius: '4px',
              fontSize: '13px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                <span style={{ fontSize: '14px' }}>{getEntityIcon(entity.type)}</span>
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>#{idx + 1}</span>
              </div>
              <div style={{ fontWeight: '600', fontSize: '16px', color: getEntityColor(entity.type), marginBottom: '2px' }}>
                {entity.count.toLocaleString()}
              </div>
              <div style={{ fontSize: '12px', fontWeight: '500', color: '#374151' }}>{entity.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: '1rem 0', fontSize: '14px' }}>No entities found</p>
      )}
    </div>
  );
};

const EntityCooccurrence: React.FC = () => {
  const [entityType, setEntityType] = useState<string>('');
  const [cooccurrences, setCooccurrences] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadCooccurrences = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/analytics/entity-cooccurrence`, {
        params: {
          entity_type: entityType || undefined,
          min_count: 3,
          limit: 30
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
    loadCooccurrences();
  }, [entityType]);

  return (
    <div className="entity-cooccurrence">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>Entity Relationships</h3>
        <span style={{ fontSize: '13px', color: '#6b7280' }}>- Entities mentioned together in articles</span>
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '13px', border: '1px solid #e5e7eb', borderRadius: '4px', marginLeft: 'auto' }}>
          <option value="">All Types</option>
          <option value="PERSON">People</option>
          <option value="ORG">Organizations</option>
          <option value="GPE">Locations</option>
        </select>
      </div>

      {loading ? (
        <p style={{ margin: '1rem 0', fontSize: '14px' }}>Loading...</p>
      ) : cooccurrences.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.5rem' }}>
          {cooccurrences.map((pair, idx) => (
            <div key={idx} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              border: '1px solid #e5e7eb',
              borderRadius: '4px',
              fontSize: '13px',
              background: '#fafafa'
            }}>
              <span style={{ fontSize: '11px', color: '#9ca3af', minWidth: '24px' }}>#{idx + 1}</span>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: '500', color: '#374151' }}>{pair.entity1}</span>
                <span style={{ color: '#9ca3af' }}>⟷</span>
                <span style={{ fontWeight: '500', color: '#374151' }}>{pair.entity2}</span>
              </div>
              <span style={{
                fontSize: '12px',
                fontWeight: '600',
                color: '#667eea',
                background: '#eef2ff',
                padding: '2px 8px',
                borderRadius: '12px'
              }}>
                {pair.cooccurrence_count}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: '1rem 0', fontSize: '14px' }}>No co-occurrences found</p>
      )}
    </div>
  );
};

const MediaScopeDashboard: React.FC = () => {
  const [searchResults, setSearchResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'search' | 'analytics' | 'image-analysis' | 'ocr'>('search');
  const [searchFilters, setSearchFilters] = useState<any>(null);

  useEffect(() => {
    const loadArticles = async () => {
      try {
        const response = await axios.get(`${API_BASE}/articles`);
        setSearchResults({
          total: response.data.articles.length,
          articles: response.data.articles
        });
      } catch (error) {
        console.error('Failed to load articles:', error);
      }
    };
    loadArticles();
  }, []);

  return (
    <div className="mediascope-dashboard">
      <header className="dashboard-header">
        <div className="logo-section">
          <h1>MediaScope</h1>
          <p className="tagline">Dawn Newspaper Archive (1990-1992)</p>
        </div>
        <nav className="dashboard-nav">
          <button
            className={activeTab === 'search' ? 'active' : ''}
            onClick={() => setActiveTab('search')}
          >
            Search
          </button>
          <button
            className={activeTab === 'analytics' ? 'active' : ''}
            onClick={() => setActiveTab('analytics')}
          >
            Analytics
          </button>
          <button
            className={activeTab === 'image-analysis' ? 'active' : ''}
            onClick={() => setActiveTab('image-analysis')}
          >
            Ad Analysis <span style={{fontSize: '0.7em', opacity: 0.8}}>(Beta)</span>
          </button>
          <button
            className={activeTab === 'ocr' ? 'active' : ''}
            onClick={() => setActiveTab('ocr')}
          >
            OCR
          </button>
        </nav>
      </header>

      <main className="dashboard-main">
        {activeTab === 'search' && (
          <div className="search-view">
            <SearchPanel
              onResults={setSearchResults}
              onFiltersChange={setSearchFilters}
            />
            {searchResults && (
              <div className="search-results">
                <SearchResultsSummary
                  totalResults={searchResults.total}
                  filters={searchFilters}
                />
                <ArticleList articles={searchResults.articles || []} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="analytics-view">
            {/* Summary Cards */}
            <AnalyticsSummary />

            {/* Single streamlined analytics page */}
            <div className="analytics-section">
              <h2 className="analytics-section-title">Archive Analytics</h2>
              <p className="analytics-section-subtitle">
                Comprehensive analysis of the newspaper archive
              </p>

              {/* Row 1: Topics */}
              <div className="analytics-card full-width">
                <TopicDistribution />
              </div>

              {/* Row 2: Topic Trends Over Time */}
              <div className="analytics-card full-width">
                <TopicTrendsOverTime />
              </div>

              {/* Row 3: Top Entities */}
              <div className="analytics-card full-width">
                <TopEntitiesPanel />
              </div>

              {/* Row 4: Entity Relationships */}
              <div className="analytics-card full-width">
                <EntityCooccurrenceNetwork />
              </div>

              {/* Row 5: Keyword Trends */}
              <div className="analytics-card full-width">
                <KeywordFrequencyOverTime />
              </div>

              {/* Row 6: Topic Sentiment Over Time */}
              <div className="analytics-card full-width">
                <TopicSentimentOverTime />
              </div>

              {/* Row 7: Entity Sentiment Over Time */}
              <div className="analytics-card full-width">
                <EntitySentimentOverTime />
              </div>

              {/* Row 8: Keyword Sentiment Over Time */}
              <div className="analytics-card full-width">
                <KeywordSentimentOverTime />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'image-analysis' && <ImageAnalysisTab />}

        {activeTab === 'ocr' && <OCRTab />}
      </main>
    </div>
  );
};

export default MediaScopeDashboard;
