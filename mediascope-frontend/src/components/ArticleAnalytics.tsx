/**
 * ArticleAnalytics — "About this article" panel for ArticleDetailPage.
 *
 * Shows article-scoped facts that don't fit on the main page chrome:
 *   - Reading time (derived from word_count, ~225 wpm)
 *   - Length-percentile rank within the corpus (based on /word-count-distribution)
 *   - Entity-type breakdown for this article
 *   - Same-day, same-page, and same-topic counts ("On the same day Dawn ran 17
 *     other articles") — useful drill-throughs that link to filtered search.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { entityInfo } from '../data/entityTypes';
import { colorForSentiment } from '../theme/chartColors';

interface Props { article: any; }

function readingTime(words: number): string {
  const minutes = Math.max(1, Math.round(words / 225));
  return minutes === 1 ? '~1 min read' : `~${minutes} min read`;
}

const ArticleAnalytics: React.FC<Props> = ({ article }) => {
  const navigate = useNavigate();
  const [percentile, setPercentile] = useState<number | null>(null);
  const [sameDayCount, setSameDayCount] = useState<number | null>(null);

  // Compute the article's word-count percentile by hitting the existing
  // distribution endpoint (already cached on the backend).
  useEffect(() => {
    let cancelled = false;
    if (!article?.word_count) return;
    axios.get(`${API_BASE}/analytics/word-count-distribution`)
      .then(r => {
        if (cancelled) return;
        const buckets = r.data?.buckets || {};
        const order = ['0-100', '100-300', '300-500', '500-1000', '1000-2000', '2000-5000', '5000+'];
        const upper = [100, 300, 500, 1000, 2000, 5000, Infinity];
        const total = order.reduce((s, k) => s + (buckets[k] || 0), 0);
        if (total === 0) return;
        let cumulative = 0;
        for (let i = 0; i < order.length; i++) {
          const k = order[i];
          if (article.word_count <= upper[i]) {
            // Approximate the article's rank as middle of the bucket.
            cumulative += (buckets[k] || 0) / 2;
            // Clamp to 99 so the longest articles don't render as "longer than
            // 100% of the corpus" (which is mathematically silly).
            setPercentile(Math.min(99, Math.round((cumulative / total) * 100)));
            return;
          }
          cumulative += buckets[k] || 0;
        }
      })
      .catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, [article?.word_count]);

  // Pull the same-day article count to power the "Dawn also ran X articles
  // today" drill-through. Light call: existing /articles-by-day is cached.
  useEffect(() => {
    let cancelled = false;
    const pub = article?.publication_date;
    if (!pub) return;
    const day = (typeof pub === 'string' ? pub : new Date(pub).toISOString()).slice(0, 10);
    axios.get(`${API_BASE}/analytics/articles-by-day`)
      .then(r => {
        if (cancelled) return;
        const days = r.data?.days || [];
        const found = days.find((d: any) => d.date === day);
        // Subtract 1 to exclude this article from "also ran".
        setSameDayCount(found ? Math.max(0, (found.count || 0) - 1) : 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [article?.publication_date]);

  // Group this article's entities by NER type for a tidy summary.
  const entitySummary = useMemo(() => {
    const ents: any[] = article?.entities || [];
    const byType = new Map<string, Set<string>>();
    for (const e of ents) {
      const type = e.type || 'OTHER';
      const text = (e.text || '').trim();
      if (!text) continue;
      if (!byType.has(type)) byType.set(type, new Set());
      byType.get(type)!.add(text);
    }
    return Array.from(byType.entries())
      .map(([type, texts]) => ({ type, texts: Array.from(texts) }))
      .sort((a, b) => b.texts.length - a.texts.length);
  }, [article?.entities]);

  if (!article) return null;

  const day = article.publication_date
    ? (typeof article.publication_date === 'string'
        ? article.publication_date
        : new Date(article.publication_date).toISOString()).slice(0, 10)
    : null;

  return (
    <aside
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        padding: '0.75rem 1rem',
        background: 'var(--bg-primary)',
        fontSize: 13,
      }}
    >
      <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>About this article</h3>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        {article.word_count != null && (
          <li>
            <strong>{article.word_count.toLocaleString()} words</strong>
            <span style={{ color: 'var(--text-tertiary)' }}> · {readingTime(article.word_count)}</span>
            {percentile != null && (
              <span style={{ color: 'var(--text-tertiary)' }}>
                {' '}· longer than {percentile}% of the corpus
              </span>
            )}
          </li>
        )}
        {article.topic_label && (
          <li>
            Topic: <code style={{ background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: 3 }}>{article.topic_label}</code>
          </li>
        )}
        {article.sentiment_label && (
          <li>
            Sentiment: <strong style={{ color: colorForSentiment(article.sentiment_label) }}>
              {article.sentiment_label}
            </strong>
            {article.sentiment_score != null && (
              <span style={{ color: 'var(--text-tertiary)' }}> ({article.sentiment_score.toFixed(2)})</span>
            )}
          </li>
        )}
        {sameDayCount != null && day && (
          <li>
            Dawn ran{' '}
            <button
              onClick={() => navigate(`/?from=${day}&to=${day}`)}
              style={{
                background: 'transparent', border: 0, padding: 0,
                color: 'var(--primary-color)', cursor: 'pointer', fontWeight: 600,
                textDecoration: 'underline',
              }}
            >
              {sameDayCount} other article{sameDayCount === 1 ? '' : 's'}
            </button>{' '}
            on {day}
          </li>
        )}
      </ul>

      {entitySummary.length > 0 && (
        <>
          <hr style={{ margin: '10px 0', border: 0, borderTop: '1px solid var(--border-color)' }} />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Mentioned</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {entitySummary.map(g => {
              const info = entityInfo(g.type);
              return (
              <div key={g.type}>
                <div style={{ fontSize: 11, fontWeight: 600, color: info.color, textTransform: 'uppercase' }}>
                  {info.label} · {g.texts.length}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                  {g.texts.slice(0, 12).map(t => (
                    <button
                      key={t}
                      onClick={() => navigate(`/entity/${encodeURIComponent(t)}`)}
                      style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 12,
                        padding: '2px 8px',
                        fontSize: 11,
                        cursor: 'pointer',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
};

export default ArticleAnalytics;
