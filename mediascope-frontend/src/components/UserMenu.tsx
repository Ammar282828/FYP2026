import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface UserMenuProps {
  onShowBookmarks: () => void;
  onShowAuth: () => void;
}

const UserMenu: React.FC<UserMenuProps> = ({ onShowBookmarks, onShowAuth }) => {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!user) {
    return (
      <button className="auth-submit-btn" onClick={onShowAuth}
        style={{ padding: '6px 16px', width: 'auto', fontSize: '0.8rem' }}>
        Sign In
      </button>
    );
  }

  const initials = user.name
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div ref={menuRef} className="user-menu">
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 12px 4px 4px',
          background: open ? 'var(--bg-tertiary)' : 'transparent',
          border: '1px solid var(--border-color)',
          borderRadius: '24px',
          cursor: 'pointer',
          transition: 'background 0.2s'
        }}
      >
        <div className="user-avatar" style={{
          background: user.avatar_color || 'var(--primary-color)',
          width: '32px',
          height: '32px',
          border: 'none'
        }}>
          {initials}
        </div>
        <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)' }}>
          {user.name.split(' ')[0]}
        </span>
      </button>

      {open && (
        <div className="user-dropdown">
          {/* User info */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
              {user.name}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              {user.email}
            </div>
          </div>

          {/* Menu items */}
          <div style={{ padding: '4px 0' }}>
            <button onClick={() => { onShowBookmarks(); setOpen(false); }}>
              {'\u2605'} My Bookmarks
              {user.bookmark_count > 0 && (
                <span style={{
                  marginLeft: 'auto',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '10px',
                  float: 'right'
                }}>
                  {user.bookmark_count}
                </span>
              )}
            </button>
          </div>

          {/* Logout */}
          <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <button
              onClick={() => { logout(); setOpen(false); }}
              style={{ color: 'var(--danger-color)' }}
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
