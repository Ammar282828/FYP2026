import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Search, Filter, Bookmark, X } from 'lucide-react';
import { API_BASE } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './ui/Toast';
import { useDateBounds } from '../hooks/useDataVersion';

interface SearchFilters {
  startDate?: string;
  endDate?: string;
  sentiment?: string;
  topic?: string;
  entityType?: string;
}

interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters?: SearchFilters;
  created_at: string;
}

interface SearchPanelProps {
  onResults: (results: any) => void;
  onFiltersChange?: (filters: SearchFilters) => void;
  onQueryChange?: (query: string) => void;
  /**
   * Externally controlled filter overrides — used when another widget
   * (e.g. CalendarHeatmap day-click, SentimentDistribution slice-click)
   * wants to drill into search with a pinned filter. We merge the override
   * into the panel's internal state when it changes by reference.
   */
  externalFilters?: Partial<SearchFilters> | null;
  /** True once a search has produced results — hides the suggested-keywords
   *  panel so the same dense "first impression" doesn't keep showing under
   *  the actual results. */
  hasResults?: boolean;
}

const SearchPanel: React.FC<SearchPanelProps> = ({ onResults, onFiltersChange, onQueryChange, externalFilters, hasResults }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  // Date bounds come from /data-version so we never silently exclude
  // articles when the corpus expands beyond 1990-1992.
  const [minBound, maxBound] = useDateBounds();
  const [searchType, setSearchType] = useState<'keyword' | 'entity'>('keyword');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState('relevance');
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSaved, setShowSaved] = useState(false);

  const [filters, setFilters] = useState<SearchFilters>({
    startDate: minBound,
    endDate: maxBound,
    sentiment: '',
    topic: '',
    entityType: ''
  });

  // When data-version arrives async after first render, widen the date
  // range to the corpus bounds — but only if the user hasn't touched the
  // dates yet (i.e. they're still equal to the previous bounds).
  useEffect(() => {
    setFilters(prev => {
      const wasUntouched = !prev.startDate || prev.startDate === '1990-01-01';
      const wasUntouchedEnd = !prev.endDate || prev.endDate === '2030-12-31';
      if (!wasUntouched && !wasUntouchedEnd) return prev;
      return {
        ...prev,
        ...(wasUntouched ? { startDate: minBound } : {}),
        ...(wasUntouchedEnd ? { endDate: maxBound } : {}),
      };
    });
  }, [minBound, maxBound]);

  useEffect(() => {
    loadSuggestions();
  }, []);

  // Merge in external filter overrides whenever the parent passes a new
  // reference. Skip when the override is null/empty so we don't fight the
  // user typing into a field. Filters that come in but are empty strings
  // are treated as "clear that field".
  useEffect(() => {
    if (!externalFilters) return;
    setFilters(prev => ({ ...prev, ...externalFilters }));
    // Open the filters drawer so the user sees what just got pinned.
    if (Object.keys(externalFilters).length > 0) setShowFilters(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalFilters]);

  const loadSavedSearches = useCallback(async () => {
    if (!user) return;
    try {
      const res = await axios.get(`${API_BASE}/bookmarks/saved-searches`);
      setSavedSearches(res.data.saved_searches || []);
    } catch (err) {
      console.error('Failed to load saved searches:', err);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadSavedSearches();
    } else {
      setSavedSearches([]);
    }
  }, [user, loadSavedSearches]);

  const handleSaveSearch = async () => {
    if (!user) return;
    if (!query.trim() && !filtersHaveValues()) {
      toast('Enter a query or filters before saving', 'error');
      return;
    }
    const name = window.prompt('Name this search:', query.trim() || 'My saved search');
    if (!name || !name.trim()) return;
    try {
      await axios.post(`${API_BASE}/bookmarks/saved-searches`, {
        name: name.trim(),
        query: query.trim(),
        filters,
      });
      toast('Search saved', 'success');
      loadSavedSearches();
    } catch (err: any) {
      console.error('Failed to save search:', err);
      toast(`Failed to save: ${err?.response?.data?.detail || err?.message || 'Unknown error'}`, 'error');
    }
  };

  const applySavedSearch = (s: SavedSearch) => {
    setQuery(s.query || '');
    if (s.filters) {
      setFilters({
        startDate: s.filters.startDate || '1990-01-01',
        endDate: s.filters.endDate || '1992-12-31',
        sentiment: s.filters.sentiment || '',
        topic: s.filters.topic || '',
        entityType: s.filters.entityType || '',
      });
    }
    setShowSaved(false);
    // run the search after state updates
    setTimeout(() => handleSearch(), 80);
  };

  const deleteSavedSearch = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API_BASE}/bookmarks/saved-searches/${id}`);
      setSavedSearches(prev => prev.filter(s => s.id !== id));
      toast('Saved search deleted', 'success');
    } catch (err) {
      console.error('Failed to delete saved search:', err);
      toast('Failed to delete saved search', 'error');
    }
  };

  const filtersHaveValues = () => {
    return !!(filters.sentiment || filters.topic || filters.entityType ||
      (filters.startDate && filters.startDate !== '1990-01-01') ||
      (filters.endDate && filters.endDate !== '1992-12-31'));
  };

  const loadSuggestions = async () => {
    try {
      const data = await axios.get(`${API_BASE}/suggestions/keywords`, {
        params: { limit: 30 }
      });
      setSuggestions(data.data.suggestions || []);
    } catch (error) {
      console.error('Failed to load suggestions:', error);
    }
  };

  const handleSearch = async () => {
    if (!query.trim() && !filters.sentiment && !filters.topic) {
      return;
    }

    setLoading(true);
    try {
      const searchParams = {
        query: query || undefined,
        start_date: filters.startDate,
        end_date: filters.endDate,
        sentiment: filters.sentiment || undefined,
        topic: filters.topic || undefined,
        entity_type: filters.entityType || undefined,
        sort_by: sortBy,
        limit: 100
      };

      let response;
      if (searchType === 'keyword' || !query) {
        response = await axios.post(`${API_BASE}/search/keyword`, searchParams);
      } else {
        response = await axios.post(`${API_BASE}/search/entity`, {
          entity_name: query,
          ...searchParams
        });
      }

      onResults(response.data);
      if (onFiltersChange) {
        onFiltersChange(filters);
      }
      if (onQueryChange) {
        onQueryChange(query);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateFilter = (key: keyof SearchFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      startDate: '1990-01-01',
      endDate: '1992-12-31',
      sentiment: '',
      topic: '',
      entityType: ''
    });
  };

  const activeFilterCount = Object.values(filters).filter(
    v => v && v !== '1990-01-01' && v !== '1992-12-31'
  ).length;

  return (
    <div className="search-panel-enhanced">
      {/* Single unified bar: keyword/entity toggle inline with the input,
          search button glued to the right. Eliminates the prior separate
          "header row" stack — was 3 rows, now 1. */}
      <div className="search-bar">
        <div className="search-mode-segmented" role="tablist" aria-label="Search type">
          <button
            role="tab"
            aria-selected={searchType === 'keyword'}
            className={searchType === 'keyword' ? 'active' : ''}
            onClick={() => setSearchType('keyword')}
            title="Search article text"
          >
            Keyword
          </button>
          <button
            role="tab"
            aria-selected={searchType === 'entity'}
            className={searchType === 'entity' ? 'active' : ''}
            onClick={() => setSearchType('entity')}
            title="Search by person / org / place"
          >
            Entity
          </button>
        </div>
        <div className="search-input-wrap">
          <Search className="search-input-icon" size={16} aria-hidden="true" />
          <input
            type="text"
            placeholder={
              searchType === 'keyword'
                ? 'Search articles…'
                : 'Search by person, organization, or location…'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            className="search-input"
            aria-label="Search query"
          />
          {query && (
            <button
              type="button"
              className="search-input-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              title="Clear"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <button
          onClick={handleSearch}
          disabled={loading}
          className="search-button"
        >
          {loading ? '…' : 'Search'}
        </button>
      </div>

      {/* Toolbar collapsed: Sort moved INTO the filters drawer (it's a
          rarely-changed control that doesn't need to live always-visible).
          Save + Saved unified into one Bookmark dropdown. Net: 4 controls
          → 2. */}
      <div className="search-toolbar">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`toolbar-button ${showFilters ? 'is-open' : ''}`}
          aria-expanded={showFilters}
        >
          <Filter size={14} aria-hidden="true" />
          Filters
          {activeFilterCount > 0 && <span className="toolbar-badge">{activeFilterCount}</span>}
        </button>
        {user && (
          <div className="saved-search-anchor">
            <button
              onClick={() => setShowSaved(v => !v)}
              className={`toolbar-button toolbar-button-ghost ${showSaved ? 'is-open' : ''}`}
              title="Saved searches"
              aria-expanded={showSaved}
            >
              <Bookmark size={14} aria-hidden="true" />
              Saved
              {savedSearches.length > 0 && <span className="toolbar-badge">{savedSearches.length}</span>}
            </button>
            {showSaved && (
              <div className="saved-search-menu">
                <div className="saved-search-menu__heading">
                  <span>Saved searches</span>
                  <button
                    type="button"
                    onClick={handleSaveSearch}
                    className="btn btn--ghost btn--sm"
                    title="Save current query + filters"
                  >
                    Save current
                  </button>
                </div>
                {savedSearches.length === 0 ? (
                  <div className="saved-search-menu__empty">
                    Nothing saved yet — pin a query and revisit it later.
                  </div>
                ) : (
                  savedSearches.map(s => (
                    <div
                      key={s.id}
                      onClick={() => applySavedSearch(s)}
                      className="saved-search-row"
                    >
                      <div className="saved-search-row__main">
                        <div className="saved-search-row__name">{s.name}</div>
                        {s.query && (
                          <div className="saved-search-row__query">"{s.query}"</div>
                        )}
                      </div>
                      <button
                        onClick={(e) => deleteSavedSearch(s.id, e)}
                        title="Delete saved search"
                        className="saved-search-row__delete"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showFilters && (
        <div className="filters-panel">
          <div className="filters-grid">
            <div className="filter-group">
              <label>From</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => updateFilter('startDate', e.target.value)}
                min="1990-01-01"
                max="1992-12-31"
              />
            </div>

            <div className="filter-group">
              <label>To</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => updateFilter('endDate', e.target.value)}
                min="1990-01-01"
                max="1992-12-31"
              />
            </div>

            <div className="filter-group">
              <label>Sentiment</label>
              <select
                value={filters.sentiment}
                onChange={(e) => updateFilter('sentiment', e.target.value)}
              >
                <option value="">Any</option>
                <option value="positive">Positive</option>
                <option value="neutral">Neutral</option>
                <option value="negative">Negative</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Topic</label>
              <input
                type="text"
                placeholder="e.g. Politics, Sports"
                value={filters.topic}
                onChange={(e) => updateFilter('topic', e.target.value)}
              />
            </div>

            <div className="filter-group">
              <label>Entity</label>
              <select
                value={filters.entityType}
                onChange={(e) => updateFilter('entityType', e.target.value)}
              >
                <option value="">Any</option>
                <option value="PERSON">People</option>
                <option value="ORG">Organizations</option>
                <option value="GPE">Locations</option>
                <option value="NORP">Groups</option>
                <option value="EVENT">Events</option>
              </select>
            </div>

            {/* Sort lives inside the drawer so it doesn't take a permanent
                slot in the always-visible toolbar. */}
            <div className="filter-group">
              <label>Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="relevance">Best matches</option>
                <option value="date">Newest first</option>
                <option value="date_asc">Oldest first</option>
                <option value="frequency">Most mentions</option>
                <option value="sentiment">Most positive</option>
                <option value="sentiment_asc">Most negative</option>
              </select>
            </div>
          </div>

          <div className="filter-actions">
            <button onClick={clearFilters} className="btn btn--ghost btn--sm">
              Clear
            </button>
            <button onClick={handleSearch} className="btn btn--primary btn--sm">
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Suggestions only show on the EMPTY-state landing — i.e. no query,
          no filters drawer open, no results yet. Once results are on
          screen the suggestions become visual noise: the user has clearly
          formed an intent. Reduced from 16 → 8 to lower visual weight. */}
      {suggestions.length > 0 && !showFilters && !query && !hasResults && (
        <div className="suggestions-panel">
          <h4>Suggested keywords</h4>
          <div className="suggestion-tags">
            {suggestions.slice(0, 8).map((s, idx) => (
              <button
                key={idx}
                className="suggestion-tag"
                onClick={() => {
                  setQuery(s.keyword);
                  setTimeout(handleSearch, 100);
                }}
                title={`${s.frequency} mentions`}
              >
                {s.keyword}
                <span className="freq-badge">{s.frequency}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchPanel;
