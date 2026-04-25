import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Calendar, FileText, Newspaper } from 'lucide-react';
import { API_BASE } from '../config';
import { useToast } from './ui/Toast';
import EmptyState from './ui/EmptyState';

interface Article {
  id: string;
  headline: string;
  content: string;
  publication_date: string;
  sentiment_label?: string;
  sentiment_score?: number;
  topic_label?: string;
  word_count?: number;
  entities?: Array<{ text: string; type: string }>;
}

interface Props {
  initialLeftId?: string;
  initialRightId?: string;
  onClose?: () => void;
}

const panelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md, 8px)',
  background: 'var(--bg-secondary)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const metaRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  fontSize: 12,
  color: 'var(--text-secondary)',
};

const badge = (bg: string, color = 'white'): React.CSSProperties => ({
  background: bg,
  color,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
});

const ArticleComparison: React.FC<Props> = ({ initialLeftId, initialRightId, onClose }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [leftId, setLeftId] = useState<string | null>(initialLeftId || null);
  const [rightId, setRightId] = useState<string | null>(initialRightId || null);
  const [left, setLeft] = useState<Article | null>(null);
  const [right, setRight] = useState<Article | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Article[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [pickerSide, setPickerSide] = useState<'left' | 'right' | null>(null);
  // Debounce + race-guard: only the most recent in-flight request gets to
  // write into state, so a slow earlier call can't overwrite fresher results.
  const searchSeqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadArticle = useCallback(async (id: string): Promise<Article | null> => {
    try {
      const resp = await axios.get(`${API_BASE}/articles/${id}/full`);
      return resp.data.article || resp.data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!leftId) { setLeft(null); return; }
    setLoading(true);
    loadArticle(leftId).then(a => { setLeft(a); setLoading(false); });
  }, [leftId, loadArticle]);

  useEffect(() => {
    if (!rightId) { setRight(null); return; }
    setLoading(true);
    loadArticle(rightId).then(a => { setRight(a); setLoading(false); });
  }, [rightId, loadArticle]);

  // Filter out the article that's already pinned to the opposite slot —
  // comparing an article to itself isn't useful. Headline-substring filter
  // also lets us narrow client-side after the API responds.
  const otherId = pickerSide === 'left' ? rightId : leftId;
  const visibleResults = searchResults.filter(a => a.id !== otherId);

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    try {
      const resp = await axios.post(`${API_BASE}/search/keyword`, { keyword: q, limit: 12 });
      // Only commit if this is still the latest request.
      if (seq !== searchSeqRef.current) return;
      setSearchResults(resp.data.articles || resp.data.results || []);
      setHighlightIdx(0);
    } catch (e) {
      if (seq === searchSeqRef.current) {
        toast('Search failed', 'error');
        setSearchResults([]);
      }
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }, [toast]);

  // Debounced search-as-you-type. 250ms feels responsive without being
  // chatty enough to thrash the keyword endpoint.
  useEffect(() => {
    if (!pickerSide) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(search), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, pickerSide, runSearch]);

  // Reset picker state on open/close so the modal always starts clean.
  useEffect(() => {
    if (pickerSide) {
      setSearch('');
      setSearchResults([]);
      setHighlightIdx(0);
      setSearching(false);
    }
  }, [pickerSide]);

  const pickArticle = (a: Article) => {
    if (pickerSide === 'left') setLeftId(a.id);
    else if (pickerSide === 'right') setRightId(a.id);
    setPickerSide(null);
    setSearch('');
    setSearchResults([]);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, Math.max(visibleResults.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = visibleResults[highlightIdx];
      if (pick) pickArticle(pick);
    } else if (e.key === 'Escape') {
      setPickerSide(null);
    }
  };

  // Compute shared entities
  const sharedEntities: string[] = [];
  if (left?.entities && right?.entities) {
    const rightSet = new Set(right.entities.map(e => e.text.toLowerCase()));
    for (const e of left.entities) {
      if (rightSet.has(e.text.toLowerCase()) && !sharedEntities.includes(e.text)) {
        sharedEntities.push(e.text);
      }
    }
  }

  const formatDate = (iso: string) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return iso.slice(0, 10); }
  };

  const sentimentColor = (label?: string) => {
    if (label === 'positive') return 'var(--positive, #22c55e)';
    if (label === 'negative') return 'var(--negative, #ef4444)';
    return 'var(--neutral-color, #9ca3af)';
  };

  const renderArticleSlot = (
    article: Article | null,
    id: string | null,
    side: 'left' | 'right',
    label: string,
  ) => {
    return (
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setPickerSide(side)}
              style={{
                padding: '4px 10px', fontSize: 12, background: 'var(--primary-color)',
                color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer',
              }}
            >
              {article ? 'Change' : 'Pick article'}
            </button>
            {article && (
              <button
                onClick={() => side === 'left' ? setLeftId(null) : setRightId(null)}
                style={{
                  padding: '4px 10px', fontSize: 12, background: 'var(--bg-primary)',
                  color: 'var(--text-primary)', border: '1px solid var(--border-color)',
                  borderRadius: 4, cursor: 'pointer',
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {!article && !id && (
          <EmptyState
            icon={<Newspaper size={28} strokeWidth={1.5} />}
            title="No article selected"
            description='Pick an article from the list above to compare it side-by-side with another.'
          />
        )}
        {id && !article && <div style={{ padding: 20 }}>Loading…</div>}

        {article && (
          <>
            <h3 style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>{article.headline}</h3>
            <div style={metaRow}>
              <span><Calendar size={12} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 4 }} />{formatDate(article.publication_date)}</span>
              {article.word_count != null && <span><FileText size={12} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 4 }} />{article.word_count} words</span>}
              {article.topic_label && <span style={badge('var(--accent-color, #6366f1)')}>{article.topic_label}</span>}
              {article.sentiment_label && (
                <span style={badge(sentimentColor(article.sentiment_label))}>
                  {article.sentiment_label}
                  {article.sentiment_score != null && ` (${article.sentiment_score.toFixed(2)})`}
                </span>
              )}
            </div>
            {article.entities && article.entities.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {article.entities.slice(0, 10).map((e, i) => {
                  const isShared = sharedEntities.some(s => s.toLowerCase() === e.text.toLowerCase());
                  return (
                    <span
                      key={i}
                      style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        background: isShared ? 'var(--primary-color)' : 'var(--bg-primary)',
                        color: isShared ? 'white' : 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        fontWeight: isShared ? 600 : 400,
                      }}
                      title={isShared ? 'Also mentioned in the other article' : e.type}
                    >
                      {e.text}
                    </span>
                  );
                })}
              </div>
            )}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                fontSize: 14,
                lineHeight: 1.65,
                color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
                borderTop: '1px solid var(--border-color)',
                paddingTop: 12,
                maxHeight: 500,
              }}
            >
              {article.content}
            </div>
            <button
              onClick={() => navigate(`/article/${article.id}`)}
              style={{
                alignSelf: 'flex-start',
                padding: '6px 12px', fontSize: 12,
                background: 'transparent', color: 'var(--primary-color)',
                border: '1px solid var(--primary-color)', borderRadius: 4, cursor: 'pointer',
              }}
            >
              Open full article →
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Compare Articles</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Pick two articles to view side-by-side. Shared entities are highlighted.
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{ padding: '6px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 4, cursor: 'pointer' }}
          >
            Close
          </button>
        )}
      </div>

      {left && right && sharedEntities.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)', padding: 10, borderRadius: 6,
          marginBottom: 12, fontSize: 13, border: '1px solid var(--border-color)',
        }}>
          <strong>Shared entities ({sharedEntities.length}):</strong>{' '}
          {sharedEntities.slice(0, 15).map((s, i) => (
            <span key={i} style={{ ...badge('var(--primary-color)'), marginRight: 4 }}>{s}</span>
          ))}
        </div>
      )}

      <div style={{
        display: 'flex', gap: 16, alignItems: 'stretch',
        flexDirection: loading ? 'row' : 'row',
      }}>
        {renderArticleSlot(left, leftId, 'left', 'Article A')}
        {renderArticleSlot(right, rightId, 'right', 'Article B')}
      </div>

      {pickerSide && (
        <div
          onClick={() => setPickerSide(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000,
            paddingTop: '10vh',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-primary)', borderRadius: 10,
              width: 'min(640px, 92vw)', maxHeight: '78vh',
              border: '1px solid var(--border-color)',
              boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
            role="dialog"
            aria-label={`Pick article for ${pickerSide === 'left' ? 'Article A' : 'Article B'}`}
          >
            <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>
                  Pick article for {pickerSide === 'left' ? 'Article A' : 'Article B'}
                </h3>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {searching
                    ? 'Searching\u2026'
                    : visibleResults.length > 0
                      ? `${visibleResults.length} suggestion${visibleResults.length === 1 ? '' : 's'}`
                      : ''}
                </span>
              </div>
              {/* The combobox: real autocomplete, no "Search" button needed.
                  ARIA roles match the combobox/listbox pattern so screen
                  readers and keyboard-only users get a sensible experience. */}
              <div role="combobox" aria-expanded={visibleResults.length > 0} aria-haspopup="listbox">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Type a keyword, headline, or topic\u2026"
                  autoFocus
                  aria-autocomplete="list"
                  aria-controls="comparison-picker-list"
                  aria-activedescendant={
                    visibleResults[highlightIdx]
                      ? `comparison-picker-opt-${visibleResults[highlightIdx].id}`
                      : undefined
                  }
                  style={{
                    width: '100%',
                    padding: '10px 12px', borderRadius: 6,
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                    fontSize: 14, outline: 'none',
                  }}
                />
              </div>
            </div>

            <div
              id="comparison-picker-list"
              role="listbox"
              style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}
            >
              {!search && (
                <div style={{ padding: '16px 18px', color: 'var(--text-tertiary)', fontSize: 13 }}>
                  Start typing to search the archive.
                </div>
              )}

              {search && !searching && visibleResults.length === 0 && (
                <div style={{ padding: '16px 18px', color: 'var(--text-tertiary)', fontSize: 13 }}>
                  No matches for "{search}".
                </div>
              )}

              {visibleResults.map((a, i) => {
                const isActive = i === highlightIdx;
                return (
                  <div
                    id={`comparison-picker-opt-${a.id}`}
                    key={a.id}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setHighlightIdx(i)}
                    onMouseDown={(e) => e.preventDefault() /* keep focus in input */}
                    onClick={() => pickArticle(a)}
                    style={{
                      padding: '10px 16px',
                      cursor: 'pointer',
                      borderLeft: isActive ? '3px solid var(--primary-color)' : '3px solid transparent',
                      background: isActive ? 'var(--bg-secondary)' : 'transparent',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                      {a.headline}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span>{formatDate(a.publication_date)}</span>
                      {a.topic_label && <span>{'\u2022'} {a.topic_label}</span>}
                      {a.sentiment_label && (
                        <span style={{ ...badge(sentimentColor(a.sentiment_label)), padding: '1px 6px', fontSize: 10 }}>
                          {a.sentiment_label}
                        </span>
                      )}
                      {otherId && a.id === otherId && (
                        <span style={{ color: 'var(--text-tertiary)' }}>(already picked)</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{
              padding: '8px 16px', borderTop: '1px solid var(--border-color)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 11, color: 'var(--text-tertiary)',
            }}>
              <span>
                <kbd style={{ fontFamily: 'monospace' }}>{'\u2191'}</kbd>
                <kbd style={{ fontFamily: 'monospace', marginLeft: 4 }}>{'\u2193'}</kbd> navigate {'\u2003'}
                <kbd style={{ fontFamily: 'monospace' }}>{'\u21B5'}</kbd> select {'\u2003'}
                <kbd style={{ fontFamily: 'monospace' }}>esc</kbd> close
              </span>
              <button
                onClick={() => setPickerSide(null)}
                style={{ padding: '4px 10px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArticleComparison;
