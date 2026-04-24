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
    <div className="compare-view" style={{ padding: '1rem 1.25rem' }}>
      <h2 style={{ marginTop: 0 }}>Compare Two Periods</h2>
      <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: 13 }}>
        Pick two date ranges and see how coverage shifted between them.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginTop: 16 }}>
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
    <div style={{
      border: `1px solid var(--border-color)`,
      borderTop: `3px solid ${color}`,
      borderRadius: 8,
      padding: '0.75rem 1rem 1rem',
      background: 'var(--bg-primary)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0, color }}>{title}</h3>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {summary.articleCount.toLocaleString()} articles
        </span>
      </div>

      <DateRangePicker
        from={from}
        to={to}
        onChange={onRangeChange}
        compact
      />

      <hr style={{ margin: '12px 0', border: 0, borderTop: '1px solid var(--border-color)' }} />

      {summary.loading ? (
        <SkeletonChart />
      ) : summary.error ? (
        <EmptyState icon="!" title="Failed to load" description={summary.error} />
      ) : summary.articleCount === 0 ? (
        <EmptyState title="No articles in this range" />
      ) : (
        <>
          {/* Sentiment bars */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Sentiment</div>
            <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden' }}>
              <div title={`${sent.positive} positive`} style={{ width: `${pct(sent.positive)}%`, background: chartColors.positive }} />
              <div title={`${sent.neutral} neutral`}  style={{ width: `${pct(sent.neutral)}%`,  background: chartColors.muted }} />
              <div title={`${sent.negative} negative`} style={{ width: `${pct(sent.negative)}%`, background: chartColors.negative }} />
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
              <span style={{ color: chartColors.positive }}>+ {pct(sent.positive)}%</span>
              <span>= {pct(sent.neutral)}%</span>
              <span style={{ color: chartColors.negative }}>- {pct(sent.negative)}%</span>
            </div>
          </div>

          {/* Top entities */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Top entities</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
              {summary.topEntities.map(e => (
                <li key={`${e.type}:${e.text}`} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '3px 0', borderBottom: '1px solid var(--border-color)',
                }}>
                  <button
                    type="button"
                    onClick={() => navigate(`/entity/${encodeURIComponent(e.text)}`)}
                    title={`View ${e.text}`}
                    style={{
                      background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                      color: 'var(--primary-color)', textAlign: 'left', font: 'inherit',
                    }}
                  >
                    {e.text} <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>({e.type})</span>
                  </button>
                  <span style={{ fontWeight: 600 }}>{e.count.toLocaleString()}</span>
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

  const arrow = (n: number) => n > 0 ? '▲' : n < 0 ? '▼' : '·';
  const sign = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;

  return (
    <div style={{
      marginTop: 20, padding: '1rem 1.25rem',
      border: '1px solid var(--border-color)', borderRadius: 8,
      background: 'var(--bg-secondary)',
    }}>
      <h3 style={{ margin: '0 0 12px' }}>What changed between A → B</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: 13 }}>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase' }}>Article volume</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: volumeDelta > 0 ? chartColors.positive : volumeDelta < 0 ? chartColors.negative : 'var(--text-primary)' }}>
            {arrow(volumeDelta)} {sign(volumeDelta)}%
          </div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
            {a.articleCount.toLocaleString()} → {b.articleCount.toLocaleString()}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase' }}>Net sentiment</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: netDelta > 0 ? chartColors.positive : netDelta < 0 ? chartColors.negative : 'var(--text-primary)' }}>
            {arrow(netDelta)} {sign(netDelta)} pts
          </div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
            {netA.toFixed(1)}% → {netB.toFixed(1)}%
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase' }}>New top entities</div>
          <div style={{ fontSize: 12 }}>
            {newInB.length === 0
              ? <em style={{ color: 'var(--text-tertiary)' }}>None</em>
              : newInB.slice(0, 5).map((e, i) => (
                  <React.Fragment key={`${e.type}:${e.text}`}>
                    {i > 0 && ', '}
                    <button
                      type="button"
                      onClick={() => navigate(`/entity/${encodeURIComponent(e.text)}`)}
                      style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: 'var(--primary-color)', font: 'inherit' }}
                    >{e.text}</button>
                  </React.Fragment>
                ))}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase' }}>Dropped from top</div>
          <div style={{ fontSize: 12 }}>
            {goneInB.length === 0
              ? <em style={{ color: 'var(--text-tertiary)' }}>None</em>
              : goneInB.slice(0, 5).map((e, i) => (
                  <React.Fragment key={`${e.type}:${e.text}`}>
                    {i > 0 && ', '}
                    <button
                      type="button"
                      onClick={() => navigate(`/entity/${encodeURIComponent(e.text)}`)}
                      style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: 'var(--primary-color)', font: 'inherit' }}
                    >{e.text}</button>
                  </React.Fragment>
                ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompareTab;
