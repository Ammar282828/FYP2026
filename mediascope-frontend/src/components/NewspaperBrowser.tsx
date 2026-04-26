import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Newspaper as NewspaperIcon,
  Trash2,
  ArrowLeft,
  Calendar,
  Sparkles,
  X,
  FileText,
} from 'lucide-react';
import { API_BASE } from '../config';
import { useToast } from './ui/Toast';
import EmptyState from './ui/EmptyState';
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
  const { toast } = useToast();
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
        toast(`Date updated! ${response.data.articles_updated} articles updated.`, 'success');
        setEditingDate(false);
        // Reload the page to show updated date
        loadNewspaperPage(newspaperId);
        // Reload newspaper list
        loadNewspapers();
      }
    } catch (error: any) {
      console.error('Error updating date:', error);
      toast('Failed to update date: ' + (error.response?.data?.detail || error.message), 'error');
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
      toast('Newspaper and all articles deleted successfully', 'success');

      // Go back to list if we're in detail view
      if (selectedPage && selectedPage.newspaper.id === newspaperId) {
        setSelectedPage(null);
        setSummary('');
      }

      // Reload the newspaper list
      loadNewspapers();
    } catch (error: any) {
      console.error('Failed to delete newspaper:', error);
      toast(`Failed to delete newspaper: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="newspaper-browser">
      {!selectedPage ? (
        <div className="newspaper-list-view">
          <div className="browser-header">
            <h2>Browse newspaper pages</h2>
            <p className="subtitle">Pick a date range to surface scanned issues from the archive.</p>
          </div>

          <div className="date-filters">
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <button
              onClick={loadNewspapers}
              disabled={loading}
              className="btn btn--primary"
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>

          {loading ? (
            <div className="newspaper-grid">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton skeleton-block" style={{ height: '7rem' }} />
              ))}
            </div>
          ) : newspapers.length > 0 ? (
            <div className="newspaper-grid">
              {newspapers.map((newspaper) => (
                <div
                  key={newspaper.id}
                  className="newspaper-card newspaper-card--with-action"
                  onClick={() => handleNewspaperClick(newspaper)}
                >
                  <button
                    onClick={(e) => deleteNewspaper(newspaper.id, e)}
                    disabled={deletingId === newspaper.id}
                    className="btn btn--ghost btn--sm newspaper-card__delete"
                    aria-label="Delete newspaper"
                  >
                    {deletingId === newspaper.id ? '…' : <X size={14} />}
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
            <EmptyState
              icon={<NewspaperIcon size={32} />}
              title="No issues in this date range"
              description="Widen the dates or pick a different window to surface scanned newspapers from the archive."
              action={{
                label: 'Reset date range',
                onClick: () => {
                  setStartDate('1990-01-01');
                  setEndDate('1992-12-31');
                  loadNewspapers();
                },
              }}
            />
          )}
        </div>
      ) : (
        <div className="newspaper-page-view">
          <div className="toolbar">
            <button className="btn btn--ghost btn--sm" onClick={handleBackToList}>
              <ArrowLeft size={14} /> Back to list
            </button>
            <button
              onClick={() => deleteNewspaper(selectedPage.newspaper.id)}
              disabled={deletingId === selectedPage.newspaper.id}
              className="btn btn--sm newspaper-delete-btn"
            >
              <Trash2 size={14} />
              {deletingId === selectedPage.newspaper.id ? 'Deleting…' : 'Delete newspaper'}
            </button>
          </div>

          <div className="page-header">
            <div className="cluster" style={{ marginBottom: 'var(--space-2)' }}>
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
                    className="btn btn--sm newspaper-edit-date-btn"
                  >
                    <Calendar size={14} /> Edit date
                  </button>
                </>
              ) : (
                <div className="cluster">
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="newspaper-date-input"
                  />
                  <button
                    onClick={() => updateNewspaperDate(selectedPage.newspaper.id, newDate)}
                    className="btn btn--primary btn--sm"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingDate(false)}
                    className="btn btn--ghost btn--sm"
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
              <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Sparkles size={16} /> AI summary
              </h3>
              <button
                onClick={() => generateSummary(selectedPage.newspaper.id)}
                disabled={loadingSummary}
                className="btn btn--primary btn--sm"
              >
                {loadingSummary ? 'Generating…' : summary ? 'Regenerate summary' : 'Generate summary'}
              </button>
            </div>
            {loadingSummary ? (
              <div className="stack stack--tight" aria-busy="true">
                <div className="skeleton skeleton-line" style={{ width: '92%' }} />
                <div className="skeleton skeleton-line" style={{ width: '85%' }} />
                <div className="skeleton skeleton-line" style={{ width: '60%' }} />
              </div>
            ) : summary ? (
              <div className="summary-content">
                <p>{summary}</p>
              </div>
            ) : (
              <div className="empty-state">
                <Sparkles size={24} className="empty-state__icon" />
                <div className="empty-state__title">No summary yet</div>
                <div className="empty-state__body">
                  Generate one to get a quick read on what ran on this page.
                </div>
              </div>
            )}
          </div>

          <div className="articles-section">
            <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <FileText size={16} /> Articles on this page
            </h3>
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
