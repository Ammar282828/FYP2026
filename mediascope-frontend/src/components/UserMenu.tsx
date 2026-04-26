import React, { useState, useRef, useEffect } from 'react';
import { User, Bookmark, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface UserMenuProps {
  onShowBookmarks: () => void;
  onShowAuth: () => void;
  // Optional — when present the dropdown surfaces a "Profile" entry above
  // Bookmarks. Older callers that only have one destination can leave it
  // off and the menu collapses gracefully.
  onShowProfile?: () => void;
}

const UserMenu: React.FC<UserMenuProps> = ({ onShowBookmarks, onShowAuth, onShowProfile }) => {
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
      <button className="btn btn--primary btn--sm" onClick={onShowAuth}>
        Sign in
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
        className={`btn btn--ghost user-menu__trigger ${open ? 'is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="user-avatar"
          style={{ background: user.avatar_color || 'var(--primary-color)' }}
        >
          {initials}
        </span>
        <span>{user.name.split(' ')[0]}</span>
      </button>

      {open && (
        <div className="user-dropdown" role="menu">
          {/* User info */}
          <div className="user-dropdown__header">
            <div className="user-dropdown__name">{user.name}</div>
            <div className="user-dropdown__email">{user.email}</div>
          </div>

          {/* Menu items */}
          <div className="user-dropdown__group">
            {onShowProfile && (
              <button className="menu-item" onClick={() => { onShowProfile(); setOpen(false); }}>
                <User size={14} />
                Profile
              </button>
            )}
            <button className="menu-item" onClick={() => { onShowBookmarks(); setOpen(false); }}>
              <Bookmark size={14} />
              My bookmarks
              {user.bookmark_count > 0 && (
                <span className="menu-item__count">{user.bookmark_count}</span>
              )}
            </button>
          </div>

          {/* Logout */}
          <div className="user-dropdown__group user-dropdown__group--top-border">
            <button
              className="menu-item menu-item--danger"
              onClick={() => { logout(); setOpen(false); }}
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
