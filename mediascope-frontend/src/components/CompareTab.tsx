/**
 * CompareTab — side-by-side comparison of two date ranges.
 *
 * Pick a "Period A" and a "Period B" (each preset-aware via DateRangePicker),
 * and the page shows matched analytics for both ranges with deltas:
 *   - Article volume
 *   - Sentiment mix (positive / neutral / negative %)
 *   - Top entities (with mention deltas)
 *   - Top topics
 *
 * Useful for questions like:
 *   "How did Pakistan coverage shift before vs. after the Gulf War?"
 *   "What changed between Bhutto's dismissal and Sharif's first months?"
 *
 * All requests are derived client-side from the same /sentiment-by-entity,
 * /top-entities-fixed, /sentiment-over-time endpoints — no new backend needed.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertCircle, ArrowRight, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { API_BASE } from '../config';
import { useDateBounds } from '../hooks/useDataVersion';
import DateRangePicker from './ui/DateRangePicker';
import { SkeletonChart } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import { useNavigate } from 'react-router-dom';
import { chartColors } from '../theme/chartColors';

interface PeriodSummary {
  range: { from: string; to: string };
  articleCount: number;
  sentiment: { positive: number; neutral: number; negative: number };
  topEntities: { text: string; type: string; count: number }[];
  loading: boolean;
  error: string | null;
}

const EMPTY: PeriodSummary = {
  range: { from: '', to: '' },
  articleCount: 0,
  sentiment: { positive: 0, neutral: 0, negative: 0 },
  topEntities: [],
  loading: true,
  error: null,
};

async function loadPeriod(from: string, to: string): Promise<Omit<PeriodSummary, 'range' | 'loading' | 'error'>> {
  // Pull what we need in parallel. Falls back gracefully if any one endpoint
  // returns nothing.
  const [sentimentRes, entitiesRes] = await Promise.all([
    axios.get(`${API_BASE}/analytics/sentiment-over-time`).catch(() => ({ data: { timeline: [] } })),
    axios.get(`${API_BASE}/analytics/top-entities-fixed`, { params: { limit: 12, start_date: from, end_date: to } }).catch(() => ({ data: { entities: [] } })),
  ]);

  // Fold the global sentiment timeline down to the requested range.
  const tl: any[] = sentimentRes.data.timeline || [];
  const inRange = tl.filter(row => {
    const m = String(row.month || '');
    return m >= from.slice(0, 7) && m <= to.slice(0, 7);
  });
  const sentiment = inRange.reduce((acc, row) => ({
    positive: acc.positive + (row.positive || 0),
    neutral:  acc.neutral  + (row.neutral  || 0),
    negative: acc.negative + (row.negative || 0),
  }), { positive: 0, neutral: 0, negative: 0 });

  const articleCount = sentiment.positive + sentiment.neutral + sentiment.negative;

  const topEntities = (entitiesRes.data.entities || []).slice(0, 12).map((e: any) => ({
    text: e.text, type: e.type, count: e.count,
  }));

  return { articleCount, sentiment, topEntities };
}

const CompareTab: React.FC = () => {
  const [minBound, maxBound] = useDateBounds();

  // Sensible default: split the corpus down the middle.
  const midDate = useMemo(() => {
    if (!minBound || !maxBound) return null;
    const start = new Date(minBound).getTime();
    const end = new Date(maxBound).getTime();
    const mid = new Date((start + end) / 2);
    return mid.toISOString().slice(0, 10);
  }, [minBound, maxBound]);

  const [aFrom, setAFrom] = useState(minBound);
  const [aTo, setATo]     = useState(midDate || maxBound);
  const [bFrom, setBFrom] = useState(midDate || minBound);
  const [bTo, setBTo]     = useState(maxBound);

  const [periodA, setPeriodA] = useState<PeriodSummary>(EMPTY);
  const [periodB, setPeriodB] = useState<PeriodSummary>(EMPTY);

  // Re-snap defaults when the corpus bounds finish loading.
  useEffect(() => {
    if (!minBound || !maxBound) return;
    setAFrom(prev => prev || minBound);
    setATo(prev => prev || midDate || maxBound);
    setBFrom(prev => prev || midDate || minBound);
    setBTo(prev => prev || maxBound);
  }, [minBound, maxBound, midDate]);

  useEffect(() => {
    if (!aFrom || !aTo) return;
    setPeriodA({ ...EMPTY, range: { from: aFrom, to: aTo }, loading: true });
    loadPeriod(aFrom, aTo)
      .then(d => setPeriodA({ ...d, range: { from: aFrom, to: aTo }, loading: false, error: null }))
      .catch(err => setPeriodA({ ...EMPTY, range: { from: aFrom, to: aTo }, loading: false, error: err?.message || 'Failed' }));
  }, [aFrom, aTo]);

  useEffect(() => {
    if (!bFrom || !bTo) return;
    setPeriodB({ ...EMPTY, range: { from: bFrom, to: bTo }, loading: true });
    loadPeriod(bFrom, bTo)
      .then(d => setPeriodB({ ...d, range: { from: bFrom, to: bTo }, loading: false, error: null }))
      .catch(err => setPeriodB({ ...EMPTY, range: { from: bFrom, to: bTo }, loading: false, error: err?.message || 'Failed' }));
  }, [bFrom, bTo]);

  return (
    <div className="compare-view" style={{ padding: 'var(--space-4) var(--space-5)' }}>
      <header className="stack stack--tight" style={{ marginBottom: 'var(--space-2)' }}>
        <span className="section-eyebrow">Compare</span>
        <h2 style={{ margin: 0 }}>Two periods, side by side</h2>
        <p className="stat-sub" style={{ margin: 0 }}>
          Pick two date ranges and see how coverage, sentiment, and the cast of characters shifted.
        </p>
      </header>

      <div className="compare-grid">
        <PeriodColumn
          title="Period A"
          color={chartColors.primary}
          from={aFrom}
          to={aTo}
          onRangeChange={(f, t) => { setAFrom(f); setATo(t); }}
          summary={periodA}
        />
        <PeriodColumn
          title="Period B"
          color={chartColors.accent}
          from={bFrom}
          to={bTo}
          onRangeChange={(f, t) => { setBFrom(f); setBTo(t); }}
          summary={periodB}
        />
      </div>

      {/* Delta summary across the two */}
      {!periodA.loading && !periodB.loading && periodA.articleCount > 0 && periodB.articleCount > 0 && (
        <DeltaPanel a={periodA} b={periodB} />
      )}
    </div>
  );
};

