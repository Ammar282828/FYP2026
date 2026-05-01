import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { BarChart3, BookOpenText, MessageSquareText, Newspaper, Search } from 'lucide-react';
import AuthPage from './AuthPage';
import { useAuth } from '../contexts/AuthContext';
import './Landing.css';

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

const Landing: React.FC = () => {
  const { user, loading } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const title = useTypewriter('MediaScope', 11);

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
