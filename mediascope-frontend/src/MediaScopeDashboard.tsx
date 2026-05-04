import React, { useState, useEffect, useMemo } from 'react';
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
import { ArticlesOverTime } from './components/AnalyticsCharts';
import { WordCountDistribution, PageDistribution, SourceDistribution } from './components/CorpusAnalytics';
import CalendarHeatmap from './components/CalendarHeatmap';
import CompareTab from './components/CompareTab';
import OCRTab from './components/OCRTab';
import AdBrowserTab from './components/AdBrowserTab';
import StoriesTab from './components/StoriesTab';
import ArticleComparison from './components/ArticleComparison';
import ChatTab from './components/ChatTab';
import BrowseByDateTab from './components/BrowseByDateTab';
import SearchTimeline from './components/SearchTimeline';
import DashboardHome from './components/DashboardHome';
import UserMenu from './components/UserMenu';
import AuthPage from './components/AuthPage';
import ProfilePanel from './components/ProfilePanel';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';
import { API_BASE } from './config';
import { useDateBounds } from './hooks/useDataVersion';
import { useQueryState } from './hooks/useQueryState';
import DateRangePicker from './components/ui/DateRangePicker';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { Skeleton } from './components/ui/Skeleton';
import EmptyState from './components/ui/EmptyState';
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
    const response = await axios.get(`${API_BASE}/analytics/sentiment-overview`);
    return response.data;
  }
};

