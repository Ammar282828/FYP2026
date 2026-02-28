import React, { useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';

interface SearchResultsSummaryProps {
  totalResults: number;
  query?: string;
  filters?: any;
}

const SearchResultsSummary: React.FC<SearchResultsSummaryProps> = ({
  totalResults,
  query,
  filters
}) => {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generateSummary = async () => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE}/analytics/ai-summary`, {
        start_date: filters?.startDate || '1990-01-01',
        end_date: filters?.endDate || '1992-12-31',
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

  return (
    <div className="search-results-summary">
      <div className="summary-header">
        <h3>Search Results: {totalResults} articles found</h3>
        {!summary && (
          <button
            onClick={generateSummary}
            disabled={loading}
            className="generate-summary-btn"
          >
            {loading ? 'Generating AI Summary...' : 'Generate AI Summary'}
          </button>
        )}
      </div>

      {summary && (
        <div className="ai-summary-box">
          <h4>AI-Generated Summary</h4>
          <div className="summary-content">
            {summary.split('\n').map((para, idx) => (
              para.trim() && <p key={idx}>{para}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchResultsSummary;
