import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';

const API_BASE = 'http://localhost:8000/api';

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

const ArticleDetail: React.FC = () => {
  const { articleId } = useParams<{ articleId: string }>();
  const navigate = useNavigate();
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState<AISummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [relatedArticles, setRelatedArticles] = useState<ArticleData[]>([]);

  useEffect(() => {
    loadArticle();
  }, [articleId]);

  const loadArticle = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/articles/${articleId}`);
      setArticle(response.data);
      
      // Load related articles based on topic
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

  const getSentimentColor = (label: string) => {
    switch (label) {
      case 'positive': return '#10b981';
      case 'negative': return '#ef4444';
      default: return '#6b7280';
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
    <div className="article-detail-container">
      <div className="article-detail-header">
        <button className="back-button" onClick={() => navigate('/')}>
          ← Back to Search
        </button>
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
          <div className="content-text">
            {article.content.split('\n').map((paragraph, idx) => (
              paragraph.trim() && <p key={idx}>{paragraph}</p>
            ))}
          </div>
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
    </div>
  );
};

export default ArticleDetail;
