import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Sparkles, FileText } from 'lucide-react';
import { API_BASE } from '../config';

const sentimentColor: Record<string, string> = {
  positive: 'var(--positive)',
  negative: 'var(--negative)',
  neutral: 'var(--text-secondary)',
};

const TopicDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [topic, setTopic] = useState<any>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [loadingTopic, setLoadingTopic] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;

    const loadTopic = async () => {
      try {
        const [topicRes, articlesRes] = await Promise.all([
          axios.get(`${API_BASE}/topics/by-id/${id}`),
          axios.get(`${API_BASE}/topics/${id}/articles`),
        ]);
        setTopic(topicRes.data);
        setArticles(articlesRes.data.articles || []);
      } catch (err) {
        setError('Failed to load topic.');
      } finally {
        setLoadingTopic(false);
      }
    };

    const loadSummary = async () => {
      try {
        const res = await axios.get(`${API_BASE}/topics/${id}/summary`);
        setSummary(res.data.summary || '');
      } catch {
        setSummary('Could not generate summary for this topic.');
      } finally {
        setLoadingSummary(false);
      }
    };

    loadTopic();
    loadSummary();
  }, [id]);

  if (loadingTopic) {
    return (
      <div className="topic-detail">
        <div className="topic-detail__inner stack">
          <div className="skeleton skeleton-line" style={{ width: '40%' }} />
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-block" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="topic-detail">
        <div className="topic-detail__inner">
          <div className="empty-state">
            <FileText size={28} className="empty-state__icon" />
            <div className="empty-state__title">Topic unavailable</div>
            <div className="empty-state__body">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  const topicColor = 'var(--primary-color)';
  const keywords: string[] = topic?.keywords || [];

  return (
    <div className="topic-detail">
      {/* Breadcrumb header bar */}
      <div className="topic-detail__breadcrumb">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Back
        </button>
        <span className="topic-detail__crumbs">
          Analytics &nbsp;/&nbsp; Discovered topics &nbsp;/&nbsp;
          <strong>{topic?.name || `Topic ${id}`}</strong>
        </span>
      </div>

      <div className="topic-detail__inner">
        {/* Topic title */}
        <div className="topic-detail__title-row">
          <span
            className="topic-detail__dot"
            style={{ background: topicColor }}
            aria-hidden="true"
          />
          <h1 className="topic-detail__title">
            {topic?.name || `Topic ${id}`}
          </h1>
          <span className="chip chip--accent">
            {articles.length} {articles.length === 1 ? 'article' : 'articles'}
          </span>
        </div>

        {/* Keywords */}
        {keywords.length > 0 && (
          <div className="cluster" style={{ marginBottom: 'var(--space-5)' }}>
            {keywords.map((kw, i) => (
              <span key={i} className="chip">{kw}</span>
            ))}
          </div>
        )}

        {/* AI Summary */}
        <div className="entity-chart-card">
          <h2 className="section-title cluster" style={{ marginTop: 0 }}>
            <Sparkles size={16} /> AI summary
            {loadingSummary && (
              <span className="stat-sub" style={{ fontWeight: 400 }}>generating…</span>
            )}
          </h2>
          {loadingSummary ? (
            <div className="stack stack--tight" aria-busy="true">
              <div className="skeleton skeleton-line" style={{ width: '92%' }} />
              <div className="skeleton skeleton-line" style={{ width: '85%' }} />
              <div className="skeleton skeleton-line" style={{ width: '60%' }} />
            </div>
          ) : (
            <div className="topic-detail__summary">{summary}</div>
          )}
        </div>

        {/* Articles list */}
        <div className="entity-chart-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="topic-detail__list-head">
            <h2 className="section-title" style={{ margin: 0 }}>All articles</h2>
            <span className="article-list__count">{articles.length} total</span>
          </div>

          {articles.length === 0 ? (
            <div className="empty-state">
              <FileText size={28} className="empty-state__icon" />
              <div className="empty-state__title">No articles in this topic yet</div>
              <div className="empty-state__body">
                As more issues are processed, articles tagged with this topic will appear here.
              </div>
            </div>
          ) : (
            <div className="entity-articles-list" style={{ padding: '0 var(--space-5)' }}>
              {articles.map((article, idx) => (
                <div
                  key={article.id || idx}
                  className="entity-article-row"
                  onClick={() => navigate(`/article/${article.id}`)}
                >
                  <span className="topic-detail__row-num">{idx + 1}</span>
                  <div className="entity-article-info">
                    <span className="entity-article-headline">
                      {article.headline}
                    </span>
                    {article.publication_date && (
                      <span className="entity-article-meta">
                        {article.publication_date}
                      </span>
                    )}
                  </div>
                  {article.sentiment_label && (
                    <span
                      className="topic-detail__sentiment"
                      style={{
                        color: sentimentColor[article.sentiment_label] || 'var(--text-secondary)',
                      }}
                    >
                      {article.sentiment_label}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TopicDetailPage;
