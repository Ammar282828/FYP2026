import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
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
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading topic...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--danger-color)' }}>
        {error}
      </div>
    );
  }

  const topicColor = 'var(--primary-color)';
  const keywords: string[] = topic?.keywords || [];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-secondary)' }}>
      {/* Header bar */}
      <div style={{
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-color)',
        padding: '1rem 2rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
      }}>
        <button className="back-button" onClick={() => navigate(-1)}>
          {'\u2190'} Back
        </button>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>Analytics / Discovered Topics /</span>
        <span style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text-primary)' }}>
          {topic?.name || `Topic ${id}`}
        </span>
      </div>

      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '2rem' }}>

        {/* Topic title */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <span style={{
              background: topicColor,
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              flexShrink: 0,
            }} />
            <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
              {topic?.name || `Topic ${id}`}
            </h1>
            <span style={{
              background: 'var(--bg-tertiary)',
              color: topicColor,
              padding: '4px 12px',
              borderRadius: '12px',
              fontSize: '13px',
              fontWeight: '600',
            }}>
              {articles.length} articles
            </span>
          </div>

          {/* Keywords */}
          {keywords.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
              {keywords.map((kw, i) => (
                <span key={i} style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  padding: '3px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '500',
                }}>
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* AI Summary */}
        <div className="entity-chart-card">
          <h2 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>AI Summary</span>
            {loadingSummary && (
              <span style={{ fontSize: '12px', fontWeight: '400', color: 'var(--text-tertiary)' }}>generating...</span>
            )}
          </h2>
          {loadingSummary ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: '14px', fontStyle: 'italic' }}>
              Analyzing {articles.length} articles with Gemini...
            </div>
          ) : (
            <div style={{
              fontSize: '14px',
              lineHeight: '1.75',
              color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
            }}>
              {summary}
            </div>
          )}
        </div>

        {/* Articles list */}
        <div className="entity-chart-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '1rem 1.5rem',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)' }}>
              All Articles
            </h2>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{articles.length} total</span>
          </div>

          {articles.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
              No articles found for this topic.
            </div>
          ) : (
            <div className="entity-articles-list" style={{ padding: '0 1.5rem' }}>
              {articles.map((article, idx) => (
                <div
                  key={article.id || idx}
                  className="entity-article-row"
                  onClick={() => navigate(`/article/${article.id}`)}
                >
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '12px', minWidth: '28px' }}>
                    {idx + 1}
                  </span>
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
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      color: sentimentColor[article.sentiment_label] || 'var(--text-secondary)',
                      textTransform: 'capitalize',
                      minWidth: '55px',
                      textAlign: 'right',
                    }}>
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
