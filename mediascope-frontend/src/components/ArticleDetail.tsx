import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './ui/Toast';

interface Entity {
  text: string;
  type: string;
}

interface ArticleData {
  id: string;
  headline: string;
  content: string;
  publication_date: string;
  sentiment_score: number;
  sentiment_label: string;
  topic_label: string;
  entities: Entity[];
  word_count: number;
  page_number?: number;
  newspaper_id?: number;
}

interface AISummary {
  summary: string;
  key_themes: string[];
  entities_mentioned: string[];
}

interface Annotation {
  id: number;
  article_id: string;
  text: string;
  note?: string;
  start_offset?: number;
  end_offset?: number;
  color?: string;
  created_at: string;
}

type CitationStyle = 'APA' | 'MLA' | 'Chicago';

const ArticleDetail: React.FC = () => {
  const { articleId } = useParams<{ articleId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState<AISummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [relatedArticles, setRelatedArticles] = useState<ArticleData[]>([]);

  // Annotations state
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectionInfo, setSelectionInfo] = useState<{
    text: string;
    start: number;
    end: number;
    x: number;
    y: number;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Citation modal state
  const [showCitation, setShowCitation] = useState(false);
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('APA');

  // Reading mode state
  const [readingMode, setReadingMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('readingMode') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    loadArticle();
  }, [articleId]);

  useEffect(() => {
    if (articleId && user) {
      loadAnnotations();
    } else {
      setAnnotations([]);
    }
  }, [articleId, user]);

  useEffect(() => {
    try {
      localStorage.setItem('readingMode', readingMode ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, [readingMode]);

  const loadArticle = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/articles/${articleId}`);
      setArticle(response.data);

      if (response.data.topic_label) {
        loadRelatedArticles(response.data.topic_label);
      }
    } catch (error) {
      console.error('Failed to load article:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRelatedArticles = async (topic: string) => {
    try {
      const response = await axios.post(`${API_BASE}/search/keyword`, {
        query: topic,
        limit: 5
      });
      setRelatedArticles(
        response.data.articles.filter((a: ArticleData) => a.id !== articleId)
      );
    } catch (error) {
      console.error('Failed to load related articles:', error);
    }
  };

  const loadAnnotations = async () => {
    try {
      const response = await axios.get(
        `${API_BASE}/bookmarks/annotations/article/${articleId}`
      );
      setAnnotations(response.data.annotations || []);
    } catch (error) {
      console.error('Failed to load annotations:', error);
    }
  };

  const generateAISummary = async () => {
    if (!article) return;

    setLoadingSummary(true);
    try {
      const response = await axios.post(`${API_BASE}/analytics/article-summary`, {
        article_id: articleId
      });
      setAiSummary(response.data);
    } catch (error) {
      console.error('Failed to generate AI summary:', error);
    } finally {
      setLoadingSummary(false);
    }
  };

  // --- Annotation handling ---
  const handleTextSelection = useCallback(() => {
    if (!user) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionInfo(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();
    if (!selectedText) {
      setSelectionInfo(null);
      return;
    }
    // Ensure selection is within the content container
    if (
      contentRef.current &&
      !contentRef.current.contains(range.commonAncestorContainer)
    ) {
      setSelectionInfo(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelectionInfo({
      text: selectedText,
      start: range.startOffset,
      end: range.endOffset,
      x: rect.left + rect.width / 2 + window.scrollX,
      y: rect.top + window.scrollY - 8,
    });
  }, [user]);

  const handleCreateAnnotation = async () => {
    if (!selectionInfo || !articleId) return;
    const note = window.prompt('Add an optional note (leave blank for highlight only):') || '';
    try {
      const response = await axios.post(`${API_BASE}/bookmarks/annotations`, {
        article_id: articleId,
        text: selectionInfo.text,
        note: note || undefined,
        start_offset: selectionInfo.start,
        end_offset: selectionInfo.end,
        color: 'yellow',
      });
      const created: Annotation = response.data.annotation || response.data;
      if (created && created.id !== undefined) {
        setAnnotations((prev) => [...prev, created]);
      } else {
        await loadAnnotations();
      }
      toast('Highlight saved', 'success');
    } catch (error) {
      console.error('Failed to create annotation:', error);
      toast('Failed to save highlight', 'error');
    } finally {
      setSelectionInfo(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const handleDeleteAnnotation = async (id: number) => {
    try {
      await axios.delete(`${API_BASE}/bookmarks/annotations/${id}`);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      toast('Highlight removed', 'success');
    } catch (error) {
      console.error('Failed to delete annotation:', error);
      toast('Failed to remove highlight', 'error');
    }
  };

  // Render a paragraph with any annotation text wrapped in <mark>
  const renderParagraphWithAnnotations = (paragraph: string, key: number) => {
    if (annotations.length === 0) {
      return <p key={key}>{paragraph}</p>;
    }
    // Build index ranges for matched annotation text within the paragraph.
    type Match = { start: number; end: number; note?: string };
    const matches: Match[] = [];
    annotations.forEach((ann) => {
      if (!ann.text) return;
      let searchFrom = 0;
      while (searchFrom < paragraph.length) {
        const idx = paragraph.indexOf(ann.text, searchFrom);
        if (idx === -1) break;
        matches.push({ start: idx, end: idx + ann.text.length, note: ann.note });
        searchFrom = idx + ann.text.length;
      }
    });
    if (matches.length === 0) {
      return <p key={key}>{paragraph}</p>;
    }
    // Sort and merge overlapping matches
    matches.sort((a, b) => a.start - b.start);
    const merged: Match[] = [];
    matches.forEach((m) => {
      const last = merged[merged.length - 1];
      if (last && m.start <= last.end) {
        last.end = Math.max(last.end, m.end);
        last.note = last.note || m.note;
      } else {
        merged.push({ ...m });
      }
    });
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    merged.forEach((m, i) => {
      if (m.start > cursor) {
        parts.push(paragraph.substring(cursor, m.start));
      }
      parts.push(
        <mark
          key={`mark-${key}-${i}`}
          className="user-annotation"
          title={m.note || ''}
          style={{ backgroundColor: '#fff3a3', padding: '0 2px', borderRadius: '2px' }}
        >
          {paragraph.substring(m.start, m.end)}
        </mark>
      );
      cursor = m.end;
    });
    if (cursor < paragraph.length) {
      parts.push(paragraph.substring(cursor));
    }
    return <p key={key}>{parts}</p>;
  };

  // --- Citation generator ---
  const formatCitation = (style: CitationStyle): string => {
    if (!article) return '';
    const date = new Date(article.publication_date);
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const year = date.getFullYear();
    const monthName = months[date.getMonth()];
    const day = date.getDate();
    const page = article.page_number ? `p. ${article.page_number}` : '';

    switch (style) {
      case 'APA':
        return `Dawn Newspaper. (${year}, ${monthName} ${day}). ${article.headline}.${page ? ' ' + page + '.' : ''}`;
      case 'MLA':
        return `"${article.headline}." *Dawn Newspaper*, ${day} ${monthName} ${year}${page ? ', ' + page : ''}.`;
      case 'Chicago':
        return `"${article.headline}." *Dawn Newspaper*, ${monthName} ${day}, ${year}${page ? ', ' + page : ''}.`;
    }
  };

  const handleCopyCitation = async () => {
    const text = formatCitation(citationStyle);
    try {
      await navigator.clipboard.writeText(text);
      toast('Citation copied', 'success');
    } catch {
      toast('Unable to copy citation', 'error');
    }
  };

  const getSentimentColor = (label: string) => {
    switch (label) {
      case 'positive': return 'var(--positive)';
      case 'negative': return 'var(--negative)';
      default: return 'var(--text-secondary)';
    }
  };

  const getSentimentPrefix = (label: string) => {
    switch (label) {
      case 'positive': return '+';
      case 'negative': return '-';
      default: return '=';
    }
  };

  const getEntityPrefix = (type: string) => {
    switch (type) {
      case 'PERSON': return '[P]';
      case 'ORG': return '[O]';
      case 'GPE': return '[L]';
      case 'NORP': return '[G]';
      case 'EVENT': return '[E]';
      default: return '[T]';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="article-detail-loading">
        <div className="spinner"></div>
        <p>Loading article...</p>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="article-not-found">
        <h2>Article Not Found</h2>
        <button onClick={() => navigate('/')}>← Back to Dashboard</button>
      </div>
    );
  }

  return (
    <div className={`article-detail-container${readingMode ? ' reading-mode' : ''}`}>
      {/* Scoped styles for new features + reading mode */}
      <style>{`
        .article-detail-container.reading-mode .article-detail {
          max-width: 720px;
          margin: 0 auto;
          padding: 48px 24px;
        }
        .article-detail-container.reading-mode .content-text,
        .article-detail-container.reading-mode .content-text p {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 1.15rem;
          line-height: 1.75;
        }
        .article-detail-container.reading-mode .article-sidebar,
        .article-detail-container.reading-mode .article-entities,
        .article-detail-container.reading-mode .entities-grid {
          display: none !important;
        }
        .user-annotation {
          background-color: #fff3a3;
          padding: 0 2px;
          border-radius: 2px;
          cursor: help;
        }
        .annotation-floating-btn {
          position: absolute;
          transform: translate(-50%, -100%);
          background: #2563eb;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          z-index: 1000;
        }
        .annotation-floating-btn:hover { background: #1d4ed8; }
        .annotations-panel {
          margin-top: 16px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 8px;
          padding: 12px;
          background: var(--bg-secondary, #f9fafb);
        }
        .annotations-panel h3 { margin: 0 0 8px; font-size: 14px; }
        .annotation-item {
          padding: 8px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
          display: flex;
          justify-content: space-between;
          gap: 8px;
          font-size: 13px;
        }
        .annotation-item:last-child { border-bottom: none; }
        .annotation-item .ann-text { font-style: italic; color: var(--text-primary, #111827); }
        .annotation-item .ann-note { color: var(--text-secondary, #6b7280); font-size: 12px; margin-top: 4px; }
        .annotation-item button {
          background: transparent;
          border: none;
          color: #dc2626;
          cursor: pointer;
          font-size: 14px;
        }
        .citation-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
          z-index: 2000;
        }
        .citation-modal {
          background: var(--bg-primary, #fff);
          border-radius: 10px;
          padding: 20px;
          width: 90%; max-width: 560px;
          box-shadow: 0 20px 50px rgba(0,0,0,0.25);
        }
        .citation-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
        .citation-tab {
          flex: 1; padding: 8px 10px;
          border: 1px solid var(--border-color, #e5e7eb);
          background: var(--bg-secondary, #f9fafb);
          border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;
        }
        .citation-tab.active { background: #2563eb; color: white; border-color: #2563eb; }
        .citation-body {
          background: var(--bg-secondary, #f9fafb);
          padding: 14px; border-radius: 6px; font-size: 14px;
          line-height: 1.6; margin-bottom: 14px; word-break: break-word;
        }
        .citation-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .citation-actions button {
          padding: 8px 14px; border-radius: 6px; border: 1px solid var(--border-color, #e5e7eb);
          background: var(--bg-secondary, #f9fafb); cursor: pointer; font-weight: 600;
        }
        .citation-actions .btn-primary { background: #2563eb; color: white; border-color: #2563eb; }
        .reading-mode-toggle, .cite-button {
          padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border-color, #e5e7eb);
          background: var(--bg-secondary, #f9fafb); cursor: pointer; font-size: 13px; font-weight: 600;
          margin-left: 8px;
        }
        .reading-mode-toggle.active { background: #2563eb; color: white; border-color: #2563eb; }
      `}</style>

      <div className="article-detail-header">
        <button className="back-button" onClick={() => navigate('/')}>
          ← Back to Search
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <button
            className="cite-button"
            onClick={async () => {
              if (!article) return;
              const url = `${window.location.origin}/article/${article.id}`;
              try {
                await navigator.clipboard.writeText(url);
                toast('Link copied', 'success');
              } catch {
                toast('Failed to copy link', 'error');
              }
            }}
            title="Copy permalink"
          >
            {'\uD83D\uDD17'} Copy link
          </button>
          <button
            className="cite-button"
            onClick={() => setShowCitation(true)}
            title="Generate citation"
          >
            Cite
          </button>
          <button
            className={`reading-mode-toggle${readingMode ? ' active' : ''}`}
            onClick={() => setReadingMode((v) => !v)}
            title="Toggle reading mode"
          >
            {'\uD83D\uDCD6'} Reading Mode
          </button>
        </div>
      </div>

      <article className="article-detail">
        <header className="article-header">
          <h1 className="article-title">{article.headline}</h1>

          <div className="article-metadata">
            <span className="article-date">{formatDate(article.publication_date)}</span>
            {article.page_number && (
              <span className="article-page">Page {article.page_number}</span>
            )}
            <span className="article-wordcount">{article.word_count} words</span>
          </div>

          <div className="article-badges">
            <div
              className="sentiment-badge-large"
              style={{ backgroundColor: getSentimentColor(article.sentiment_label) }}
            >
              {getSentimentPrefix(article.sentiment_label)} {article.sentiment_label}
              <span className="sentiment-score">
                ({article.sentiment_score.toFixed(3)})
              </span>
            </div>

            {article.topic_label && (
              <div className="topic-badge-large">
                {article.topic_label}
              </div>
            )}
          </div>
        </header>

        <div className="article-content">
          <div
            className="content-text"
            ref={contentRef}
            onMouseUp={handleTextSelection}
            onKeyUp={handleTextSelection}
            style={{ position: 'relative' }}
          >
            {article.content.split('\n').map((paragraph, idx) => (
              paragraph.trim() ? renderParagraphWithAnnotations(paragraph, idx) : null
            ))}
          </div>

          {/* Annotations panel */}
          {user && annotations.length > 0 && (
            <div className="annotations-panel">
              <h3>Your Highlights ({annotations.length})</h3>
              {annotations.map((ann) => (
                <div key={ann.id} className="annotation-item">
                  <div style={{ flex: 1 }}>
                    <div className="ann-text">"{ann.text}"</div>
                    {ann.note && <div className="ann-note">Note: {ann.note}</div>}
                  </div>
                  <button
                    onClick={() => handleDeleteAnnotation(ann.id)}
                    title="Delete highlight"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="article-sidebar">
          <div className="sidebar-section">
            <h3>Entities Mentioned</h3>
            <div className="entities-grid">
              {article.entities.length > 0 ? (
                article.entities.map((entity, idx) => (
                  <div key={idx} className="entity-chip">
                    <span className="entity-icon">{getEntityPrefix(entity.type)}</span>
                    <span className="entity-text">{entity.text}</span>
                    <span className="entity-type">{entity.type}</span>
                  </div>
                ))
              ) : (
                <p className="no-data">No entities extracted</p>
              )}
            </div>
          </div>

          <div className="sidebar-section">
            <h3>AI Summary</h3>
            {aiSummary ? (
              <div className="ai-summary-content">
                <p>{aiSummary.summary}</p>
                {aiSummary.key_themes.length > 0 && (
                  <div className="key-themes">
                    <h4>Key Themes:</h4>
                    <ul>
                      {aiSummary.key_themes.map((theme, idx) => (
                        <li key={idx}>{theme}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={generateAISummary}
                disabled={loadingSummary}
                className="generate-summary-btn"
              >
                {loadingSummary ? 'Generating...' : 'Generate AI Summary'}
              </button>
            )}
          </div>

          {relatedArticles.length > 0 && (
            <div className="sidebar-section">
              <h3>Related Articles</h3>
              <div className="related-articles">
                {relatedArticles.map((related) => (
                  <div
                    key={related.id}
                    className="related-article-item"
                    onClick={() => navigate(`/article/${related.id}`)}
                  >
                    <h4>{related.headline}</h4>
                    <span className="related-date">
                      {new Date(related.publication_date).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </article>

      {/* Floating highlight button */}
      {user && selectionInfo && (
        <button
          className="annotation-floating-btn"
          style={{ left: selectionInfo.x, top: selectionInfo.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleCreateAnnotation}
        >
          Highlight
        </button>
      )}

      {/* Citation modal */}
      {showCitation && article && (
        <div className="citation-modal-overlay" onClick={() => setShowCitation(false)}>
          <div className="citation-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Cite this article</h3>
            <div className="citation-tabs">
              {(['APA', 'MLA', 'Chicago'] as CitationStyle[]).map((s) => (
                <button
                  key={s}
                  className={`citation-tab${citationStyle === s ? ' active' : ''}`}
                  onClick={() => setCitationStyle(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="citation-body">{formatCitation(citationStyle)}</div>
            <div className="citation-actions">
              <button onClick={() => setShowCitation(false)}>Close</button>
              <button className="btn-primary" onClick={handleCopyCitation}>
                Copy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArticleDetail;