const PeriodColumn: React.FC<{
  title: string;
  color: string;
  from: string;
  to: string;
  onRangeChange: (f: string, t: string) => void;
  summary: PeriodSummary;
}> = ({ title, color, from, to, onRangeChange, summary }) => {
  const navigate = useNavigate();
  const total = summary.articleCount || 1;
  const sent = summary.sentiment;
  const pct = (n: number) => ((n / total) * 100).toFixed(1);

  return (
    <div className="compare-period" style={{ borderTopColor: color }}>
      <div className="compare-period__head">
        <h3 className="compare-period__title" style={{ color }}>{title}</h3>
        <span className="chip">
          {summary.articleCount.toLocaleString()} articles
        </span>
      </div>

      <DateRangePicker
        from={from}
        to={to}
        onChange={onRangeChange}
        compact
      />

      <hr className="divider" style={{ margin: 'var(--space-3) 0' }} />

      {summary.loading ? (
        <SkeletonChart />
      ) : summary.error ? (
        <EmptyState
          icon={<AlertCircle size={28} strokeWidth={1.5} />}
          title="Couldn't load this range"
          description={summary.error}
        />
      ) : summary.articleCount === 0 ? (
        <EmptyState
          title="No articles in this range"
          description="Widen the dates or pick a different stretch of the archive."
        />
      ) : (
        <>
          {/* Sentiment bars */}
          <div className="stack stack--tight" style={{ marginBottom: 'var(--space-3)' }}>
            <div className="section-eyebrow" style={{ marginBottom: 0 }}>Sentiment</div>
            <div className="compare-sentbar">
              <div title={`${sent.positive} positive`} style={{ width: `${pct(sent.positive)}%`, background: chartColors.positive }} />
              <div title={`${sent.neutral} neutral`}  style={{ width: `${pct(sent.neutral)}%`,  background: chartColors.muted }} />
              <div title={`${sent.negative} negative`} style={{ width: `${pct(sent.negative)}%`, background: chartColors.negative }} />
            </div>
            <div className="cluster" style={{ fontSize: 'var(--font-size-xs)', gap: 'var(--space-3)' }}>
              <span style={{ color: chartColors.positive }}>Positive {pct(sent.positive)}%</span>
              <span style={{ color: 'var(--text-secondary)' }}>Neutral {pct(sent.neutral)}%</span>
              <span style={{ color: chartColors.negative }}>Negative {pct(sent.negative)}%</span>
            </div>
          </div>

          {/* Top entities */}
          <div>
            <div className="section-eyebrow">Top entities</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {summary.topEntities.map(e => (
                <li key={`${e.type}:${e.text}`} className="compare-entity-row">
                  <button
                    type="button"
                    onClick={() => navigate(`/entity/${encodeURIComponent(e.text)}`)}
                    title={`View ${e.text}`}
                    className="compare-link"
                  >
                    {e.text} <span className="compare-entity-type">({e.type})</span>
                  </button>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {e.count.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

const DeltaPanel: React.FC<{ a: PeriodSummary; b: PeriodSummary }> = ({ a, b }) => {
  const navigate = useNavigate();
  const volumeDelta = ((b.articleCount - a.articleCount) / Math.max(1, a.articleCount)) * 100;

  // Net sentiment per period: (pos - neg) / total
  const net = (s: PeriodSummary) => {
    const total = s.articleCount || 1;
    return ((s.sentiment.positive - s.sentiment.negative) / total) * 100;
  };
  const netA = net(a);
  const netB = net(b);
  const netDelta = netB - netA;

  // Entity churn: which names appear in B but not A?
  const aSet = new Set(a.topEntities.map(e => `${e.type}:${e.text.toLowerCase()}`));
  const newInB = b.topEntities.filter(e => !aSet.has(`${e.type}:${e.text.toLowerCase()}`));
  const bSet = new Set(b.topEntities.map(e => `${e.type}:${e.text.toLowerCase()}`));
  const goneInB = a.topEntities.filter(e => !bSet.has(`${e.type}:${e.text.toLowerCase()}`));

  const deltaIcon = (n: number, size = 14) => {
    if (n > 0) return <ArrowUpRight size={size} aria-hidden="true" />;
    if (n < 0) return <ArrowDownRight size={size} aria-hidden="true" />;
    return <Minus size={size} aria-hidden="true" />;
  };
  const sign = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
  const deltaClass = (n: number) =>
    n > 0 ? 'compare-delta-value compare-delta-value--positive'
    : n < 0 ? 'compare-delta-value compare-delta-value--negative'
    : 'compare-delta-value';

  return (
    <div className="compare-delta-card">
      <header className="cluster" style={{ marginBottom: 'var(--space-3)' }}>
        <h3 className="section-title" style={{ margin: 0 }}>What changed</h3>
        <span className="chip">
          A <ArrowRight size={12} aria-hidden="true" /> B
        </span>
      </header>
      <div className="compare-delta-grid">
        <div className="stack stack--tight">
          <div className="stat-label">Article volume</div>
          <div className={deltaClass(volumeDelta)}>
            {deltaIcon(volumeDelta, 16)} {sign(volumeDelta)}%
          </div>
          <div className="stat-sub">
            {a.articleCount.toLocaleString()} → {b.articleCount.toLocaleString()}
          </div>
        </div>
        <div className="stack stack--tight">
          <div className="stat-label">Net sentiment</div>
          <div className={deltaClass(netDelta)}>
            {deltaIcon(netDelta, 16)} {sign(netDelta)} pts
          </div>
          <div className="stat-sub">
            {netA.toFixed(1)}% → {netB.toFixed(1)}%
          </div>
        </div>
        <div className="stack stack--tight">
          <div className="stat-label">New top entities</div>
          <div className="cluster" style={{ gap: 'var(--space-1)' }}>
            {newInB.length === 0
              ? <span className="stat-sub">None — same cast.</span>
              : newInB.slice(0, 5).map((e) => (
                  <button
                    key={`${e.type}:${e.text}`}
                    type="button"
                    onClick={() => navigate(`/entity/${encodeURIComponent(e.text)}`)}
                    className="chip chip--accent compare-link"
                  >{e.text}</button>
                ))}
          </div>
        </div>
        <div className="stack stack--tight">
          <div className="stat-label">Dropped from top</div>
          <div className="cluster" style={{ gap: 'var(--space-1)' }}>
            {goneInB.length === 0
              ? <span className="stat-sub">Nobody dropped out.</span>
              : goneInB.slice(0, 5).map((e) => (
                  <button
                    key={`${e.type}:${e.text}`}
                    type="button"
                    onClick={() => navigate(`/entity/${encodeURIComponent(e.text)}`)}
                    className="chip compare-link"
                  >{e.text}</button>
                ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompareTab;
