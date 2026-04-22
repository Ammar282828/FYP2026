import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import EmptyState from './ui/EmptyState';

interface Props {
  recentArticles: any[];
  onSearch: (query: string) => void;
  onNavigate: (tab: 'search' | 'stories' | 'analytics' | 'ocr' | 'ad-browser') => void;
}

const SUGGESTED = ['Benazir Bhutto', 'Kashmir', 'Gulf War', 'Nawaz Sharif', 'MQM', 'Cricket'];

const DashboardHome: React.FC<Props> = ({ recentArticles, onSearch, onNavigate }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [articleCount, setArticleCount] = useState<number | null>(null);
  const [storyCount, setStoryCount] = useState<number | null>(null);
  const [topicCount, setTopicCount] = useState<number | null>(null);
  const [featuredStories, setFeaturedStories] = useState<any[]>([]);
  const [onThisDay, setOnThisDay] = useState<any[]>([]);
  const [onThisDayLoaded, setOnThisDayLoaded] = useState(false);

  useEffect(() => {
    axios.get(`${API_BASE}/analytics/data-version`)
      .then(r => setArticleCount(r.data.article_count))
      .catch(() => {});

    axios.get(`${API_BASE}/topics/`)
      .then(r => setTopicCount(r.data.topic_count))
      .catch(() => {});

    axios.get(`${API_BASE}/stories/?limit=200`)
      .then(r => {
        const stories: any[] = r.data.stories || [];
        setStoryCount(stories.length);
        const sorted = [...stories].sort((a, b) => (b.article_count || 0) - (a.article_count || 0));
        setFeaturedStories(sorted.filter(s => s.article_count >= 3).slice(0, 4));
      })
      .catch(() => {});

    const today = new Date();
    axios.get(`${API_BASE}/articles/on-this-day`, {
      params: { month: today.getMonth() + 1, day: today.getDate(), limit: 10 }
    })
      .then(r => {
        setOnThisDay((r.data.articles || []).slice(0, 5));
        setOnThisDayLoaded(true);
      })
      .catch(() => setOnThisDayLoaded(true));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch(query.trim());
  };

  const sentimentColor: Record<string, string> = {
    positive: 'var(--positive)',
    negative: 'var(--negative)',
    neutral: 'var(--text-tertiary)',
  };

  return (
    <div className="dash-home">

      {/* Stats */}
      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-val">{articleCount?.toLocaleString() ?? '—'}</span>
          <span className="dash-stat-lbl">Articles</span>
        </div>
        <div className="dash-stat-div" />
        <div className="dash-stat">
          <span className="dash-stat-val">{topicCount ?? '—'}</span>
          <span className="dash-stat-lbl">Topics</span>
        </div>
        <div className="dash-stat-div" />
        <div className="dash-stat">
          <span className="dash-stat-val">{storyCount ?? '—'}</span>
          <span className="dash-stat-lbl">Ongoing Stories</span>
        </div>
        <div className="dash-stat-div" />
        <div className="dash-stat">
          <span className="dash-stat-val">1990 – 1992</span>
          <span className="dash-stat-lbl">Archive Period</span>
        </div>
      </div>

      {/* On This Day */}
      {onThisDayLoaded && (
        <section className="dash-section" style={{ marginTop: '1.25rem' }}>
          <div className="dash-section-hdr">
            <h2>{'\uD83D\uDCC5'} On This Day in the Archive</h2>
          </div>
          {onThisDay.length === 0 ? (
            <EmptyState
              icon={'\uD83D\uDCC5'}
              title="Nothing from today's date"
              description="No articles from this exact date are in the archive. Try exploring recent articles below."
              action={{ label: 'Browse recent articles', onClick: () => onNavigate('search') }}
            />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '0.75rem'
              }}
            >
              {onThisDay.map(a => {
                const year = String(a.publication_date || '').slice(0, 4);
                return (
                  <div
                    key={a.id}
                    className="dash-story-card"
                    onClick={() => navigate(`/article/${a.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="dash-story-title" style={{ fontSize: '0.95rem' }}>
                      {a.headline || 'Untitled'}
                    </div>
                    <div className="dash-story-meta" style={{ marginTop: '0.35rem' }}>
                      <span style={{ fontWeight: 600 }}>{year}</span>
                      {a.sentiment_label && (
                        <>
                          {' \u00B7 '}
                          <span
                            style={{
                              color: sentimentColor[a.sentiment_label] || 'var(--text-tertiary)',
                              textTransform: 'capitalize'
                            }}
                          >
                            {a.sentiment_label}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Search */}
      <form className="dash-search-form" onSubmit={handleSubmit}>
        <input
          className="dash-search-input"
          type="text"
          placeholder='Search by keyword or name — "Benazir", "Kashmir", "cricket"...'
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
        <button type="submit" className="dash-search-btn">Search</button>
      </form>
      <div className="dash-suggestions">
        {SUGGESTED.map(s => (
          <button key={s} className="dash-suggestion-pill" onClick={() => onSearch(s)}>{s}</button>
        ))}
      </div>

      <div className="dash-columns">

        {/* Featured stories */}
        <section className="dash-section">
          <div className="dash-section-hdr">
            <h2>Ongoing Stories</h2>
            <button className="dash-see-all" onClick={() => onNavigate('stories')}>See all →</button>
          </div>
          {featuredStories.length === 0 ? (
            <EmptyState
              icon={'\uD83D\uDCDA'}
              title="No stories yet"
              description="Run scripts/build_stories.py to cluster articles into ongoing stories, then come back to see them here."
              action={{ label: 'Open Stories tab', onClick: () => onNavigate('stories') }}
            />
          ) : (
            <div className="dash-story-list">
              {featuredStories.map(story => (
                <div
                  key={story.id}
                  className="dash-story-card"
                  onClick={() => onNavigate('stories')}
                >
                  <div className="dash-story-title">{story.title}</div>
                  <div className="dash-story-meta">
                    {story.article_count} article{story.article_count !== 1 ? 's' : ''}
                    {story.start_date ? ` · ${story.start_date.slice(0, 10)}` : ''}
                    {story.date_span_days > 0 ? ` → ${story.end_date?.slice(0, 10)}` : ''}
                  </div>
                  <div className="dash-story-entities">
                    {(story.key_entities || []).slice(0, 3).map((e: any) => (
                      <span key={e.text} className="dash-entity-chip">{e.text}</span>
                    ))}
                  </div>
                  {story.narrative && <span className="dash-arc-badge">Arc written</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent articles */}
        <section className="dash-section">
          <div className="dash-section-hdr">
            <h2>Recent Articles</h2>
            <button className="dash-see-all" onClick={() => onNavigate('search')}>Browse all →</button>
          </div>
          <div className="dash-article-list">
            {recentArticles.slice(0, 7).map(article => (
              <div
                key={article.id}
                className="dash-article-row"
                onClick={() => navigate(`/article/${article.id}`)}
              >
                <div
                  className="dash-article-dot"
                  style={{ background: sentimentColor[article.sentiment_label] || '#9ca3af' }}
                />
                <div className="dash-article-body">
                  <div className="dash-article-date">{String(article.publication_date || '').slice(0, 10)}</div>
                  <div className="dash-article-headline">{article.headline || 'Untitled'}</div>
                  {article.topic_label && (
                    <div className="dash-article-topic">{article.topic_label.replace(/_/g, ' ')}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>

      {/* Bottom CTAs */}
      <div className="dash-ctas">
        <div className="dash-cta" onClick={() => onNavigate('analytics')}>
          <div className="dash-cta-icon">📊</div>
          <div>
            <strong>Analytics</strong>
            <p>Explore topic trends, entity networks, and sentiment patterns across the archive</p>
          </div>
        </div>
        <div className="dash-cta" onClick={() => onNavigate('ad-browser')}>
          <div className="dash-cta-icon">📰</div>
          <div>
            <strong>Ad Browser</strong>
            <p>Browse and analyse the advertisements published alongside news coverage</p>
          </div>
        </div>
        <div className="dash-cta" onClick={() => onNavigate('ocr')}>
          <div className="dash-cta-icon">🔍</div>
          <div>
            <strong>OCR Pipeline</strong>
            <p>Upload new newspaper images to extract and index articles automatically</p>
          </div>
        </div>
      </div>

    </div>
  );
};

export default DashboardHome;
