/**
 * Corpus-level analytics widgets that consume previously-orphaned endpoints:
 *   - WordCountDistribution → /analytics/word-count-distribution
 *   - PageDistribution      → /analytics/page-distribution
 *   - SourceDistribution    → /analytics/source-distribution
 *
 * These describe the SHAPE of the corpus (how long articles are, where in the
 * paper they ran, which newspapers contributed) — useful background that none
 * of the existing analytics surfaces show.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { API_BASE } from '../config';
import { SkeletonChart } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';

const COLORS = {
  primary: '#667eea',
  positive: '#10b981',
  neutral: '#94a3b8',
  negative: '#ef4444',
  accent: '#f59e0b',
};

interface AsyncState<T> { data: T | null; loading: boolean; error: string | null; }

function useEndpoint<T>(path: string): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));
    axios.get(`${API_BASE}${path}`)
      .then(r => { if (!cancelled) setState({ data: r.data, loading: false, error: null }); })
      .catch(err => {
        if (!cancelled) setState({ data: null, loading: false, error: err?.message || 'Request failed' });
      });
    return () => { cancelled = true; };
  }, [path, tick]);
  return { ...state, reload: () => setTick(t => t + 1) };
}

// ─── Word Count Distribution ───────────────────────────────────────────────

interface WordCountResp {
  buckets: Record<string, number>;
  average_word_count: number;
  total_articles: number;
}

export const WordCountDistribution: React.FC = () => {
  const { data, loading, error, reload } = useEndpoint<WordCountResp>('/analytics/word-count-distribution');

  const rows = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.buckets).map(([range, count]) => ({ range, count }));
  }, [data]);

  if (loading) return <SkeletonChart />;
  if (error) return <EmptyState icon="!" title="Couldn't load word counts" description={error} action={{ label: 'Retry', onClick: reload }} />;
  if (!rows.length) return <EmptyState title="No data yet" />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Article Length Distribution</h3>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Avg {data!.average_word_count.toLocaleString()} words across {data!.total_articles.toLocaleString()} articles
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={rows} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="range" stroke="var(--text-secondary)" fontSize={12} />
          <YAxis stroke="var(--text-secondary)" fontSize={12} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6 }}
            formatter={(v: any) => [Number(v ?? 0).toLocaleString(), 'Articles']}
          />
          <Bar dataKey="count" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

// ─── Page Distribution ─────────────────────────────────────────────────────

interface PageResp { pages: Record<string, number>; }

export const PageDistribution: React.FC = () => {
  const { data, loading, error, reload } = useEndpoint<PageResp>('/analytics/page-distribution');
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const all = Object.entries(data.pages).map(([page, count]) => ({ page, count }));
    return showAll ? all : all.slice(0, 20);
  }, [data, showAll]);

  if (loading) return <SkeletonChart />;
  if (error) return <EmptyState icon="!" title="Couldn't load page distribution" description={error} action={{ label: 'Retry', onClick: reload }} />;
  if (!rows.length) return <EmptyState title="No page data" description="Articles in this corpus don't carry a page number." />;

  const total = Object.values(data!.pages).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Articles by Newspaper Page</h3>
        <button
          onClick={() => setShowAll(s => !s)}
          style={{
            padding: '3px 10px', fontSize: 12, borderRadius: 12,
            border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
            color: 'var(--text-primary)', cursor: 'pointer',
          }}
        >
          {showAll ? 'Top 20' : `All ${Object.keys(data!.pages).length}`}
        </button>
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={rows} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="page" stroke="var(--text-secondary)" fontSize={12} />
          <YAxis stroke="var(--text-secondary)" fontSize={12} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6 }}
            formatter={(v: any) => {
              const n = Number(v ?? 0);
              return [`${n.toLocaleString()} (${((n / total) * 100).toFixed(1)}%)`, 'Articles'];
            }}
          />
          {/* Color the bar grey when the page is "Unknown" (i.e. metadata
              extraction failed) so it visually reads as missing data rather
              than competing with real page numbers. */}
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {rows.map((row, i) => (
              <Cell
                key={i}
                fill={String(row.page).toLowerCase() === 'unknown' ? COLORS.neutral : COLORS.accent}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>
        {total.toLocaleString()} articles across {Object.keys(data!.pages).length} distinct page slots.
        {data!.pages['Unknown'] ? (
          <> · <span style={{ color: 'var(--text-secondary)' }}>
            {data!.pages['Unknown'].toLocaleString()} of unknown page (extraction failed)
          </span></>
        ) : null}
      </div>
    </div>
  );
};

// ─── Source Distribution ───────────────────────────────────────────────────

interface SourceRow { count: number; positive: number; neutral: number; negative: number; }
interface SourceResp { sources: Record<string, SourceRow>; total_sources: number; }

export const SourceDistribution: React.FC = () => {
  const { data, loading, error, reload } = useEndpoint<SourceResp>('/analytics/source-distribution');

  const rows = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.sources)
      .map(([source, v]) => ({ source, ...v }))
      .slice(0, 15);
  }, [data]);

  if (loading) return <SkeletonChart />;
  if (error) return <EmptyState icon="!" title="Couldn't load source distribution" description={error} action={{ label: 'Retry', onClick: reload }} />;
  if (!rows.length) return <EmptyState title="No source data" />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Coverage by Source</h3>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {data!.total_sources} sources · stacked by sentiment
        </div>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(280, rows.length * 30)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 10, right: 20, left: 60, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis type="number" stroke="var(--text-secondary)" fontSize={12} />
          <YAxis dataKey="source" type="category" stroke="var(--text-secondary)" fontSize={12} width={120} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6 }}
          />
          <Legend />
          <Bar dataKey="positive" stackId="s" fill={COLORS.positive} name="Positive" />
          <Bar dataKey="neutral"  stackId="s" fill={COLORS.neutral}  name="Neutral" />
          <Bar dataKey="negative" stackId="s" fill={COLORS.negative} name="Negative" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

// ─── Bundle for the dashboard ──────────────────────────────────────────────

const CorpusAnalytics: React.FC = () => (
  <>
    <div className="analytics-card full-width"><WordCountDistribution /></div>
    <div className="analytics-card full-width"><PageDistribution /></div>
    <div className="analytics-card full-width"><SourceDistribution /></div>
  </>
);

export default CorpusAnalytics;
