import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';

interface SearchFilters {
  startDate?: string;
  endDate?: string;
  sentiment?: string;
  topic?: string;
  entityType?: string;
}

interface SearchPanelProps {
  onResults: (results: any) => void;
  onFiltersChange?: (filters: SearchFilters) => void;
}

const SearchPanel: React.FC<SearchPanelProps> = ({ onResults, onFiltersChange }) => {
  const [searchType, setSearchType] = useState<'keyword' | 'entity'>('keyword');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState('date');

  const [filters, setFilters] = useState<SearchFilters>({
    startDate: '1990-01-01',
    endDate: '1992-12-31',
    sentiment: '',
    topic: '',
    entityType: ''
  });

  useEffect(() => {
    loadSuggestions();
  }, []);

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
      <div className="search-header">
        <h2>Search Dawn Archives (1990-1992)</h2>
        <div className="search-type-tabs">
          <button
            className={searchType === 'keyword' ? 'active' : ''}
            onClick={() => setSearchType('keyword')}
          >
            Keyword Search
          </button>
          <button
            className={searchType === 'entity' ? 'active' : ''}
            onClick={() => setSearchType('entity')}
          >
            Entity Search
          </button>
        </div>
      </div>

      <div className="search-input-group">
        <input
          type="text"
          placeholder={
            searchType === 'keyword'
              ? 'Search articles by keyword...'
              : 'Search by person, organization, or location...'
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          className="search-input"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="sort-select"
          title="Sort results by"
        >
          <option value="date">Newest First</option>
          <option value="date_asc">Oldest First</option>
          <option value="relevance">Most Relevant</option>
          <option value="frequency">Most Mentions</option>
          <option value="sentiment">Most Positive</option>
          <option value="sentiment_asc">Most Negative</option>
        </select>
        <button
          onClick={handleSearch}
          disabled={loading}
          className="search-button"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="filter-toggle-button"
        >
          Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
        </button>
      </div>

      {showFilters && (
        <div className="filters-panel">
          <div className="filters-grid">
            <div className="filter-group">
              <label>Start Date</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => updateFilter('startDate', e.target.value)}
                min="1990-01-01"
                max="1992-12-31"
              />
            </div>

            <div className="filter-group">
              <label>End Date</label>
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
                <option value="">All Sentiments</option>
                <option value="positive">Positive</option>
                <option value="neutral">Neutral</option>
                <option value="negative">Negative</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Topic</label>
              <input
                type="text"
                placeholder="e.g., Politics, Sports"
                value={filters.topic}
                onChange={(e) => updateFilter('topic', e.target.value)}
              />
            </div>

            <div className="filter-group">
              <label>Entity Type</label>
              <select
                value={filters.entityType}
                onChange={(e) => updateFilter('entityType', e.target.value)}
              >
                <option value="">All Types</option>
                <option value="PERSON">People</option>
                <option value="ORG">Organizations</option>
                <option value="GPE">Locations</option>
                <option value="NORP">Groups</option>
                <option value="EVENT">Events</option>
              </select>
            </div>
          </div>

          <div className="filter-actions">
            <button onClick={clearFilters} className="clear-filters-btn">
              Clear Filters
            </button>
            <button onClick={handleSearch} className="apply-filters-btn">
              Apply Filters
            </button>
          </div>
        </div>
      )}

      {suggestions.length > 0 && !showFilters && (
        <div className="suggestions-panel">
          <h4>Popular Keywords:</h4>
          <div className="suggestion-tags">
            {suggestions.slice(0, 20).map((s, idx) => (
              <button
                key={idx}
                className="suggestion-tag"
                onClick={() => {
                  setQuery(s.keyword);
                  setTimeout(handleSearch, 100);
                }}
              >
                {s.keyword} <span className="freq-badge">({s.frequency})</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchPanel;
