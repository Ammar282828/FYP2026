import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Sparkles, ArrowUpRight, FileText } from 'lucide-react';
import { API_BASE } from '../config';
import { SkeletonChart } from './ui/Skeleton';
import BookmarkButton from './BookmarkButton';
import { useToast } from './ui/Toast';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';

const EntityPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const decodedName = decodeURIComponent(name || '');

  const [mentionData, setMentionData] = useState<any>(null);
  const [sentimentData, setSentimentData] = useState<any>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const { toast } = useToast();
  const [bio, setBio] = useState<{ bio: string; source_count: number; model: string } | null>(null);
  const [bioLoading, setBioLoading] = useState(false);

  const generateBio = async () => {
    if (bio || bioLoading) return;
    setBioLoading(true);
    try {
      const res = await axios.post(
        `${API_BASE}/entities/${encodeURIComponent(decodedName)}/bio`
      );
      setBio({
        bio: res.data.bio,
        source_count: res.data.source_count,
        model: res.data.model,
      });
    } catch (err) {
      toast('Failed to generate AI profile', 'error');
    } finally {
      setBioLoading(false);
    }
  };

  const copyPermalink = async () => {
    const url = `${window.location.origin}/entity/${encodeURIComponent(decodedName)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied', 'success');
    } catch {
      toast('Failed to copy link', 'error');
    }
  };

  useEffect(() => {
    if (!decodedName) return;
    setLoading(true);

    Promise.all([
      axios.get(`${API_BASE}/analytics/entity-mentions-over-time`, {
        params: { entity: decodedName, granularity: 'month' }
      }).catch(() => ({ data: { trends: [] } })),

      axios.get(`${API_BASE}/analytics/entity-sentiment-over-time`, {
        params: { entity: decodedName, granularity: 'month' }
      }).catch(() => ({ data: { trends: [] } })),

      axios.post(`${API_BASE}/search/entity`, {
        entity_name: decodedName, limit: 20
      }).catch(() => ({ data: { articles: [] } })),
    ]).then(([mentionRes, sentimentRes, articlesRes]) => {
      setMentionData(mentionRes.data.trends || []);
      setSentimentData(sentimentRes.data.trends || []);
      setArticles(articlesRes.data.articles || []);
      setLoading(false);
    });
  }, [decodedName]);

  const sentColor = (label: string) => {
    if (label === 'positive') return 'var(--positive)';
    if (label === 'negative') return 'var(--negative)';
    return 'var(--text-tertiary)';
  };

  return (
    <div className="entity-page">
      <div className="entity-page-container">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Back
        </button>

        <div className="entity-page-header">
          <h1 className="entity-page-name">{decodedName}</h1>
          {!loading && (
            <div className="entity-page-stats">
              <div className="entity-mini-stat">
                <span className="entity-mini-val">{articles.length}</span>
                <span className="entity-mini-lbl">Articles</span>
              </div>
              <div className="entity-mini-stat">
                <span className="entity-mini-val">{mentionData?.length || 0}</span>
                <span className="entity-mini-lbl">Time periods</span>
              </div>
            </div>
          )}
        </div>

        <div className="toolbar">
          <button
            onClick={generateBio}
            disabled={bioLoading || !!bio}
            className="btn btn--primary btn--sm"
          >
            <Sparkles size={14} />
            {bioLoading ? 'Generating…' : bio ? 'AI profile ready' : 'Generate AI profile'}
          </button>
          <button
            onClick={copyPermalink}
            className="btn btn--sm"
            title="Copy permalink"
          >
            <ArrowUpRight size={14} /> Copy link
          </button>
        </div>

        {bio && (
          <div className="entity-chart-card entity-bio-card">
            <div className="cluster" style={{ marginBottom: 'var(--space-1)' }}>
              <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Sparkles size={16} /> AI Profile
              </h3>
              <span className="chip chip--accent" style={{ textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {bio.model}
              </span>
            </div>
            <div className="stat-sub" style={{ marginBottom: 'var(--space-2)' }}>
              Based on {bio.source_count} article{bio.source_count === 1 ? '' : 's'}
            </div>
            <div className="entity-bio-card__body">{bio.bio}</div>
          </div>
        )}

        {loading ? (
          <div className="stack stack--loose">
            <SkeletonChart />
            <SkeletonChart />
          </div>
        ) : (
          <>
            {/* Mention frequency chart */}
            {mentionData && mentionData.length > 0 && (
              <div className="entity-chart-card">
                <h3>Mentions Over Time</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={mentionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontSize: '0.85rem'
                      }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {mentionData.map((_: any, i: number) => (
                        <Cell key={i} fill="var(--primary-color)" opacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Sentiment over time chart */}
            {sentimentData && sentimentData.length > 0 && (
              <div className="entity-chart-card">
                <h3>Sentiment Over Time</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={sentimentData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                    <YAxis domain={[-1, 1]} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontSize: '0.85rem'
                      }}
                    />
                    <Line type="monotone" dataKey="avg_sentiment" stroke="var(--primary-color)"
                      strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Articles mentioning this entity */}
            <div className="entity-chart-card">
              <h3>Articles Mentioning {decodedName}</h3>
              {articles.length === 0 ? (
                <div className="empty-state">
                  <FileText size={28} className="empty-state__icon" />
                  <div className="empty-state__title">No articles mention {decodedName} yet</div>
                  <div className="empty-state__body">
                    As more issues are processed, mentions will surface here automatically.
                  </div>
                </div>
              ) : (
                <div className="entity-articles-list">
                  {articles.map((article: any) => (
                    <div key={article.id} className="entity-article-row"
                      onClick={() => navigate(`/article/${article.id}`)}>
                      <div className="entity-article-info">
                        <span className="entity-article-headline">{article.headline}</span>
                        <span className="entity-article-meta">
                          {article.publication_date?.slice(0, 10)}
                          {article.topic_label && ` • ${article.topic_label.replace(/_/g, ' ').slice(0, 30)}`}
                        </span>
                      </div>
                      <div className="cluster">
                        <span className="sentiment-badge" style={{
                          backgroundColor: sentColor(article.sentiment_label),
                        }}>
                          {article.sentiment_label}
                        </span>
                        <BookmarkButton articleId={article.id} size="small" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default EntityPage;
