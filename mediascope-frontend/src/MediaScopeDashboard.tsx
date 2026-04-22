import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
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
import ArticleComparison from './components/ArticleComparison';
import ChatTab from './components/ChatTab';
import SearchTimeline from './components/SearchTimeline';
import DashboardHome from './components/DashboardHome';
import UserMenu from './components/UserMenu';
import AuthPage from './components/AuthPage';
import BookmarksPanel from './components/BookmarksPanel';
import CommandPalette from './components/CommandPalette';
import ShortcutsPanel from './components/ShortcutsPanel';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';
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
                style={{ padding: '4px 8px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
          <option value="">All Types</option>
          <option value="PERSON">People</option>
          <option value="ORG">Organizations</option>
          <option value="GPE">Locations</option>
          <option value="NORP">Nationalities</option>
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
               style={{ padding: '4px 8px', fontSize: '12px', border: '1px solid var(--border-color)', borderRadius: '4px' }} />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
               style={{ padding: '4px 8px', fontSize: '12px', border: '1px solid var(--border-color)', borderRadius: '4px' }} />
        <button onClick={loadTopEntities}
                style={{ padding: '4px 12px', fontSize: '13px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
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
              border: '1px solid var(--border-color)',
              borderLeft: `3px solid ${getEntityColor(entity.type)}`,
              borderRadius: '4px',
              fontSize: '13px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                <span style={{ fontSize: '14px' }}>{getEntityIcon(entity.type)}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>#{idx + 1}</span>
              </div>
              <div style={{ fontWeight: '600', fontSize: '16px', color: getEntityColor(entity.type), marginBottom: '2px' }}>
                {entity.count.toLocaleString()}
              </div>
              <div style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-primary)' }}>{entity.text}</div>
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
  const { user } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();

  const openRandomArticle = async () => {
    try {
      const res = await axios.get(`${API_BASE}/articles/random`);
      const id = res.data?.article?.id;
      if (id) navigate(`/article/${id}`);
    } catch (err) {
      console.error('Failed to load random article', err);
    }
  };
  const [searchResults, setSearchResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'analytics' | 'stories' | 'ocr' | 'ad-browser' | 'bookmarks' | 'chat' | 'compare'>('home');
  const [analyticsSubTab, setAnalyticsSubTab] = useState<'overview' | 'topics' | 'entities' | 'keywords'>('overview');
  const [searchFilters, setSearchFilters] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAuth, setShowAuth] = useState(false);

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
    setSearchQuery(query);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="logo-section" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('home')}>
            <h1>MediaScope</h1>
            <p className="tagline">Dawn Newspaper Archive (1990-1992)</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button className="cmd-k-hint" onClick={() => {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
            }}>
              <span style={{ opacity: 0.7 }}>{'\u2315'}</span> Search
              <kbd className="cmd-kbd-inline">{'\u2318'}K</kbd>
            </button>
            <button
              className="cmd-k-hint"
              onClick={openRandomArticle}
              title="Open a random article"
            >
              {'\uD83C\uDFB2'} Random
            </button>
            <button className="theme-toggle" onClick={toggleTheme}
              title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
              {theme === 'light' ? '\u263D' : '\u2600'}
            </button>
            <UserMenu
              onShowBookmarks={() => {
                if (user) {
                  setActiveTab('bookmarks');
                } else {
                  setShowAuth(true);
                }
              }}
              onShowAuth={() => setShowAuth(true)}
            />
          </div>
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
            className={activeTab === 'chat' ? 'active' : ''}
            onClick={() => setActiveTab('chat')}
          >
            {'\u{1F4AC}'} Ask AI
          </button>
          <button
            className={activeTab === 'analytics' ? 'active' : ''}
            onClick={() => setActiveTab('analytics')}
          >
            Analytics
          </button>
          {user && (
            <button
              className={activeTab === 'bookmarks' ? 'active' : ''}
              onClick={() => setActiveTab('bookmarks')}
            >
              Bookmarks
            </button>
          )}
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
          <button
            className={activeTab === 'compare' ? 'active' : ''}
            onClick={() => setActiveTab('compare')}
          >
            {'\u2194\uFE0F'} Compare
          </button>
        </nav>
      </header>

      {showAuth && <AuthPage onClose={() => setShowAuth(false)} />}
      <CommandPalette onNavigate={(tab: string) => setActiveTab(tab as any)} />
      <ShortcutsPanel />

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
              onQueryChange={setSearchQuery}
            />
            {searchResults && (
              <div className="search-results">
                <SearchResultsSummary
                  totalResults={searchResults.total}
                  filters={searchFilters}
                  articles={searchResults.articles || []}
                  onFilterRemove={(key) => {
                    setSearchFilters((prev: any) => {
                      if (!prev) return prev;
                      const updated = { ...prev };
                      if (key === 'startDate') updated.startDate = '1990-01-01';
                      else if (key === 'endDate') updated.endDate = '1992-12-31';
                      else (updated as any)[key] = '';
                      return updated;
                    });
                  }}
                />
                <SearchTimeline articles={searchResults.articles || []} />
                <ArticleList
                  articles={searchResults.articles || []}
                  onArticleDeleted={loadArticles}
                  highlightQuery={searchQuery}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'stories' && <StoriesTab />}

        {activeTab === 'compare' && <ArticleComparison />}

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

        {activeTab === 'bookmarks' && user && <BookmarksPanel />}

        {activeTab === 'ocr' && <OCRTab />}

        {activeTab === 'ad-browser' && <AdBrowserTab />}

        {activeTab === 'chat' && <ChatTab />}
      </main>
    </div>
  );
};

export default MediaScopeDashboard;
