import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Search,
  Newspaper,
  BarChart,
  TrendingUp,
  ArrowUpRight,
} from 'lucide-react';
import { API_BASE } from '../config';
import EmptyState from './ui/EmptyState';

interface Props {
  recentArticles: any[];
  onSearch: (query: string) => void;
  onNavigate: (tab: 'search' | 'stories' | 'analytics' | 'ocr' | 'ad-browser') => void;
}

const SUGGESTED = ['Benazir Bhutto', 'Kashmir', 'Gulf War', 'Nawaz Sharif', 'MQM', 'Cricket'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatTodayInArchive(): string {
  const today = new Date();
  return `${MONTH_NAMES[today.getMonth()]} ${today.getDate()}`;
}

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
      params: { month: today.getMonth() + 1, day: today.getDate(), limit: 10 },
    })
      .then(r => {
        setOnThisDay((r.data.articles || []).slice(0, 8));
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

  // Build the editorial hero subline. Falls back gracefully when counts
  // haven't loaded yet — never shows a partial "On April 25 — Loading…"
  // sentence which would look broken.
  const heroDate = formatTodayInArchive();
  const heroCount = onThisDayLoaded ? onThisDay.length : null;

  return (
    <div className="dash-home">
      {/* ─── Editorial hero ─────────────────────────────────────────── */}
      <header className="dash-hero">
        <div className="dash-hero__eyebrow">Dawn Newspaper Archive · 1990–1992</div>
        <h1 className="dash-hero__title">
          On <span className="dash-hero__date">{heroDate}</span> in the archive
        </h1>
        <p className="dash-hero__subtitle">
          {heroCount === null
            ? 'Loading the corpus published on this day…'
            : heroCount === 0
              ? `No articles in the archive carry today's date (${heroDate}). Browse the timeline instead.`
              : `${heroCount} article${heroCount === 1 ? '' : 's'} published on ${heroDate} between 1990 and 1992.`}
        </p>
      </header>

      {/* ─── Search bar (compact, integrated into hero) ──────────────── */}
      <form className="dash-search-form" onSubmit={handleSubmit}>
        <Search size={18} className="dash-search-icon" aria-hidden />
        <input
          className="dash-search-input"
          type="text"
          placeholder='Search the archive — "Benazir", "Kashmir", "cricket"…'
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

      {/* ─── On this day, as a dense list (was: card grid) ─────────── */}
      {onThisDayLoaded && onThisDay.length > 0 && (
        <section className="dash-section">
          <div className="section-header">
            <div>
              <div className="section-eyebrow">On this day</div>
              <h2 className="section-title">{heroDate}, 1990–1992</h2>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('search')}>
              See all <ArrowUpRight size={14} />
            </button>
          </div>
          <ul className="dash-otd-list">
            {onThisDay.map(a => {
              const date = String(a.publication_date || '').slice(0, 10);
              const year = date.slice(0, 4);
              return (
                <li key={a.id} className="dash-otd-row" onClick={() => navigate(`/article/${a.id}`)}>
                  <span className="dash-otd-year">{year}</span>
                  <span className="dash-otd-headline">{a.headline || 'Untitled'}</span>
                  {a.sentiment_label && (
                    <span
                      className="dash-otd-sentiment"
                      style={{ color: sentimentColor[a.sentiment_label] || 'var(--text-tertiary)' }}
                      title={`Sentiment: ${a.sentiment_label}`}
                    >
                      ●
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ─── Stat band (single inline row, not a card grid) ──────────── */}
      <section className="dash-statband">
        <div className="dash-statband__item">
          <div className="dash-statband__num">{articleCount?.toLocaleString() ?? '—'}</div>
          <div className="dash-statband__lbl">Articles indexed</div>
        </div>
        <div className="dash-statband__item">
          <div className="dash-statband__num">{topicCount ?? '—'}</div>
          <div className="dash-statband__lbl">Topic categories</div>
        </div>
        <div className="dash-statband__item">
          <div className="dash-statband__num">{storyCount ?? '—'}</div>
          <div className="dash-statband__lbl">Ongoing stories</div>
        </div>
        <div className="dash-statband__item">
          <div className="dash-statband__num">1990–92</div>
          <div className="dash-statband__lbl">Coverage span</div>
        </div>
      </section>

      {/* ─── Two columns: stories + recent ──────────────────────────── */}
      <div className="dash-columns">
        <section className="dash-section">
          <div className="section-header">
            <div>
              <div className="section-eyebrow">Tracked threads</div>
              <h2 className="section-title">Ongoing stories</h2>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('stories')}>
              All stories <ArrowUpRight size={14} />
            </button>
          </div>
          {featuredStories.length === 0 ? (
            <EmptyState
              icon={<TrendingUp size={28} strokeWidth={1.5} />}
              title="No clustered stories yet"
              description="Run scripts/build_stories.py to cluster related articles into ongoing narrative threads."
              action={{ label: 'Open Stories tab', onClick: () => onNavigate('stories') }}
            />
          ) : (
            <ul className="dash-story-list">
              {featuredStories.map(story => (
                <li
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
                      <span key={e.text} className="chip">{e.text}</span>
                    ))}
                  </div>
                  {story.narrative && <span className="chip chip--accent">Arc written</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dash-section">
          <div className="section-header">
            <div>
              <div className="section-eyebrow">Latest indexed</div>
              <h2 className="section-title">Recent articles</h2>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => onNavigate('search')}>
              Browse <ArrowUpRight size={14} />
            </button>
          </div>
          <ul className="dash-article-list">
            {recentArticles.slice(0, 7).map(article => (
              <li
                key={article.id}
                className="dash-article-row"
                onClick={() => navigate(`/article/${article.id}`)}
              >
                <span
                  className="dash-article-dot"
                  style={{ background: sentimentColor[article.sentiment_label] || '#9ca3af' }}
                  aria-hidden
                />
                <div className="dash-article-body">
                  <div className="dash-article-date">{String(article.publication_date || '').slice(0, 10)}</div>
                  <div className="dash-article-headline">{article.headline || 'Untitled'}</div>
                  {article.topic_label && (
                    <div className="dash-article-topic">{article.topic_label.replace(/_/g, ' ')}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ─── Quiet nav row (was: 3 big CTA cards with emoji) ────────── */}
      <nav className="dash-quicknav">
        <button className="dash-quicknav__item" onClick={() => onNavigate('analytics')}>
          <BarChart size={18} strokeWidth={1.75} />
          <span>Analytics</span>
        </button>
        <button className="dash-quicknav__item" onClick={() => onNavigate('ad-browser')}>
          <Newspaper size={18} strokeWidth={1.75} />
          <span>Ad Browser</span>
        </button>
        <button className="dash-quicknav__item" onClick={() => onNavigate('ocr')}>
          <Calendar size={18} strokeWidth={1.75} />
          <span>OCR Pipeline</span>
        </button>
      </nav>
    </div>
  );
};

export default DashboardHome;
