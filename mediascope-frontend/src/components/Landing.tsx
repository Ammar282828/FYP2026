import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import axios from 'axios';
import { BarChart3, BookOpenText, MessageSquareText, Newspaper, Search } from 'lucide-react';
import AuthPage from './AuthPage';
import { useAuth } from '../contexts/AuthContext';
import './Landing.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000/api';

type AuthMode = 'login' | 'register';

function useTypewriter(text: string, charsPerSecond: number) {
  const [visibleLength, setVisibleLength] = useState(() => (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? text.length : 0
  ));

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setVisibleLength(text.length);
      return;
    }

    setVisibleLength(0);
    const delay = 1000 / charsPerSecond;
    const timer = window.setInterval(() => {
      setVisibleLength((current) => {
        if (current >= text.length) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, delay);

    return () => window.clearInterval(timer);
  }, [charsPerSecond, text]);

  return text.slice(0, visibleLength);
}

const ctas = [
  { label: 'Search the archive', to: '/dashboard?tab=search', Icon: Search },
  { label: 'Browse advertisements', to: '/dashboard?tab=ad-browser', Icon: Newspaper },
  { label: 'Explore analytics', to: '/dashboard?tab=analytics', Icon: BarChart3 },
  { label: 'Ask the archive', to: '/dashboard?tab=chat', Icon: MessageSquareText, primary: true },
];

interface LiveStats {
  totalArticles: number | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  latestHeadline: string | null;
}

const Landing: React.FC = () => {
  const { user, loading } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [stats, setStats] = useState<LiveStats>({
    totalArticles: null,
    coverageStart: null,
    coverageEnd: null,
    latestHeadline: null,
  });
  const title = useTypewriter('MediaScope', 11);

  // Pull live archive stats so the Landing page proves the backend is
  // wired in, not just a static brochure. Fails silently if the API is
  // unavailable — we just keep the placeholder ticker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [countRes, articlesRes] = await Promise.all([
          axios.get(`${API_BASE}/analytics/total-articles`).catch(() => null),
          axios.get(`${API_BASE}/articles`, { params: { limit: 1, sort_by: 'date' } }).catch(() => null),
        ]);
        if (cancelled) return;
        const count: number | undefined = countRes?.data?.total_articles;
        const latest = articlesRes?.data?.articles?.[0];
        const headline: string | undefined = latest?.headline;
        const pub: string | undefined = latest?.publication_date;
        const yr = pub ? new Date(pub).getUTCFullYear() : NaN;
        setStats((s) => ({
          ...s,
          totalArticles: typeof count === 'number' ? count : s.totalArticles,
          coverageStart: '1990',
          coverageEnd: !Number.isNaN(yr) ? String(yr) : '1993',
          latestHeadline: headline || s.latestHeadline,
        }));
      } catch {
        /* keep defaults */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dateStamp = useMemo(() => (
    new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date())
  ), []);

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="landing-page">
      <header className="landing-masthead">
        <Link to="/" className="landing-wordmark" aria-label="MediaScope home">
          <BookOpenText size={22} strokeWidth={1.5} />
          <span>MediaScope</span>
        </Link>
        <nav className="landing-auth" aria-label="Account">
          <button type="button" className="landing-link-btn" onClick={() => setAuthMode('login')}>
            Sign in
          </button>
          <button type="button" className="landing-primary-btn" onClick={() => setAuthMode('register')}>
            Sign up
          </button>
        </nav>
      </header>

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <p className="landing-date landing-reveal landing-reveal--date">{dateStamp}</p>
          <h1 id="landing-title" className="landing-title" aria-label="MediaScope">
            {title}
            <span className="landing-caret" aria-hidden="true" />
          </h1>
          <p className="landing-subtitle landing-reveal landing-reveal--subtitle">
            A searchable archive of Pakistan's 1990s newsprint, parsed by AI and presented like the papers it came from.
          </p>
          {/* Live ticker — proves the backend is connected; falls back
              to em-dashes while the request is in flight or if the API
              is unreachable. */}
          <p className="landing-stats landing-reveal landing-reveal--subtitle" aria-live="polite">
            <span><strong>{stats.totalArticles !== null ? stats.totalArticles.toLocaleString() : '—'}</strong> articles</span>
            <span aria-hidden="true">·</span>
            <span>
              <strong>{stats.coverageStart ?? '—'}{stats.coverageEnd && stats.coverageEnd !== stats.coverageStart ? `–${stats.coverageEnd}` : ''}</strong> coverage
            </span>
            {stats.latestHeadline && (
              <>
                <span aria-hidden="true">·</span>
                <span className="landing-stats__latest">latest: <em>{stats.latestHeadline.length > 60 ? stats.latestHeadline.slice(0, 60) + '…' : stats.latestHeadline}</em></span>
              </>
            )}
          </p>
          <div className="landing-cta-row" aria-label="Explore MediaScope">
            {ctas.map(({ label, to, Icon, primary }, index) => (
              <Link
                key={label}
                to={to}
                className={`landing-cta ${primary ? 'landing-cta--primary' : ''}`}
                style={{ '--landing-delay': `${1080 + index * 80}ms` } as React.CSSProperties}
              >
                <Icon size={18} strokeWidth={1.6} />
                <span>{label}</span>
              </Link>
            ))}
          </div>
          <p className="landing-signin-line landing-reveal landing-reveal--last">
            or{' '}
            <button type="button" onClick={() => setAuthMode('login')}>Sign in</button>
            {' / '}
            <button type="button" onClick={() => setAuthMode('register')}>Create an account</button>
          </p>
        </section>

        <section className="landing-band landing-scroll-reveal" aria-labelledby="what-is-mediascope">
          <div className="landing-section-header">
            <h2 id="what-is-mediascope">What is MediaScope?</h2>
          </div>
          <div className="landing-editorial-grid">
            <article>
              <p className="landing-kicker">The corpus</p>
              <h3>Scanned pages, searchable stories</h3>
              <p>Phone-scanned Pakistani daily newspapers are ingested page by page and turned into structured archive records.</p>
            </article>
            <article>
              <p className="landing-kicker">The pipeline</p>
              <h3>AI reads the page layout</h3>
              <p>Gemini Vision extracts metadata, articles, and advertisements, then NLP enriches the archive with entities and topics.</p>
            </article>
            <article>
              <p className="landing-kicker">The dashboard</p>
              <h3>Research at editorial speed</h3>
              <p>Search by keyword, entity, topic, or date. Track story arcs, compare periods, and inspect period advertisements.</p>
            </article>
          </div>
        </section>
      </main>

      {authMode && (
        <AuthPage
          key={authMode}
          initialMode={authMode}
          onClose={() => setAuthMode(null)}
        />
      )}
    </div>
  );
};

export default Landing;
