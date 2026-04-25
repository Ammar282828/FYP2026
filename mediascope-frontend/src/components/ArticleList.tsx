import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Newspaper, Rows3, AlignJustify } from 'lucide-react';
import { API_BASE } from '../config';
import BookmarkButton from './BookmarkButton';
import { useToast } from './ui/Toast';
import EmptyState from './ui/EmptyState';

// Persist density across mounts. localStorage is the only place where
// "comfortable vs compact" preference makes sense; per-component state
// would reset every search.
const DENSITY_KEY = 'mediascope:articleList:density';
type Density = 'comfortable' | 'compact';
function readDensity(): Density {
  if (typeof window === 'undefined') return 'comfortable';
  const v = window.localStorage.getItem(DENSITY_KEY);
  return v === 'compact' ? 'compact' : 'comfortable';
}

// Removed - using config

interface Article {
  id: string;
  headline: string;
  content_preview: string;
  content?: string;
  publication_date: string;
  sentiment_score: number;
  sentiment_label: string;
  topic_label: string;
  entities: Array<{text: string; type: string}>;
  word_count?: number;
}

interface ArticleListProps {
  articles: Article[];
  onArticleDeleted?: () => void; // Callback after successful deletion
  highlightQuery?: string;
}

/** Highlight matching terms in text */
const HighlightText: React.FC<{ text: string; query?: string }> = ({ text, query }) => {
  if (!query || !query.trim()) return <>{text}</>;

  try {
    const terms = query.trim().split(/\s+/).filter(t => t.length >= 2);
    if (terms.length === 0) return <>{text}</>;

    const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    const parts = text.split(pattern);

    return (
      <>
        {parts.map((part, i) =>
          pattern.test(part) ? (
            <mark key={i} className="search-highlight">{part}</mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
};

const ArticleList: React.FC<ArticleListProps> = ({ articles, onArticleDeleted, highlightQuery }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [density, setDensity] = useState<Density>(readDensity);

  const setAndPersistDensity = (d: Density) => {
    setDensity(d);
    try { window.localStorage.setItem(DENSITY_KEY, d); } catch { /* ignore */ }
  };

  const handleDelete = async (articleId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation when clicking delete

    if (!window.confirm('Are you sure you want to delete this article? This action cannot be undone.')) {
      return;
    }

    setDeletingId(articleId);

    try {
      await axios.delete(`${API_BASE}/articles/${articleId}`);
      toast('Article deleted successfully', 'success');

      // Trigger callback to refresh the list
      if (onArticleDeleted) {
        onArticleDeleted();
      }
    } catch (error: any) {
      console.error('Failed to delete article:', error);
      toast(`Failed to delete article: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const getSentimentColor = (label: string) => {
    switch (label) {
      case 'positive': return 'var(--positive)';
      case 'negative': return 'var(--negative)';
      default: return 'var(--neutral-color)';
    }
  };

  const getSentimentPrefix = (label: string) => {
    switch (label) {
      case 'positive': return '+';
      case 'negative': return '-';
      default: return '=';
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      // Ensure valid date
      if (isNaN(date.getTime())) {
        return dateString;
      }
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return dateString;
    }
  };

  if (!articles || articles.length === 0) {
    return (
      <EmptyState
        icon={<Newspaper size={28} strokeWidth={1.5} />}
        title="No articles in this slice of the archive"
        description="Try a different keyword, widen the date range, or clear active filters to see more results."
      />
    );
  }

  return (
    <div className={`article-list article-list--${density}`}>
      <div className="article-list__toolbar">
        <span className="article-list__count">
          {articles.length.toLocaleString()} article{articles.length === 1 ? '' : 's'}
        </span>
        <div className="btn-group" role="group" aria-label="List density">
          <button
            type="button"
            className="btn btn--sm"
            aria-pressed={density === 'comfortable'}
            onClick={() => setAndPersistDensity('comfortable')}
            title="Comfortable spacing"
          >
            <Rows3 size={14} />
          </button>
          <button
            type="button"
            className="btn btn--sm"
            aria-pressed={density === 'compact'}
            onClick={() => setAndPersistDensity('compact')}
            title="Compact spacing"
          >
            <AlignJustify size={14} />
          </button>
        </div>
      </div>
      {articles.map((article) => (
        <div
          key={article.id}
          className="article-card"
          onClick={() => navigate(`/article/${article.id}`)}
          style={{ cursor: 'pointer' }}
        >
          <div className="article-header">
            <h3 className="article-headline">
              <HighlightText text={article.headline} query={highlightQuery} />
            </h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className="article-date">
                {formatDate(article.publication_date)}
              </span>
              <BookmarkButton articleId={article.id} size="small" />
              <button
                onClick={(e) => handleDelete(article.id, e)}
                disabled={deletingId === article.id}
                style={{
                  background: deletingId === article.id ? 'var(--text-tertiary)' : 'var(--danger-color)',
                  color: 'white',
                  border: 'none',
                  padding: '4px 12px',
                  borderRadius: '4px',
                  cursor: deletingId === article.id ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  fontWeight: '500',
                  transition: 'background 0.2s'
                }}
              >
                {deletingId === article.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>

          <div className="article-content-preview">
            <HighlightText text={article.content_preview || ''} query={highlightQuery} />...
            <span style={{ color: 'var(--primary-color)', marginLeft: '8px', fontWeight: '600' }}>
              Read full article
            </span>
          </div>

          <div className="article-meta">
            <div
              className="sentiment-badge"
              style={{ backgroundColor: getSentimentColor(article.sentiment_label) }}
            >
              {getSentimentPrefix(article.sentiment_label)} {article.sentiment_label}
              <span className="sentiment-score">
                ({article.sentiment_score?.toFixed(2)})
              </span>
            </div>

            {article.topic_label && (
              <div className="topic-badge">
                {article.topic_label}
              </div>
            )}

            {article.entities && article.entities.length > 0 && (
              <div className="entities-list">
                {article.entities.slice(0, 5).map((entity, idx) => (
                  <span
                    key={idx}
                    className="entity-tag entity-tag-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/entity/${encodeURIComponent(entity.text)}`);
                    }}
                  >
                    [{entity.type}] {entity.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ArticleList;
