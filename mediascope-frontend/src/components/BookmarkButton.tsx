import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';
import { useAuth } from '../contexts/AuthContext';

interface BookmarkButtonProps {
  articleId: string;
  size?: 'small' | 'normal';
  onAuthRequired?: () => void;
}

const BookmarkButton: React.FC<BookmarkButtonProps> = ({ articleId, size = 'small', onAuthRequired }) => {
  const { user, updateUser } = useAuth();
  const [bookmarked, setBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bookmarkId, setBookmarkId] = useState<string | null>(null);

  useEffect(() => {
    if (user && articleId) {
      checkBookmark();
    } else {
      setBookmarked(false);
      setBookmarkId(null);
    }
  }, [user, articleId]);

  const checkBookmark = async () => {
    try {
      const res = await axios.get(`${API_BASE}/bookmarks/check/${articleId}`);
      setBookmarked(res.data.bookmarked);
      setBookmarkId(res.data.bookmark_id);
    } catch {
      // Silently fail
    }
  };

  const toggleBookmark = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }

    if (!user) {
      if (onAuthRequired) onAuthRequired();
      return;
    }

    setLoading(true);
    try {
      if (bookmarked && bookmarkId) {
        await axios.delete(`${API_BASE}/bookmarks/${bookmarkId}`);
        setBookmarked(false);
        setBookmarkId(null);
        updateUser({ bookmark_count: Math.max(0, (user.bookmark_count || 0) - 1) });
      } else {
        const res = await axios.post(`${API_BASE}/bookmarks/`, { article_id: articleId });
        setBookmarked(true);
        setBookmarkId(res.data.id);
        updateUser({ bookmark_count: (user.bookmark_count || 0) + 1 });
      }
    } catch (err: any) {
      const msg = err.response?.data?.detail;
      if (msg === 'Article already bookmarked') {
        setBookmarked(true);
      }
    } finally {
      setLoading(false);
    }
  };

  // Listen for the global `b` shortcut. Only one BookmarkButton is on
  // screen at a time (article detail page), so a single window listener
  // is unambiguous.
  useEffect(() => {
    const handler = () => { toggleBookmark(); };
    window.addEventListener('mediascope:toggle-bookmark', handler);
    return () => window.removeEventListener('mediascope:toggle-bookmark', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarked, bookmarkId, user]);

  const isSmall = size === 'small';

  return (
    <button
      className={`bookmark-btn ${bookmarked ? 'bookmarked' : ''} ${isSmall ? 'small' : ''}`}
      onClick={toggleBookmark}
      disabled={loading}
      title={bookmarked ? 'Remove bookmark' : (user ? 'Bookmark this article' : 'Sign in to bookmark')}
      style={loading ? { cursor: 'not-allowed', opacity: 0.5 } : undefined}
    >
      <span>{bookmarked ? '\u2605' : '\u2606'}</span>
      {!isSmall && (
        <span style={{ fontSize: '0.85rem', marginLeft: '4px' }}>
          {loading ? '...' : (bookmarked ? 'Bookmarked' : 'Bookmark')}
        </span>
      )}
    </button>
  );
};

export default BookmarkButton;
