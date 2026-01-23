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
      setRelatedArticles(response.data.related_articles || []);
    } catch (error) {
      console.error('Error loading related articles:', error);
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

            {/* Related Articles */}
            {relatedArticles.length > 0 && (
              <div className="related-articles-section">
                <h3>More from this Issue</h3>
                <div className="related-articles-list">
                  {relatedArticles.map((related) => (
                    <div
                      key={related.id}
                      className="related-article-item"
                      onClick={() => navigate(`/article/${related.id}`)}
                    >
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArticleDetailPage;
