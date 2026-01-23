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
}

const ArticleList: React.FC<ArticleListProps> = ({ articles }) => {
  const navigate = useNavigate();

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
            <span className="article-date">
              {formatDate(article.publication_date)}
            </span>
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
