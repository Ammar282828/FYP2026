import React, { useState, useMemo } from 'react';
import axios from 'axios';
import { Sparkles, X } from 'lucide-react';
import { API_BASE } from '../config';
import { useDateBounds } from '../hooks/useDataVersion';
import MarkdownLite from './ui/MarkdownLite';

interface SearchFilters {
  startDate?: string;
  endDate?: string;
  sentiment?: string;
  topic?: string;
  entityType?: string;
}

interface SearchResultsSummaryProps {
  totalResults: number;
  query?: string;
  filters?: SearchFilters;
  articles?: any[];
  onFilterRemove?: (key: string) => void;
  // Optional separate "loaded vs total" so the header can read
  // "Showing 1,000 of 38,021" when the backend paginates a much bigger
  // result set than the page is rendering.
  displayedCount?: number;
}

const SearchResultsSummary: React.FC<SearchResultsSummaryProps> = ({
  totalResults,
  query,
  filters,
  articles = [],
  onFilterRemove,
  displayedCount,
}) => {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [minBound, maxBound] = useDateBounds();

  const generateSummary = async () => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE}/analytics/ai-summary`, {
        start_date: filters?.startDate || minBound,
        end_date: filters?.endDate || maxBound,
        topic: filters?.topic
      });
      setSummary(response.data.summary);
    } catch (error) {
      console.error('Failed to generate summary:', error);
      setSummary('Failed to generate summary. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* Compute facet counts from the result set */
  const facets = useMemo(() => {
    if (!articles || articles.length === 0) return { sentiments: {}, topics: {} };

    const sentiments: Record<string, number> = {};
    const topics: Record<string, number> = {};

    articles.forEach((a: any) => {
      if (a.sentiment_label) {
        sentiments[a.sentiment_label] = (sentiments[a.sentiment_label] || 0) + 1;
      }
      if (a.topic_label) {
        const t = a.topic_label.replace(/_/g, ' ');
        topics[t] = (topics[t] || 0) + 1;
      }
    });

    return { sentiments, topics };
  }, [articles]);

  /* Build active filter pills */
  const activeFilters: { key: string; label: string }[] = [];
  if (filters?.sentiment) activeFilters.push({ key: 'sentiment', label: `Sentiment: ${filters.sentiment}` });
  if (filters?.topic) activeFilters.push({ key: 'topic', label: `Topic: ${filters.topic}` });
  if (filters?.entityType) activeFilters.push({ key: 'entityType', label: `Entity: ${filters.entityType}` });
  if (filters?.startDate && filters.startDate !== minBound) activeFilters.push({ key: 'startDate', label: `From: ${filters.startDate}` });
  if (filters?.endDate && filters.endDate !== maxBound) activeFilters.push({ key: 'endDate', label: `Until: ${filters.endDate}` });

  return (
    <div className="search-results-summary">
      <div className="summary-header">
        <h3>
          {displayedCount !== undefined && displayedCount < totalResults
            ? `Search Results: showing ${displayedCount.toLocaleString()} of ${totalResults.toLocaleString()} articles`
            : `Search Results: ${totalResults.toLocaleString()} article${totalResults !== 1 ? 's' : ''} found`}
        </h3>
        {!summary && (
          <button
            onClick={generateSummary}
            disabled={loading}
            className="generate-summary-btn"
          >
            <Sparkles size={14} aria-hidden />
            {loading ? 'Drafting summary…' : 'Summarize this slice'}
          </button>
        )}
      </div>

      {/* Active filter pills */}
      {activeFilters.length > 0 && (
        <div className="filter-pills">
          {activeFilters.map(f => (
            <span key={f.key} className="filter-pill">
              {f.label}
              {onFilterRemove && (
                <button
                  className="filter-pill-dismiss"
                  onClick={() => onFilterRemove(f.key)}
                  title="Remove filter"
                  aria-label={`Remove filter: ${f.label}`}
                >
                  <X size={12} aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Facet counts */}
      {articles.length > 0 && (
        <div className="facet-bar">
          {Object.entries(facets.sentiments)
            .sort(([, a], [, b]) => b - a)
            .map(([label, count]) => (
              <span key={label} className={`facet-chip facet-${label}`}>
                {label} ({count})
              </span>
            ))}
          {Object.entries(facets.topics)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([label, count]) => (
              <span key={label} className="facet-chip facet-topic">
                {label} ({count})
              </span>
            ))}
        </div>
      )}

      {summary && (
        <div className="ai-summary-box">
          <h4><Sparkles size={14} aria-hidden /> Summary</h4>
          <MarkdownLite source={summary} className="summary-content" />
        </div>
      )}
    </div>
  );
};

export default SearchResultsSummary;
