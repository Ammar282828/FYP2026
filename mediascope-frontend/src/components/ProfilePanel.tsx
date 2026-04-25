/**
 * ProfilePanel — the "You" landing page.
 *
 * Three sub-tabs:
 *   Overview  — name/email card + at-a-glance stats (bookmarks, history)
 *   Bookmarks — wraps the existing BookmarksPanel
 *   History   — recently-viewed articles (localStorage, see useViewHistory)
 *
 * Why this exists
 * ---------------
 * Before, "You" only meant Bookmarks. View history had nowhere to live, the
 * user's profile info was hidden behind the avatar dropdown, and there was
 * no single page to land on after clicking the avatar. ProfilePanel is the
 * one-stop view.
 *
 * The bookmarks sub-tab intentionally re-uses BookmarksPanel verbatim — no
 * duplication of the bookmark CRUD flow.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BookmarksPanel from './BookmarksPanel';
import EmptyState from './ui/EmptyState';
import {
  useViewHistory,
  clearHistory,
  removeFromHistory,
  HistoryEntry,
} from '../hooks/useViewHistory';

type SubTab = 'overview' | 'bookmarks' | 'history';

interface ProfilePanelProps {
  // Optional initial sub-tab (e.g. when arriving via "g b" shortcut we
  // can land directly on bookmarks).
  initialSubTab?: SubTab;
  onShowAuth?: () => void;
}

const sentimentColor: Record<string, string> = {
  positive: 'var(--positive)',
  negative: 'var(--negative)',
  neutral:  'var(--text-tertiary)',
};

const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const HistoryRow: React.FC<{ entry: HistoryEntry; onOpen: () => void }> = ({ entry, onOpen }) => (
  <div className="bookmark-card" onClick={onOpen} style={{ cursor: 'pointer' }}>
    <div className="bookmark-info">
      <div className="bookmark-headline">{entry.headline}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
        {entry.date && <span className="bookmark-meta">{entry.date.slice(0, 10)}</span>}
        {entry.sentiment && (
          <span
            className="sentiment-badge"
            style={{
              background: sentimentColor[entry.sentiment] || 'var(--text-tertiary)',
              fontSize: '0.7rem',
              padding: '2px 8px',
            }}
          >
            {entry.sentiment}
          </span>
        )}
        {entry.topic && (
          <span className="topic-badge" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
            {entry.topic.replace(/_/g, ' ').slice(0, 30)}
          </span>
        )}
        <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
          viewed {formatRelative(entry.viewedAt)}
        </span>
      </div>
    </div>
    <button
      className="bookmark-remove-btn"
      onClick={e => { e.stopPropagation(); removeFromHistory(entry.id); }}
      title="Remove from history"
    >
      Remove
    </button>
  </div>
);

const StatCard: React.FC<{ label: string; value: string | number; hint?: string }> = ({ label, value, hint }) => (
  <div
    style={{
      flex: '1 1 160px',
      minWidth: 160,
      padding: '14px 16px',
      borderRadius: 8,
      border: '1px solid var(--border-color)',
      background: 'var(--bg-secondary)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}
  >
    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)' }}>
      {label}
    </div>
    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
    {hint && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{hint}</div>}
  </div>
);

const ProfilePanel: React.FC<ProfilePanelProps> = ({ initialSubTab = 'overview', onShowAuth }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const history = useViewHistory();
  const [sub, setSub] = useState<SubTab>(initialSubTab);

  const initials = useMemo(() => {
    if (!user) return '';
    return user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }, [user]);

  if (!user) {
    return (
      <div style={{ padding: '2rem' }}>
        <EmptyState
          icon={'\u25CB'}
          title="Sign in to see your profile"
          description="Bookmarks, view history and personalised recommendations all live here once you're signed in."
          action={onShowAuth ? { label: 'Sign in', onClick: onShowAuth } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="profile-panel" style={{ padding: '0 0 2rem 0' }}>
      {/* Identity card */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '20px 24px',
          borderRadius: 12,
          border: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          marginBottom: 16,
        }}
      >
        <div
          className="user-avatar"
          style={{
            background: user.avatar_color || 'var(--primary-color)',
            width: 56,
            height: 56,
            fontSize: 20,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            borderRadius: '50%',
            fontWeight: 600,
          }}
        >
          {initials}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {user.name}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{user.email}</div>
        </div>
      </div>

      {/* Sub-tab nav — visually matches the analytics sub-nav */}
      <div className="analytics-subnav" role="tablist" aria-label="Profile sections" style={{ marginBottom: 16 }}>
        {([
          { id: 'overview',  label: 'Overview' },
          { id: 'bookmarks', label: `Bookmarks${user.bookmark_count ? ` (${user.bookmark_count})` : ''}` },
          { id: 'history',   label: `History${history.length ? ` (${history.length})` : ''}` },
        ] as const).map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={sub === t.id}
            className={`analytics-subnav-btn ${sub === t.id ? 'active' : ''}`}
            onClick={() => setSub(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <StatCard label="Bookmarks" value={user.bookmark_count ?? 0}
              hint={user.bookmark_count ? 'Saved articles' : 'Star any article to start saving'} />
            <StatCard label="Recently viewed" value={history.length}
              hint={history.length ? 'On this device' : 'Open an article to start tracking'} />
            <StatCard label="Last visit" value={history[0] ? formatRelative(history[0].viewedAt) : '—'}
              hint={history[0] ? history[0].headline.slice(0, 36) + (history[0].headline.length > 36 ? '\u2026' : '') : ''} />
          </div>

          {history.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Recently viewed</h3>
                <button
                  onClick={() => setSub('history')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--primary-color)',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                  }}
                >
                  See all \u2192
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.slice(0, 5).map(entry => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    onOpen={() => navigate(`/article/${entry.id}`)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {sub === 'bookmarks' && <BookmarksPanel />}

      {sub === 'history' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ margin: 0 }}>View History</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 4 }}>
                {history.length} article{history.length === 1 ? '' : 's'} viewed on this device
              </p>
            </div>
            {history.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm('Clear your view history? Bookmarks are not affected.')) {
                    clearHistory();
                  }
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                Clear history
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <EmptyState
              icon={'\u23F1'}
              title="No history yet"
              description="Articles you open will show up here so you can find them again later. History is stored on this device only."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map(entry => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  onOpen={() => navigate(`/article/${entry.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProfilePanel;