const TopEntitiesPanel: React.FC = () => {
  const [minBound, maxBound] = useDateBounds();
  const [entityType, setEntityType] = useState<string>('');
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(minBound);
  const [endDate, setEndDate] = useState(maxBound);

  // Sync the inputs to the corpus bounds once they arrive (only if the user
  // hasn't moved them away from the previous defaults).
  useEffect(() => {
    setStartDate(prev => (!prev || prev === '1990-01-01' ? minBound : prev));
    setEndDate(prev => (!prev || prev === '1992-12-31' ? maxBound : prev));
  }, [minBound, maxBound]);

  const loadTopEntities = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTopEntities(entityType || undefined, 15, startDate, endDate);
      setEntities(data.entities || []);
    } catch (err: any) {
      console.error('Error loading entities:', err);
      setError(err?.message || 'Failed to load entities');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTopEntities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, startDate, endDate]);

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
      <div className="entity-toolbar">
        <h3 className="section-title" style={{ margin: 0 }}>Top entities</h3>
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
        </select>
        <DateRangePicker
          from={startDate}
          to={endDate}
          onChange={(f, t) => { setStartDate(f); setEndDate(t); }}
          compact
        />
        <button onClick={loadTopEntities} className="btn btn--primary btn--sm">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="entity-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} height="56px" borderRadius="4px" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Couldn't load entities"
          description={error}
          action={{ label: 'Retry', onClick: loadTopEntities }}
        />
      ) : entities.length > 0 ? (
        <div className="entity-grid">
          {entities.map((entity, idx) => (
            <div
              key={idx}
              className="entity-card"
              style={{ borderLeftColor: getEntityColor(entity.type) }}
            >
              <div className="entity-card__rank">#{idx + 1}</div>
              <div className="entity-card__count" style={{ color: getEntityColor(entity.type) }}>
                {entity.count.toLocaleString()}
              </div>
              <div className="entity-card__text">{entity.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No entities in this range"
          description="Try widening the date range or switching the entity type filter."
        />
      )}
    </div>
  );
};


const MediaScopeDashboard: React.FC = () => {
  const { user } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [minBound, maxBound] = useDateBounds();
  const mastheadDate = useMemo(() => (
    new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date())
  ), []);

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
  // Persist the top-level tab and the analytics sub-tab in the URL so views
  // are linkable: e.g. /?tab=analytics&sub=corpus opens straight to that view.
  const [tabParam, setTabParam] = useQueryState('tab', 'home');
  const [subParam, setSubParam] = useQueryState('sub', 'overview');
  const activeTab = tabParam as 'home' | 'search' | 'analytics' | 'stories' | 'ocr' | 'ad-browser' | 'bookmarks' | 'profile' | 'chat' | 'compare' | 'periods' | 'by-date';
  const setActiveTab = (t: typeof activeTab) => setTabParam(t);
  const analyticsSubTab = subParam as 'overview' | 'topics' | 'entities' | 'keywords' | 'corpus';
  const setAnalyticsSubTab = (t: typeof analyticsSubTab) => setSubParam(t);
  const [searchFilters, setSearchFilters] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAuth, setShowAuth] = useState(false);

  const loadArticles = async () => {
    // Without an explicit limit the API caps at 100 raw docs, of which ~28
    // get dropped as classifieds — so the default landing view was only
    // showing 72 articles out of ~4k. Ask for a real default that surfaces
    // a meaningful slice of the archive.
    try {
      const response = await axios.get(`${API_BASE}/articles`, { params: { limit: 1000 } });
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
        <div className="dashboard-masthead">
          <div className="logo-section" onClick={() => setActiveTab('home')}>
            <h1>MediaScope</h1>
            <p className="tagline">Dawn Newspaper Archive (1990-1992)</p>
          </div>
          <div className="masthead-date">{mastheadDate}</div>
          <div className="dashboard-actions">
            <button className="cmd-k-hint" onClick={() => {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
            }}>
              <span className="cmd-k-hint__mark">{'\u2315'}</span> Search
              <kbd className="cmd-kbd-inline">{'\u2318'}K</kbd>
            </button>
            <button
              className="cmd-k-hint"
              onClick={openRandomArticle}
              title="Open a random article"
            >
              Random
            </button>
            <button className="theme-toggle" onClick={toggleTheme}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
              {theme === 'light' ? '\u263D' : '\u2600'}
            </button>
            <button
              className="theme-toggle"
              onClick={() => {
                // ShortcutsPanel listens for '?' globally — synthesize one.
                window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
              }}
              title="Keyboard shortcuts"
              aria-label="Keyboard shortcuts"
              style={{ fontSize: 14, fontWeight: 700 }}
            >
              ?
            </button>
            <UserMenu
              onShowProfile={() => {
                if (user) {
                  setActiveTab('profile');
                } else {
                  setShowAuth(true);
                }
              }}
              onShowBookmarks={() => {
                if (user) {
                  setActiveTab('profile');
                } else {
                  setShowAuth(true);
                }
              }}
              onShowAuth={() => setShowAuth(true)}
            />
          </div>
        </div>
        {/*
          Top nav is grouped into four sections (Read / Analyze / Tools / You)
          to make a 9-button bar scannable. Group rendering is data-driven so
          adding a new tab only edits the array, not JSX. Emojis removed for
          consistency — the whole bar uses plain text labels.
        */}
        <nav className="dashboard-nav" aria-label="Primary">
          {([
            {
              group: 'Read',
              items: [
                { id: 'search', label: 'Search' },
                { id: 'by-date', label: 'Browse by date', title: 'See every article from a single day or range' },
                { id: 'stories', label: 'Stories' },
              ],
            },
            {
              group: 'Analyze',
              items: [
                { id: 'analytics', label: 'Analytics' },
                { id: 'periods', label: 'Compare periods', title: 'Compare two date ranges' },
                { id: 'compare', label: 'Compare articles', title: 'Compare two specific articles' },
                { id: 'chat', label: 'Ask AI' },
              ],
            },
            {
              group: 'Tools',
              items: [
                { id: 'ocr', label: 'OCR' },
                { id: 'ad-browser', label: 'Ad Browser' },
              ],
            },
            ...(user
              ? [{
                  group: 'You',
                  items: [{ id: 'profile', label: 'Profile', title: 'Bookmarks, history & account' }],
                }]
              : []),
          ] as { group: string; items: { id: typeof activeTab; label: string; title?: string }[] }[])
            .map((section, idx, arr) => (
              <React.Fragment key={section.group}>
                <div className="nav-group" role="group" aria-label={section.group}>
                  {section.items.map(item => (
                    <button
                      key={item.id}
                      className={activeTab === item.id ? 'active' : ''}
                      onClick={() => setActiveTab(item.id)}
                      title={item.title}
                      aria-current={activeTab === item.id ? 'page' : undefined}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                {idx < arr.length - 1 && <span className="nav-group-sep" aria-hidden />}
              </React.Fragment>
            ))}
        </nav>
      </header>

      {showAuth && <AuthPage onClose={() => setShowAuth(false)} />}
      {/* CommandPalette + ShortcutsPanel + global keyboard handler are
          mounted at App level so they work on every route. Tab nav goes
          via the URL (`?tab=...`), which this dashboard already reads. */}

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
              externalFilters={searchFilters}
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
                      if (key === 'startDate') updated.startDate = minBound;
                      else if (key === 'endDate') updated.endDate = maxBound;
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

        {activeTab === 'by-date' && <BrowseByDateTab />}

        {activeTab === 'stories' && <StoriesTab />}

        {activeTab === 'compare' && <ArticleComparison />}

        {activeTab === 'analytics' && (
          <div className="analytics-view">
            <AnalyticsSummary />

            {/* Analytics sub-nav — labels are data, not 5-line conditional JSX. */}
            <div className="analytics-subnav" role="tablist" aria-label="Analytics sections">
              {([
                { id: 'overview', label: 'Overview' },
                { id: 'topics', label: 'Topics' },
                { id: 'entities', label: 'Entities' },
                { id: 'keywords', label: 'Keywords' },
                { id: 'corpus', label: 'Corpus' },
              ] as const).map(t => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={analyticsSubTab === t.id}
                  className={`analytics-subnav-btn ${analyticsSubTab === t.id ? 'active' : ''}`}
                  onClick={() => setAnalyticsSubTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="analytics-section">
              {analyticsSubTab === 'overview' && (
                <>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Coverage calendar">
                      <CalendarHeatmap onDayClick={(date) => {
                        // Drill in: switch to search and pin both date filters to this day.
                        setSearchFilters((prev: any) => ({ ...(prev || {}), startDate: date, endDate: date }));
                        setActiveTab('search');
                      }} />
                    </ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Articles over time">
                      <ArticlesOverTime
                        onMonthClick={(month) => {
                          // month is YYYY-MM. Snap to first/last day of that month.
                          if (!/^\d{4}-\d{2}$/.test(month)) return;
                          const [y, m] = month.split('-').map(Number);
                          const last = new Date(y, m, 0).getDate();
                          const start = `${month}-01`;
                          const end = `${month}-${String(last).padStart(2, '0')}`;
                          setSearchFilters((prev: any) => ({ ...(prev || {}), startDate: start, endDate: end }));
                          setActiveTab('search');
                        }}
                      />
                    </ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Coverage by month"><CoverageHeatmap /></ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Sentiment distribution">
                      <SentimentDistribution
                        onSliceClick={(label) => {
                          // Drill in: pin sentiment filter and switch to search.
                          setSearchFilters((prev: any) => ({ ...(prev || {}), sentiment: label }));
                          setActiveTab('search');
                        }}
                      />
                    </ErrorBoundary>
                  </div>
                </>
              )}

              {analyticsSubTab === 'topics' && (
                <>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Topic distribution"><TopicDistribution /></ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Topic trends over time"><TopicTrendsOverTime /></ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Topic sentiment over time"><TopicSentimentOverTime /></ErrorBoundary>
                  </div>
                </>
              )}

              {analyticsSubTab === 'entities' && (
                <>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Entity explorer"><InteractiveEntityExplorer /></ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Top entities"><TopEntitiesPanel /></ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Entity co-occurrence network"><EntityCooccurrenceNetwork /></ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Entity sentiment over time"><EntitySentimentOverTime /></ErrorBoundary>
                  </div>
                </>
              )}

              {analyticsSubTab === 'keywords' && (
                <>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Interactive keywords"><InteractiveKeywords /></ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Keyword frequency over time"><KeywordFrequencyOverTime /></ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Keyword sentiment over time"><KeywordSentimentOverTime /></ErrorBoundary>
                  </div>
                </>
              )}

              {analyticsSubTab === 'corpus' && (
                <>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Article length"><WordCountDistribution /></ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Page distribution"><PageDistribution /></ErrorBoundary>
                  </div>
                  <div className="analytics-card full-width">
                    <ErrorBoundary label="Source distribution"><SourceDistribution /></ErrorBoundary>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Bookmarks tab is kept as a deep-link target (e.g. older
            bookmarked URLs) but visually it lands inside the Profile
            panel's Bookmarks sub-tab so there's a single home for "You". */}
        {activeTab === 'bookmarks' && user && (
          <ProfilePanel initialSubTab="bookmarks" onShowAuth={() => setShowAuth(true)} />
        )}
        {activeTab === 'profile' && (
          <ProfilePanel onShowAuth={() => setShowAuth(true)} />
        )}

        {activeTab === 'ocr' && <OCRTab />}

        {activeTab === 'ad-browser' && <AdBrowserTab />}

        {activeTab === 'chat' && <ChatTab />}

        {activeTab === 'periods' && (
          <ErrorBoundary label="Compare periods"><CompareTab /></ErrorBoundary>
        )}
      </main>
    </div>
  );
};

export default MediaScopeDashboard;
