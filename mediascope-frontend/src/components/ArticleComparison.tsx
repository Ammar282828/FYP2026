import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { useToast } from './ui/Toast';

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
  const [pickerSide, setPickerSide] = useState<'left' | 'right' | null>(null);

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

  const runSearch = async () => {
    if (!search.trim()) return;
    try {
      const resp = await axios.post(`${API_BASE}/search/keyword`, { keyword: search, limit: 10 });
      setSearchResults(resp.data.articles || resp.data.results || []);
    } catch (e) {
      toast('Search failed', 'error');
    }
  };

  const pickArticle = (a: Article) => {
    if (pickerSide === 'left') setLeftId(a.id);
    else if (pickerSide === 'right') setRightId(a.id);
    setPickerSide(null);
    setSearch('');
    setSearchResults([]);
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
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📰</div>
            <div>No article selected</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>Click "Pick article" above</div>
          </div>
        )}
        {id && !article && <div style={{ padding: 20 }}>Loading…</div>}

        {article && (
          <>
            <h3 style={{ margin: 0, fontSize: 18, lineHeight: 1.3 }}>{article.headline}</h3>
            <div style={metaRow}>
              <span>📅 {formatDate(article.publication_date)}</span>
              {article.word_count != null && <span>📝 {article.word_count} words</span>}
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
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-primary)', padding: 20, borderRadius: 8,
              width: 'min(600px, 90vw)', maxHeight: '80vh', overflow: 'auto',
              border: '1px solid var(--border-color)',
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              Pick article for {pickerSide === 'left' ? 'Article A' : 'Article B'}
            </h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                placeholder="Search for an article by keyword..."
                autoFocus
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 4,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                }}
              />
              <button
                onClick={runSearch}
                style={{ padding: '8px 16px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                Search
              </button>
            </div>
            {searchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {searchResults.map((a) => (
                  <div
                    key={a.id}
                    onClick={() => pickArticle(a)}
                    style={{
                      padding: 10, border: '1px solid var(--border-color)',
                      borderRadius: 6, cursor: 'pointer',
                      background: 'var(--bg-secondary)',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{a.headline}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {formatDate(a.publication_date)}
                      {a.topic_label && ` · ${a.topic_label}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {searchResults.length === 0 && search && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                No results — try another query
              </div>
            )}
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <button
                onClick={() => setPickerSide(null)}
                style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 4, cursor: 'pointer' }}
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
