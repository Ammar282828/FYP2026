import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { API_BASE, API_BASE_URL } from '../config';
import BookmarkButton from './BookmarkButton';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './ui/Toast';
import ArticleAnalytics from './ArticleAnalytics';
import ErrorBoundary from './ui/ErrorBoundary';
import { recordView } from '../hooks/useViewHistory';

interface ArticleDetail {
  id: number;
  headline: string;
  content: string;
  sentiment_score: number;
  sentiment_label: string;
  topic_label: string;
  word_count: number;
  publication_date: string;
  newspaper_id: number;
  image_path: string;
  page_number: number;
  section: string;
  entities: any[];
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

const ArticleDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [relatedArticles, setRelatedArticles] = useState<any[]>([]);
  const [storyId, setStoryId] = useState<string | null>(null);
  const [storyTitle, setStoryTitle] = useState<string>('');
  const [storyContext, setStoryContext] = useState<string | null>(null);
  const [storyEntities, setStoryEntities] = useState<any[]>([]);
  const [generatingContext, setGeneratingContext] = useState(false);
  const [summary, setSummary] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Annotations
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectionInfo, setSelectionInfo] = useState<{
    text: string;
    start: number;
    end: number;
    x: number;
    y: number;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Citation modal
  const [showCitation, setShowCitation] = useState(false);
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('APA');

  // Reading mode
  const [readingMode, setReadingMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('readingMode') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (id) {
      loadArticle();
      loadRelatedArticles();
    }
  }, [id]);

  useEffect(() => {
    if (id && user) {
      loadAnnotations();
    } else {
      setAnnotations([]);
    }
  }, [id, user]);

  useEffect(() => {
    try {
      localStorage.setItem('readingMode', readingMode ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, [readingMode]);

  const loadArticle = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_BASE}/articles/${id}/full`);
      const a = response.data.article;
      setArticle(a);
      // Stamp into local view history for the Profile > History tab.
      // Wrapped in try/catch since it's a side-effect we never want to
      // surface to the article render path.
      try {
        recordView({
          id: String(a.id ?? id),
          headline: a.headline || 'Untitled',
          date: a.publication_date,
          sentiment: a.sentiment_label,
          topic: a.topic_label,
        });
      } catch { /* noop */ }
    } catch (error: any) {
      console.error('Error loading article:', error);
      const errorMsg = error.response?.data?.detail || error.message || 'Failed to load article';
      setError(`Error: ${errorMsg}. API: ${API_BASE}/articles/${id}/full`);
    } finally {
      setLoading(false);
    }
  };

  const loadRelatedArticles = async () => {
    try {
      const response = await axios.get(`${API_BASE}/articles/${id}/related`);
      const data = response.data;
      setRelatedArticles(data.related_articles || []);
      setStoryId(data.story_id || null);
      setStoryTitle(data.story_title || '');
      setStoryContext(data.story_context || null);
      setStoryEntities(data.story_key_entities || []);
    } catch (error) {
      console.error('Error loading related articles:', error);
    }
  };

  const loadAnnotations = async () => {
    try {
      const response = await axios.get(
        `${API_BASE}/bookmarks/annotations/article/${id}`
      );
      setAnnotations(response.data.annotations || []);
    } catch (error) {
      console.error('Failed to load annotations:', error);
    }
  };

  const generateStoryContext = async () => {
    if (!storyId) return;
    setGeneratingContext(true);
    try {
      await axios.post(`${API_BASE}/stories/generate`, { story_id: storyId, force: false });
      const poll = setInterval(async () => {
        try {
          const resp = await axios.get(`${API_BASE}/stories/${storyId}`);
          if (resp.data.narrative) {
            setStoryContext(resp.data.narrative);
            setGeneratingContext(false);
            clearInterval(poll);
          }
        } catch { /* keep polling */ }
      }, 3000);
    } catch (error) {
      console.error('Error generating context:', error);
      setGeneratingContext(false);
    }
  };

  const generateSummary = async () => {
    setLoadingSummary(true);
    try {
      const response = await axios.post(`${API_BASE}/articles/${id}/summary`);
      setSummary(response.data.summary);
    } catch (error) {
      console.error('Error generating summary:', error);
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
    if (!selectionInfo || !id) return;
    const note = window.prompt('Add an optional note (leave blank for highlight only):') || '';
    try {
      const response = await axios.post(`${API_BASE}/bookmarks/annotations`, {
        article_id: String(id),
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

  const handleDeleteAnnotation = async (annId: number) => {
    try {
      await axios.delete(`${API_BASE}/bookmarks/annotations/${annId}`);
      setAnnotations((prev) => prev.filter((a) => a.id !== annId));
      toast('Highlight removed', 'success');
    } catch (error) {
      console.error('Failed to delete annotation:', error);
      toast('Failed to remove highlight', 'error');
    }
  };

  const renderContentWithAnnotations = (content: string) => {
    if (annotations.length === 0) return content;
    type Match = { start: number; end: number; note?: string };
    const matches: Match[] = [];
    annotations.forEach((ann) => {
      if (!ann.text) return;
      let searchFrom = 0;
      while (searchFrom < content.length) {
        const idx = content.indexOf(ann.text, searchFrom);
        if (idx === -1) break;
        matches.push({ start: idx, end: idx + ann.text.length, note: ann.note });
        searchFrom = idx + ann.text.length;
      }
    });
    if (matches.length === 0) return content;
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
      if (m.start > cursor) parts.push(content.substring(cursor, m.start));
      parts.push(
        <mark
          key={`mark-${i}`}
          className="user-annotation"
          title={m.note || ''}
          style={{ backgroundColor: '#fff3a3', padding: '0 2px', borderRadius: '2px' }}
        >
          {content.substring(m.start, m.end)}
        </mark>
      );
      cursor = m.end;
    });
    if (cursor < content.length) parts.push(content.substring(cursor));
    return <>{parts}</>;
  };

  // --- Citation ---
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

  const getSentimentBadgeClass = (label: string) => {
    return `sentiment-badge ${label}`;
  };

  const getEntityPrefix = (type: string) => {
    switch(type) {
      case 'PERSON': return '[P]';
      case 'ORG': return '[O]';
      case 'GPE': return '[L]';
      case 'NORP': return '[G]';
      case 'EVENT': return '[E]';
      default: return '[T]';
    }
  };

  if (loading) {
    return <div className="article-detail-loading">Loading article...</div>;
  }

  if (error) {
    return (
      <div className="article-detail-error">
        <h2>Failed to Load Article</h2>
        <p>{error}</p>
        <button onClick={() => navigate(-1)}>← Go Back</button>
      </div>
    );
  }

  if (!article) {
    return <div className="article-detail-error">Article not found</div>;
  }

  return (
    <div className={`article-detail-page${readingMode ? ' reading-mode' : ''}`}>
      <style>{`
        .article-detail-page.reading-mode .article-content-grid {
          display: block !important;
        }
        .article-detail-page.reading-mode .article-main {
          max-width: 720px;
          margin: 0 auto;
          padding: 48px 24px;
        }
        .article-detail-page.reading-mode .article-text,
        .article-detail-page.reading-mode .article-headline {
          font-family: Georgia, 'Times New Roman', serif;
        }
        .article-detail-page.reading-mode .article-text {
          font-size: 1.15rem;
          line-height: 1.75;
        }
        .article-detail-page.reading-mode .article-sidebar,
        .article-detail-page.reading-mode .article-entities,
        .article-detail-page.reading-mode .related-articles-section,
        .article-detail-page.reading-mode .newspaper-image-section {
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
          background: transparent; border: none; color: #dc2626; cursor: pointer; font-size: 14px;
        }
        .citation-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
          z-index: 2000;
        }
        .citation-modal {
          background: var(--bg-primary, #fff); border-radius: 10px; padding: 20px;
          width: 90%; max-width: 560px; box-shadow: 0 20px 50px rgba(0,0,0,0.25);
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
          background: var(--bg-secondary, #f9fafb); padding: 14px; border-radius: 6px;
          font-size: 14px; line-height: 1.6; margin-bottom: 14px; word-break: break-word;
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

      <div className="article-detail-container">
        {/* Header */}
        <div className="article-header">
          <button onClick={() => navigate(-1)} className="back-button">
            ← Back to Search
          </button>
          <div className="article-meta">
            <span className="article-date">
              {new Date(article.publication_date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </span>
            {article.page_number && (
              <span className="page-number">Page {article.page_number}</span>
            )}
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

        {/* Main Content Grid */}
        <div className="article-content-grid">
          {/* Left Column - Article Content */}
          <div className="article-main">
            <h1 className="article-headline">{article.headline}</h1>

            {/* Article Stats */}
            <div className="article-stats">
              <span className={getSentimentBadgeClass(article.sentiment_label)}>
                {article.sentiment_label === 'positive' && 'Positive'}
                {article.sentiment_label === 'neutral' && 'Neutral'}
                {article.sentiment_label === 'negative' && 'Negative'}
                {' '}({article.sentiment_score.toFixed(2)})
              </span>
              {article.topic_label && (
                <span className="topic-badge">{article.topic_label}</span>
              )}
              <span className="word-count">{article.word_count} words</span>
              <BookmarkButton articleId={String(article.id)} size="normal" />
            </div>

            {/* AI Summary */}
            <div className="article-summary-section">
              <h3>AI Summary</h3>
              {summary ? (
                <div className="ai-summary">{summary}</div>
              ) : (
                <button
                  onClick={generateSummary}
                  disabled={loadingSummary}
                  className="generate-summary-btn"
                >
                  {loadingSummary ? 'Generating...' : 'Generate AI Summary'}
                </button>
              )}
            </div>

            {/* Full Content */}
            <div className="article-full-content">
              <h3>Full Article</h3>
              <div
                className="article-text"
                ref={contentRef}
                onMouseUp={handleTextSelection}
                onKeyUp={handleTextSelection}
                style={{ position: 'relative' }}
              >
                {renderContentWithAnnotations(article.content)}
              </div>
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

            {/* Entities */}
            {article.entities && article.entities.length > 0 && (
              <div className="article-entities">
                <h3>Mentioned Entities</h3>
                <div className="entities-grid">
                  {Array.from(new Set(article.entities.map((e: any) => e.text)))
                    .map((entityText, idx) => {
                      const entity = article.entities.find((e: any) => e.text === entityText);
                      return (
                        <span
                          key={idx}
                          className="entity-tag entity-tag-link"
                          onClick={() => navigate(`/entity/${encodeURIComponent(String(entityText))}`)}
                        >
                          {getEntityPrefix(entity.type)} {entityText}
                        </span>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Newspaper Image & Related */}
          <div className="article-sidebar">
            {/* About this article */}
            <div style={{ marginBottom: '1rem' }}>
              <ErrorBoundary label="Article analytics">
                <ArticleAnalytics article={article} />
              </ErrorBoundary>
            </div>

            {/* Newspaper Image */}
            {article.image_path && (
              <div className="newspaper-image-section">
                <h3>Original Page</h3>
                <img
                  src={`${API_BASE_URL}/${article.image_path}`}
                  alt="Newspaper page"
                  className="newspaper-image"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <div className="image-caption">
                  Page {article.page_number} • {article.section || 'Main Section'}
                </div>
              </div>
            )}

            {/* Story Context Panel */}
            {storyId && (
              <div className="related-articles-section">
                <h3>Ongoing coverage</h3>
                {storyTitle && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', fontStyle: 'italic' }}>
                    {storyTitle}
                  </div>
                )}

                {/* Entity chips */}
                {storyEntities.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                    {storyEntities.map((e: any) => (
                      <span key={e.text} className="entity-tag entity-tag-link"
                        onClick={() => navigate(`/entity/${encodeURIComponent(e.text)}`)}>
                        {e.text}
                      </span>
                    ))}
                  </div>
                )}

                {/* Context narrative */}
                {storyContext ? (
                  <div style={{
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px',
                    padding: '12px', fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.6',
                    marginBottom: '14px'
                  }}>
                    {storyContext.split('\n\n').slice(0, 2).map((para, i) => (
                      <p key={i} style={{ margin: i === 0 ? '0 0 8px 0' : '0' }}>{para}</p>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={generateStoryContext}
                    disabled={generatingContext}
                    style={{
                      width: '100%', padding: '8px', marginBottom: '14px',
                      background: generatingContext ? 'var(--bg-tertiary)' : 'var(--primary-color)',
                      color: generatingContext ? 'var(--text-tertiary)' : '#fff',
                      border: 'none', borderRadius: '6px', fontSize: '12px',
                      fontWeight: '600', cursor: generatingContext ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {generatingContext ? 'Generating context...' : 'Generate Story Context'}
                  </button>
                )}

                {/* Related articles in this story */}
                {relatedArticles.length > 0 && (
                  <div className="related-articles-list">
                    {relatedArticles.map((related) => (
                      <div
                        key={related.id}
                        className="related-article-item"
                        onClick={() => navigate(`/article/${related.id}`)}
                      >
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '2px' }}>
                          {related.publication_date ? related.publication_date.slice(0, 10) : ''}
                        </div>
                        <div className="related-headline">{related.headline}</div>
                        <div className="related-preview">{related.content_preview}...</div>
                        {related.sentiment_label && (
                          <span className={getSentimentBadgeClass(related.sentiment_label)}>
                            {related.sentiment_label}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

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

export default ArticleDetailPage;
