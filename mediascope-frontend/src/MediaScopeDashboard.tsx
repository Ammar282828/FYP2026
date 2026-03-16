import React, { useState, useEffect } from 'react';
import axios from 'axios';
import SearchPanel from './components/SearchPanel';
import ArticleList from './components/ArticleList';
import SearchResultsSummary from './components/SearchResultsSummary';
import {
  AnalyticsSummary,
  SentimentDistribution,
  TopicDistribution,
  TopicTrendsOverTime,
  EntityCooccurrenceNetwork,
  TopicSentimentOverTime,
  EntitySentimentOverTime,
  KeywordSentimentOverTime,
  CoverageHeatmap
} from './components/EnhancedAnalytics';
import {
  KeywordFrequencyOverTime
} from './components/AdvancedAnalytics';
import { InteractiveKeywords, InteractiveEntityExplorer } from './components/ProfessionalAnalytics';
import OCRTab from './components/OCRTab';
import AdBrowserTab from './components/AdBrowserTab';
import StoriesTab from './components/StoriesTab';
import DashboardHome from './components/DashboardHome';
import { API_BASE } from './config';
import './mediascope-dashboard.css';

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

  const getEntityIcon = (_type: string) => '';

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
          <option value="PERSON">People</option>
          <option value="ORG">Organizations</option>
          <option value="GPE">Locations</option>
          <option value="NORP">Nationalities</option>
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


const MediaScopeDashboard: React.FC = () => {
  const [searchResults, setSearchResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'analytics' | 'stories' | 'ocr' | 'ad-browser'>('home');
  const [analyticsSubTab, setAnalyticsSubTab] = useState<'overview' | 'topics' | 'entities' | 'keywords'>('overview');
  const [searchFilters, setSearchFilters] = useState<any>(null);

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

  useEffect(() => {
    loadArticles();
  }, []);

  const handleDashboardSearch = async (query: string) => {
    try {
      const response = await axios.post(`${API_BASE}/search/keyword`, { keyword: query, limit: 100 });
      setSearchResults({ total: response.data.total, articles: response.data.articles });
    } catch {
      // fall through to search tab anyway
    }
    setActiveTab('search');
  };

  return (
    <div className="mediascope-dashboard">
      <header className="dashboard-header">
        <div className="logo-section" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('home')}>
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
            className={activeTab === 'stories' ? 'active' : ''}
            onClick={() => setActiveTab('stories')}
          >
            Stories
          </button>
          <button
            className={activeTab === 'analytics' ? 'active' : ''}
            onClick={() => setActiveTab('analytics')}
          >
            Analytics
          </button>
          <button
            className={activeTab === 'ocr' ? 'active' : ''}
            onClick={() => setActiveTab('ocr')}
          >
            OCR
          </button>
          <button
            className={activeTab === 'ad-browser' ? 'active' : ''}
            onClick={() => setActiveTab('ad-browser')}
          >
            Ad Browser
          </button>
        </nav>
      </header>

      <main className="dashboard-main">
        {activeTab === 'home' && (
          <DashboardHome
            recentArticles={searchResults?.articles || []}
            onSearch={handleDashboardSearch}
            onNavigate={(tab) => setActiveTab(tab)}
          />
        )}

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
                <ArticleList
                  articles={searchResults.articles || []}
                  onArticleDeleted={loadArticles}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'stories' && <StoriesTab />}

        {activeTab === 'analytics' && (
          <div className="analytics-view">
            <AnalyticsSummary />

            {/* Analytics sub-nav */}
            <div className="analytics-subnav">
              {(['overview', 'topics', 'entities', 'keywords'] as const).map(tab => (
                <button
                  key={tab}
                  className={`analytics-subnav-btn ${analyticsSubTab === tab ? 'active' : ''}`}
                  onClick={() => setAnalyticsSubTab(tab)}
                >
                  {tab === 'overview' && 'Overview'}
                  {tab === 'topics' && 'Topics'}
                  {tab === 'entities' && 'Entities'}
                  {tab === 'keywords' && 'Keywords'}
                </button>
              ))}
            </div>

            <div className="analytics-section">
              {analyticsSubTab === 'overview' && (
                <>
                  <div className="analytics-card full-width">
                    <CoverageHeatmap />
                  </div>
                  <div className="analytics-card full-width">
                    <SentimentDistribution />
                  </div>
                </>
              )}

              {analyticsSubTab === 'topics' && (
                <>
                  <div className="analytics-card full-width">
                    <TopicDistribution />
                  </div>
                  <div className="analytics-card full-width">
                    <TopicTrendsOverTime />
                  </div>
                  <div className="analytics-card full-width">
                    <TopicSentimentOverTime />
                  </div>
                </>
              )}

              {analyticsSubTab === 'entities' && (
                <>
                  <div className="analytics-card full-width">
                    <InteractiveEntityExplorer />
                  </div>
                  <div className="analytics-card full-width">
                    <TopEntitiesPanel />
                  </div>
                  <div className="analytics-card full-width">
                    <EntityCooccurrenceNetwork />
                  </div>
                  <div className="analytics-card full-width">
                    <EntitySentimentOverTime />
                  </div>
                </>
              )}

              {analyticsSubTab === 'keywords' && (
                <>
                  <div className="analytics-card full-width">
                    <InteractiveKeywords />
                  </div>
                  <div className="analytics-card full-width">
                    <KeywordFrequencyOverTime />
                  </div>
                  <div className="analytics-card full-width">
                    <KeywordSentimentOverTime />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'ocr' && <OCRTab />}

        {activeTab === 'ad-browser' && <AdBrowserTab />}
      </main>
    </div>
  );
};

export default MediaScopeDashboard;
