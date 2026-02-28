import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';
import './NewspaperBrowser.css';

interface Newspaper {
  id: string;
  publication_date: string;
  page_number: number;
  section: string;
  article_count: number;
  avg_sentiment: number;
}

interface Article {
  id: string;
  article_number: number;
  headline: string;
  content: string;
  word_count: number;
  sentiment_score: number;
  sentiment_label: string;
}

interface NewspaperPage {
  newspaper: {
    id: string;
    publication_date: string;
    page_number: number;
    section: string;
  };
  articles: Article[];
  article_count: number;
}

const NewspaperBrowser: React.FC = () => {
  const [newspapers, setNewspapers] = useState<Newspaper[]>([]);
  const [selectedPage, setSelectedPage] = useState<NewspaperPage | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('1990-01-01');
  const [endDate, setEndDate] = useState('1992-12-31');
  const [editingDate, setEditingDate] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadNewspapers = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/newspapers`, {
        params: {
          start_date: startDate,
          end_date: endDate,
          limit: 100
        }
      });
      setNewspapers(response.data.newspapers || []);
    } catch (error) {
      console.error('Error loading newspapers:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadNewspaperPage = async (newspaperId: string) => {
    setLoading(true);
    setSummary('');
    try {
      const response = await axios.get(`${API_BASE}/newspapers/${newspaperId}`);
      setSelectedPage(response.data);
    } catch (error) {
      console.error('Error loading newspaper page:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateSummary = async (newspaperId: string) => {
    setLoadingSummary(true);
    try {
      const response = await axios.post(`${API_BASE}/newspapers/${newspaperId}/summarize`);
      if (response.data.error) {
        setSummary('Error: ' + response.data.error);
      } else {
        setSummary(response.data.summary);
      }
    } catch (error) {
      console.error('Error generating summary:', error);
      setSummary('Failed to generate summary');
    } finally {
      setLoadingSummary(false);
    }
  };

  useEffect(() => {
    loadNewspapers();
  }, []);

  const handleNewspaperClick = (newspaper: Newspaper) => {
    loadNewspaperPage(newspaper.id);
  };

  const handleBackToList = () => {
    setSelectedPage(null);
    setSummary('');
  };

  const updateNewspaperDate = async (newspaperId: string, date: string) => {
    try {
      const response = await axios.patch(`${API_BASE}/newspapers/${newspaperId}/date`, {
        new_date: date
      });

      if (response.data.status === 'success') {
        alert(`Date updated successfully! ${response.data.articles_updated} articles updated.`);
        setEditingDate(false);
        // Reload the page to show updated date
        loadNewspaperPage(newspaperId);
        // Reload newspaper list
        loadNewspapers();
      }
    } catch (error: any) {
      console.error('Error updating date:', error);
      alert('Failed to update date: ' + (error.response?.data?.detail || error.message));
    }
  };

  const startEditingDate = () => {
    if (selectedPage) {
      setNewDate(selectedPage.newspaper.publication_date.split('T')[0]);
      setEditingDate(true);
    }
  };

  const deleteNewspaper = async (newspaperId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation(); // Prevent card click when clicking delete button
    }
    
    if (!window.confirm('Are you sure you want to delete this newspaper? This will also delete all associated articles. This action cannot be undone.')) {
      return;
    }

    setDeletingId(newspaperId);
    
    try {
      await axios.delete(`${API_BASE}/newspapers/${newspaperId}?delete_articles=true`);
      alert('Newspaper and all articles deleted successfully');
      
      // Go back to list if we're in detail view
      if (selectedPage && selectedPage.newspaper.id === newspaperId) {
        setSelectedPage(null);
        setSummary('');
      }
      
      // Reload the newspaper list
      loadNewspapers();
    } catch (error: any) {
      console.error('Failed to delete newspaper:', error);
      alert(`Failed to delete newspaper: ${error.response?.data?.detail || error.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="newspaper-browser">
      {!selectedPage ? (
        <div className="newspaper-list-view">
          <div className="browser-header">
            <h2>Browse Newspaper Pages</h2>
            <p className="subtitle">Search newspapers by date range</p>
          </div>

          <div className="date-filters">
            <label>
              Start Date:
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label>
              End Date:
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <button onClick={loadNewspapers} disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {loading ? (
            <div className="loading">Loading newspapers...</div>
          ) : newspapers.length > 0 ? (
            <div className="newspaper-grid">
              {newspapers.map((newspaper) => (
                <div
                  key={newspaper.id}
                  className="newspaper-card"
                  onClick={() => handleNewspaperClick(newspaper)}
                  style={{ position: 'relative' }}
                >
                  <button
                    onClick={(e) => deleteNewspaper(newspaper.id, e)}
                    disabled={deletingId === newspaper.id}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      background: deletingId === newspaper.id ? '#9ca3af' : '#ef4444',
                      color: 'white',
                      border: 'none',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      cursor: deletingId === newspaper.id ? 'not-allowed' : 'pointer',
                      fontSize: '11px',
                      fontWeight: '500',
                      zIndex: 10
                    }}
                  >
                    {deletingId === newspaper.id ? 'Deleting...' : '✕'}
                  </button>
                  <div className="newspaper-date">
                    {new Date(newspaper.publication_date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </div>
                  <div className="newspaper-info">
                    <span className="page-number">Page {newspaper.page_number}</span>
                    <span className="article-count">{newspaper.article_count} articles</span>
                  </div>
                  <div className="newspaper-section">{newspaper.section}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-results">
              No newspapers found for the selected date range
            </div>
          )}
        </div>
      ) : (
        <div className="newspaper-page-view">
          <div style={{ display: 'flex', gap: '12px', marginBottom: '1rem' }}>
            <button className="back-button" onClick={handleBackToList}>
              Back to List
            </button>
            <button
              onClick={() => deleteNewspaper(selectedPage.newspaper.id)}
              disabled={deletingId === selectedPage.newspaper.id}
              style={{
                padding: '8px 16px',
                background: deletingId === selectedPage.newspaper.id ? '#9ca3af' : '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: deletingId === selectedPage.newspaper.id ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500'
              }}
            >
              {deletingId === selectedPage.newspaper.id ? 'Deleting...' : 'Delete Newspaper'}
            </button>
          </div>

          <div className="page-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
              {!editingDate ? (
                <>
                  <h2 style={{ margin: 0 }}>
                    {new Date(selectedPage.newspaper.publication_date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </h2>
                  <button
                    onClick={startEditingDate}
                    style={{
                      padding: '4px 12px',
                      fontSize: '13px',
                      background: '#667eea',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Edit Date
                  </button>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    style={{
                      padding: '8px',
                      fontSize: '14px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '4px'
                    }}
                  />
                  <button
                    onClick={() => updateNewspaperDate(selectedPage.newspaper.id, newDate)}
                    style={{
                      padding: '8px 16px',
                      fontSize: '13px',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingDate(false)}
                    style={{
                      padding: '8px 16px',
                      fontSize: '13px',
                      background: '#6b7280',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <div className="page-meta">
              <span>Page {selectedPage.newspaper.page_number}</span>
              <span>{selectedPage.article_count} articles</span>
              <span>{selectedPage.newspaper.section}</span>
            </div>
          </div>

          <div className="summary-section">
            <div className="summary-header">
              <h3>AI Summary</h3>
              <button
                onClick={() => generateSummary(selectedPage.newspaper.id)}
                disabled={loadingSummary}
                className="generate-summary-btn"
              >
                {loadingSummary ? 'Generating...' : summary ? 'Regenerate Summary' : 'Generate Summary'}
              </button>
            </div>
            {summary && (
              <div className="summary-content">
                <p>{summary}</p>
              </div>
            )}
          </div>

          <div className="articles-section">
            <h3>Articles on this Page</h3>
            <div className="articles-list">
              {selectedPage.articles.map((article) => (
                <div key={article.id} className="article-card">
                  <div className="article-number">Article {article.article_number}</div>
                  <h4 className="article-headline">{article.headline}</h4>
                  <div className="article-meta">
                    <span className="word-count">{article.word_count} words</span>
                    <span className={`sentiment ${article.sentiment_label}`}>
                      {article.sentiment_label}
                    </span>
                  </div>
                  <p className="article-preview">
                    {article.content.substring(0, 200)}...
                  </p>
                  <a href={`#/article/${article.id}`} className="read-more">
                    Read full article
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NewspaperBrowser;
