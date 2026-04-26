import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  BookmarkCheck,
  Bookmark as BookmarkIcon,
  Tag as TagIcon,
  FolderOpen,
  Trash2,
  Pencil,
} from 'lucide-react';
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

  const sentimentChip = (label: string) => {
    if (label === 'positive') return 'chip chip--positive';
    if (label === 'negative') return 'chip chip--negative';
    return 'chip';
  };

  if (loading) {
    return (
      <div className="bookmarks-panel">
        <div className="stack" aria-busy="true">
          <div className="skeleton skeleton-line" style={{ width: '30%' }} />
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-block" />
        </div>
      </div>
    );
  }

  const isCollectionActive = (name: string) =>
    filter.kind === 'collection' && filter.name === name;
  const isTagActive = (name: string) => filter.kind === 'tag' && filter.name === name;

  return (
    <div className="bookmarks-panel">
      <div className="section-header">
        <div>
          <h2 style={{ margin: 0 }}>My bookmarks</h2>
          <p className="stat-sub" style={{ marginTop: '4px' }}>
            {filteredBookmarks.length} of {bookmarks.length} saved article{bookmarks.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {(collections.length > 0 || tags.length > 0) && (
        <div className="card card--inset bookmarks-filterbar">
          <div className="cluster">
            <span className="section-eyebrow" style={{ margin: 0 }}>Collections</span>
            <button
              type="button"
              onClick={() => setFilter({ kind: 'all' })}
              className={`chip bookmarks-chip ${filter.kind === 'all' ? 'is-active' : ''}`}
            >
              All <span className="bookmarks-chip__count">{bookmarks.length}</span>
            </button>
            {collections.map(c => (
              <button
                key={c.name}
                type="button"
                onClick={() => setFilter({ kind: 'collection', name: c.name })}
                className={`chip bookmarks-chip ${isCollectionActive(c.name) ? 'is-active' : ''}`}
              >
                <FolderOpen size={12} /> {c.name} <span className="bookmarks-chip__count">{c.count}</span>
              </button>
            ))}
          </div>
          {tags.length > 0 && (
            <div className="cluster">
              <span className="section-eyebrow" style={{ margin: 0 }}>Tags</span>
              {tags.map(t => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setFilter({ kind: 'tag', name: t.name })}
                  className={`chip bookmarks-chip ${isTagActive(t.name) ? 'is-active' : ''}`}
                >
                  <TagIcon size={12} /> {t.name} <span className="bookmarks-chip__count">{t.count}</span>
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
            icon={<BookmarkIcon size={32} />}
            title="No bookmarks yet"
            description="Save articles to revisit them later — bookmarks let you build collections and tag what matters."
          />
        ) : (
          <EmptyState
            icon={<BookmarkCheck size={32} />}
            title="Nothing matches this filter"
            description="Try a different collection or tag, or clear the filter to see everything you've saved."
            action={{ label: 'Show all bookmarks', onClick: () => setFilter({ kind: 'all' }) }}
          />
        )
      ) : (
        <div className="stack stack--tight">
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

                  <div className="cluster" style={{ marginTop: '4px' }}>
                    {bookmark.article_date && (
                      <span className="bookmark-meta">{bookmark.article_date}</span>
                    )}
                    <span className={sentimentChip(bookmark.article_sentiment)}>
                      {bookmark.article_sentiment}
                    </span>
                    {bookmark.article_topic && (
                      <span className="chip">
                        {bookmark.article_topic.replace(/_/g, ' ').slice(0, 30)}
                      </span>
                    )}
                    {bookmark.collection && (
                      <span className="chip chip--accent">
                        <FolderOpen size={12} /> {bookmark.collection}
                      </span>
                    )}
                  </div>

                  {bookmark.tags && bookmark.tags.length > 0 && (
                    <div className="cluster" style={{ marginTop: 'var(--space-2)' }}>
                      {bookmark.tags.map(tag => (
                        <span key={tag} className="chip">
                          <TagIcon size={11} /> {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {!isEditing && bookmark.note && (
                    <p className="bookmark-note">{bookmark.note}</p>
                  )}

                  {isEditing && (
                    <div
                      onClick={e => e.stopPropagation()}
                      className="card card--inset bookmark-edit"
                    >
                      <label className="bookmark-edit__field">
                        <span className="bookmark-edit__label">Collection</span>
                        <input
                          type="text"
                          list="bookmark-collections"
                          value={editCollection}
                          onChange={e => setEditCollection(e.target.value)}
                          placeholder="e.g. Research, Reading list"
                          className="bookmark-edit__input"
                        />
                      </label>
                      <label className="bookmark-edit__field">
                        <span className="bookmark-edit__label">Tags (comma-separated)</span>
                        <input
                          type="text"
                          value={editTags}
                          onChange={e => setEditTags(e.target.value)}
                          placeholder="e.g. economy, politics"
                          className="bookmark-edit__input"
                        />
                      </label>
                      <label className="bookmark-edit__field">
                        <span className="bookmark-edit__label">Note</span>
                        <textarea
                          value={editNote}
                          onChange={e => setEditNote(e.target.value)}
                          rows={3}
                          className="bookmark-edit__input bookmark-edit__textarea"
                        />
                      </label>
                      <div className="cluster" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={saving}
                          className="btn btn--ghost btn--sm"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={e => saveEdit(bookmark.id, e)}
                          disabled={saving}
                          className="btn btn--primary btn--sm"
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {!isEditing && (
                  <div className="bookmark-actions">
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={e => startEdit(bookmark, e)}
                      aria-label="Edit bookmark"
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      className="btn btn--ghost btn--sm bookmark-actions__remove"
                      onClick={e => removeBookmark(bookmark.id, e)}
                      disabled={removing === bookmark.id}
                      aria-label="Remove bookmark"
                    >
                      <Trash2 size={14} />
                      {removing === bookmark.id ? '…' : 'Remove'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BookmarksPanel;
