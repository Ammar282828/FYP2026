import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './ui/Toast';
import EmptyState from './ui/EmptyState';

interface Bookmark {
  id: string;
  article_id: string;
  article_headline: string;
  article_date: string;
  article_sentiment: string;
  article_topic: string;
  note: string;
  tags?: string[];
  collection?: string;
  created_at: string;
}

interface CollectionInfo {
  name: string;
  count: number;
}

interface TagInfo {
  name: string;
  count: number;
}

type FilterState =
  | { kind: 'all' }
  | { kind: 'collection'; name: string }
  | { kind: 'tag'; name: string };

const chipBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontSize: '0.78rem',
  cursor: 'pointer',
  userSelect: 'none',
};

const chipActive: React.CSSProperties = {
  background: 'var(--primary-color)',
  color: '#fff',
  borderColor: 'var(--primary-color)',
};

const BookmarksPanel: React.FC = () => {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>({ kind: 'all' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCollection, setEditCollection] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [bRes, cRes] = await Promise.all([
        axios.get(`${API_BASE}/bookmarks/`),
        axios.get(`${API_BASE}/bookmarks/collections`).catch(() => ({ data: { collections: [], tags: [] } })),
      ]);
      setBookmarks(bRes.data.bookmarks || []);
      setCollections(cRes.data.collections || []);
      setTags(cRes.data.tags || []);
    } catch (err) {
      console.error('Failed to load bookmarks:', err);
    } finally {
      setLoading(false);
    }
  };

  const removeBookmark = async (bookmarkId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRemoving(bookmarkId);
    try {
      await axios.delete(`${API_BASE}/bookmarks/${bookmarkId}`);
      setBookmarks(prev => prev.filter(b => b.id !== bookmarkId));
      if (user) {
        updateUser({ bookmark_count: Math.max(0, (user.bookmark_count || 0) - 1) });
      }
      toast('Bookmark removed', 'success');
    } catch (err) {
      console.error('Failed to remove bookmark:', err);
      toast('Failed to remove bookmark', 'error');
    } finally {
      setRemoving(null);
    }
  };

  const startEdit = (bookmark: Bookmark, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(bookmark.id);
    setEditCollection(bookmark.collection || '');
    setEditTags((bookmark.tags || []).join(', '));
    setEditNote(bookmark.note || '');
  };

  const cancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const saveEdit = async (bookmarkId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSaving(true);
    try {
      const parsedTags = editTags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
      await axios.patch(`${API_BASE}/bookmarks/${bookmarkId}`, {
        collection: editCollection.trim() || null,
        tags: parsedTags,
        note: editNote,
      });
      toast('Bookmark updated', 'success');
      setEditingId(null);
      await loadAll();
    } catch (err) {
      console.error('Failed to update bookmark:', err);
      toast('Failed to update bookmark', 'error');
    } finally {
      setSaving(false);
    }
  };

  const filteredBookmarks = useMemo(() => {
    if (filter.kind === 'all') return bookmarks;
    if (filter.kind === 'collection') {
      return bookmarks.filter(b => (b.collection || '') === filter.name);
    }
    return bookmarks.filter(b => (b.tags || []).includes(filter.name));
  }, [bookmarks, filter]);

  const sentimentColor: Record<string, string> = {
    positive: 'var(--positive)',
    negative: 'var(--negative)',
    neutral: 'var(--text-tertiary)',
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-tertiary)' }}>Loading bookmarks...</p>
      </div>
    );
  }

  const isCollectionActive = (name: string) =>
    filter.kind === 'collection' && filter.name === name;
  const isTagActive = (name: string) => filter.kind === 'tag' && filter.name === name;

  return (
    <div className="bookmarks-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <h2>My Bookmarks</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
            {filteredBookmarks.length} of {bookmarks.length} saved article{bookmarks.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {(collections.length > 0 || tags.length > 0) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginBottom: '1.25rem',
            padding: '10px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Collections
            </span>
            <button
              type="button"
              onClick={() => setFilter({ kind: 'all' })}
              style={{ ...chipBase, ...(filter.kind === 'all' ? chipActive : {}) }}
            >
              All <span style={{ opacity: 0.7 }}>({bookmarks.length})</span>
            </button>
            {collections.map(c => (
              <button
                key={c.name}
                type="button"
                onClick={() => setFilter({ kind: 'collection', name: c.name })}
                style={{ ...chipBase, ...(isCollectionActive(c.name) ? chipActive : {}) }}
              >
                {c.name} <span style={{ opacity: 0.7 }}>({c.count})</span>
              </button>
            ))}
          </div>
          {tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Tags
              </span>
              {tags.map(t => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setFilter({ kind: 'tag', name: t.name })}
                  style={{ ...chipBase, ...(isTagActive(t.name) ? chipActive : {}) }}
                >
                  #{t.name} <span style={{ opacity: 0.7 }}>({t.count})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <datalist id="bookmark-collections">
        {collections.map(c => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>

      {filteredBookmarks.length === 0 ? (
        bookmarks.length === 0 ? (
          <EmptyState
            icon={'\u2B50'}
            title="No bookmarks yet"
            description="Click the bookmark button on any article to save it here for later."
          />
        ) : (
          <EmptyState
            icon={'\uD83D\uDD0D'}
            title="No bookmarks match this filter"
            description="Try selecting a different collection or tag to find what you saved."
            action={{ label: 'Show all bookmarks', onClick: () => setFilter({ kind: 'all' }) }}
          />
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {filteredBookmarks.map(bookmark => {
            const isEditing = editingId === bookmark.id;
            return (
              <div
                key={bookmark.id}
                className="bookmark-card"
                onClick={() => !isEditing && navigate(`/article/${bookmark.article_id}`)}
                style={isEditing ? { cursor: 'default' } : undefined}
              >
                <div className="bookmark-info">
                  <div className="bookmark-headline">{bookmark.article_headline}</div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' }}>
                    {bookmark.article_date && <span className="bookmark-meta">{bookmark.article_date}</span>}
                    <span
                      className="sentiment-badge"
                      style={{
                        background: sentimentColor[bookmark.article_sentiment] || 'var(--text-tertiary)',
                        fontSize: '0.7rem',
                        padding: '2px 8px',
                      }}
                    >
                      {bookmark.article_sentiment}
                    </span>
                    {bookmark.article_topic && (
                      <span className="topic-badge" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
                        {bookmark.article_topic.replace(/_/g, ' ').slice(0, 30)}
                      </span>
                    )}
                    {bookmark.collection && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--primary-color)',
                          color: '#fff',
                        }}
                      >
                        {'\u{1F4C1}'} {bookmark.collection}
                      </span>
                    )}
                  </div>

                  {bookmark.tags && bookmark.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                      {bookmark.tags.map(tag => (
                        <span
                          key={tag}
                          style={{
                            fontSize: '0.7rem',
                            padding: '1px 8px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                          }}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {!isEditing && bookmark.note && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '6px', fontStyle: 'italic' }}>
                      {bookmark.note}
                    </p>
                  )}

                  {isEditing && (
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{
                        marginTop: 10,
                        padding: 10,
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-secondary)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Collection
                        <input
                          type="text"
                          list="bookmark-collections"
                          value={editCollection}
                          onChange={e => setEditCollection(e.target.value)}
                          placeholder="e.g. Research, Reading List"
                          style={{
                            width: '100%',
                            marginTop: 2,
                            padding: '6px 8px',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--bg-primary, #fff)',
                            color: 'var(--text-primary)',
                            fontSize: '0.85rem',
                          }}
                        />
                      </label>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Tags (comma-separated)
                        <input
                          type="text"
                          value={editTags}
                          onChange={e => setEditTags(e.target.value)}
                          placeholder="e.g. economy, politics"
                          style={{
                            width: '100%',
                            marginTop: 2,
                            padding: '6px 8px',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--bg-primary, #fff)',
                            color: 'var(--text-primary)',
                            fontSize: '0.85rem',
                          }}
                        />
                      </label>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Note
                        <textarea
                          value={editNote}
                          onChange={e => setEditNote(e.target.value)}
                          rows={3}
                          style={{
                            width: '100%',
                            marginTop: 2,
                            padding: '6px 8px',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--bg-primary, #fff)',
                            color: 'var(--text-primary)',
                            fontSize: '0.85rem',
                            resize: 'vertical',
                          }}
                        />
                      </label>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={saving}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            background: 'transparent',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={e => saveEdit(bookmark.id, e)}
                          disabled={saving}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--primary-color)',
                            background: 'var(--primary-color)',
                            color: '#fff',
                            cursor: saving ? 'not-allowed' : 'pointer',
                            opacity: saving ? 0.6 : 1,
                            fontSize: '0.8rem',
                          }}
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  {!isEditing && (
                    <button
                      className="bookmark-remove-btn"
                      onClick={e => startEdit(bookmark, e)}
                      style={{ background: 'transparent', color: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
                    >
                      Edit
                    </button>
                  )}
                  {!isEditing && (
                    <button
                      className="bookmark-remove-btn"
                      onClick={e => removeBookmark(bookmark.id, e)}
                      disabled={removing === bookmark.id}
                      style={removing === bookmark.id ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                    >
                      {removing === bookmark.id ? '...' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BookmarksPanel;
