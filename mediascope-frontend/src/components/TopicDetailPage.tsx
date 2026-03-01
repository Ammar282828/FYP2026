import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE } from '../config';

const sentimentColor: Record<string, string> = {
  positive: '#10b981',
  negative: '#ef4444',
  neutral: '#6b7280',
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
      <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
        Loading topic...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: '#ef4444' }}>
        {error}
      </div>
    );
  }

  const topicColor = '#667eea';
  const keywords: string[] = topic?.keywords || [];

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* Header bar */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e5e7eb',
        padding: '1rem 2rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            padding: '6px 14px',
            fontSize: '13px',
            cursor: 'pointer',
            color: '#374151',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          ← Back
        </button>
        <span style={{ color: '#9ca3af', fontSize: '13px' }}>Analytics / Discovered Topics /</span>
        <span style={{ fontWeight: '600', fontSize: '13px', color: '#1f2937' }}>
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
            <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: '700', color: '#1f2937' }}>
              {topic?.name || `Topic ${id}`}
            </h1>
            <span style={{
              background: '#eef2ff',
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
                  background: '#f3f4f6',
                  color: '#374151',
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
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '10px',
          padding: '1.5rem',
          marginBottom: '2rem',
        }}>
          <h2 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: '700', color: '#1f2937', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>AI Summary</span>
            {loadingSummary && (
              <span style={{ fontSize: '12px', fontWeight: '400', color: '#9ca3af' }}>generating...</span>
            )}
          </h2>
          {loadingSummary ? (
            <div style={{ color: '#9ca3af', fontSize: '14px', fontStyle: 'italic' }}>
              Analyzing {articles.length} articles with Gemini...
            </div>
          ) : (
            <div style={{
              fontSize: '14px',
              lineHeight: '1.75',
              color: '#374151',
              whiteSpace: 'pre-wrap',
            }}>
              {summary}
            </div>
          )}
        </div>

        {/* Articles list */}
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '10px',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '1rem 1.5rem',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: '700', color: '#1f2937' }}>
              All Articles
            </h2>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>{articles.length} total</span>
          </div>

          {articles.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>
              No articles found for this topic.
            </div>
          ) : (
            <div>
              {articles.map((article, idx) => (
                <div
                  key={article.id || idx}
                  onClick={() => navigate(`/article/${article.id}`)}
                  style={{
                    padding: '14px 1.5rem',
                    borderBottom: idx < articles.length - 1 ? '1px solid #f3f4f6' : 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                >
                  <span style={{ color: '#d1d5db', fontSize: '12px', minWidth: '28px' }}>
                    {idx + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#1f2937', marginBottom: '2px' }}>
                      {article.headline}
                    </div>
                    {article.publication_date && (
                      <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                        {article.publication_date}
                      </div>
                    )}
                  </div>
                  {article.sentiment_label && (
                    <span style={{
                      fontSize: '11px',
                      fontWeight: '600',
                      color: sentimentColor[article.sentiment_label] || '#6b7280',
                      textTransform: 'capitalize',
                      minWidth: '55px',
                      textAlign: 'right',
                    }}>
                      {article.sentiment_label}
                    </span>
                  )}
                  <span style={{ color: '#9ca3af', fontSize: '13px' }}>→</span>
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
