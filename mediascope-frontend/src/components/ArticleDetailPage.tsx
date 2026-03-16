import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { API_BASE, API_BASE_URL } from '../config';

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

const ArticleDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  useEffect(() => {
    if (id) {
      loadArticle();
      loadRelatedArticles();
    }
  }, [id]);

  const loadArticle = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_BASE}/articles/${id}/full`);
      setArticle(response.data.article);
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

  const generateStoryContext = async () => {
    if (!storyId) return;
    setGeneratingContext(true);
    try {
      await axios.post(`${API_BASE}/stories/generate`, { story_id: storyId, force: false });
      // Poll for narrative
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
    <div className="article-detail-page">
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
              <div className="article-text">{article.content}</div>
            </div>

            {/* Entities */}
            {article.entities && article.entities.length > 0 && (
              <div className="article-entities">
                <h3>Mentioned Entities</h3>
                <div className="entities-grid">
                  {Array.from(new Set(article.entities.map((e: any) => e.text)))
                    .map((entityText, idx) => {
                      const entity = article.entities.find((e: any) => e.text === entityText);
                      return (
                        <span key={idx} className="entity-tag">
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
                <h3>📰 Ongoing Coverage</h3>
                {storyTitle && (
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px', fontStyle: 'italic' }}>
                    {storyTitle}
                  </div>
                )}

                {/* Entity chips */}
                {storyEntities.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                    {storyEntities.map((e: any) => (
                      <span key={e.text} style={{
                        fontSize: '11px', padding: '2px 8px', borderRadius: '12px',
                        background: '#ede9fe', color: '#5b21b6', border: '1px solid #ddd6fe'
                      }}>
                        {e.text}
                      </span>
                    ))}
                  </div>
                )}

                {/* Context narrative */}
                {storyContext ? (
                  <div style={{
                    background: '#f8faff', border: '1px solid #e0e7ff', borderRadius: '8px',
                    padding: '12px', fontSize: '13px', color: '#374151', lineHeight: '1.6',
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
                      background: generatingContext ? '#e5e7eb' : '#4f46e5',
                      color: generatingContext ? '#9ca3af' : '#fff',
                      border: 'none', borderRadius: '6px', fontSize: '12px',
                      fontWeight: '600', cursor: generatingContext ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {generatingContext ? 'Generating context…' : '✦ Generate Story Context'}
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
                        <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '2px' }}>
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
    </div>
  );
};

export default ArticleDetailPage;
