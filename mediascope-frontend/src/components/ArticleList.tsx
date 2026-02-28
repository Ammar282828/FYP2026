import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE } from '../config';

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
}

const ArticleList: React.FC<ArticleListProps> = ({ articles, onArticleDeleted }) => {
  const navigate = useNavigate();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (articleId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation when clicking delete
    
    if (!window.confirm('Are you sure you want to delete this article? This action cannot be undone.')) {
      return;
    }

    setDeletingId(articleId);
    
    try {
      await axios.delete(`${API_BASE}/articles/${articleId}`);
      alert('Article deleted successfully');
      
      // Trigger callback to refresh the list
      if (onArticleDeleted) {
        onArticleDeleted();
      }
    } catch (error: any) {
      console.error('Failed to delete article:', error);
      alert(`Failed to delete article: ${error.response?.data?.detail || error.message}`);
    } finally {
      setDeletingId(null);
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

  return (
    <div className="article-list">
      {articles.map((article) => (
        <div 
          key={article.id} 
          className="article-card"
          onClick={() => navigate(`/article/${article.id}`)}
          style={{ cursor: 'pointer' }}
        >
          <div className="article-header">
            <h3 className="article-headline">
              {article.headline}
            </h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className="article-date">
                {formatDate(article.publication_date)}
              </span>
              <button
                onClick={(e) => handleDelete(article.id, e)}
                disabled={deletingId === article.id}
                style={{
                  background: deletingId === article.id ? '#9ca3af' : '#ef4444',
                  color: 'white',
                  border: 'none',
                  padding: '4px 12px',
                  borderRadius: '4px',
                  cursor: deletingId === article.id ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  fontWeight: '500',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => {
                  if (deletingId !== article.id) {
                    e.currentTarget.style.background = '#dc2626';
                  }
                }}
                onMouseLeave={(e) => {
                  if (deletingId !== article.id) {
                    e.currentTarget.style.background = '#ef4444';
                  }
                }}
              >
                {deletingId === article.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>

          <div className="article-content-preview">
            {article.content_preview}...
            <span style={{ color: '#3b82f6', marginLeft: '8px', fontWeight: '600' }}>
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
                  <span key={idx} className="entity-tag">
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
