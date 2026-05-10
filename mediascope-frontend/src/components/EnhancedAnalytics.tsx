import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { useAnalyticsCache } from '../hooks/useAnalyticsCache';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LineChart, Line
} from 'recharts';
import ChartExportButton from './ChartExportButton';
import { SkeletonChart } from './ui/Skeleton';
import EmptyStatePrim from './ui/EmptyState';
import { chartColors } from '../theme/chartColors';
import { entityInfo } from '../data/entityTypes';
import { useDateBounds } from '../hooks/useDataVersion';

// Summary Cards Component
export const AnalyticsSummary: React.FC = () => {
  // Cache key bumped to v2 because the result shape changed (added
  // `datedArticles` + `undatedArticles`, switched `totalArticles` source
  // from articles-over-time-sum to data-version). Old v1 entries in
  // localStorage held `totalArticles: 4060` — bumping evicts them.
  const { data: stats, loading } = useAnalyticsCache('summary_v2', async () => {
    // /data-version returns the AUTHORITATIVE Firestore article count.
    // /analytics/articles-over-time only sums articles that have a
    // publication_date — sentinel-nulled articles don't appear in the
    // timeline. Showing the timeline sum as "Total Articles" was
    // misleading (4,060 vs the true 5,004).
    const [versionRes, articlesRes, sentimentRes, entitiesRes] = await Promise.all([
      axios.get(`${API_BASE}/analytics/data-version`),
      axios.get(`${API_BASE}/analytics/articles-over-time`),
      axios.get(`${API_BASE}/analytics/sentiment-over-time`),
      axios.get(`${API_BASE}/analytics/top-entities-fixed?limit=1`)
    ]);
    const articles = articlesRes.data.timeline || [];
    const sentiment = sentimentRes.data.timeline || [];

    const totalArticles = versionRes.data.article_count ?? 0;
    const datedArticles = articles.reduce((sum: number, item: any) => sum + item.count, 0);
    const undatedArticles = Math.max(0, totalArticles - datedArticles);

    let totalPos = 0, totalNeut = 0, totalNeg = 0;
    sentiment.forEach((item: any) => { totalPos += item.positive || 0; totalNeut += item.neutral || 0; totalNeg += item.negative || 0; });
    const total = totalPos + totalNeut + totalNeg;
    const avgSentiment = total > 0 ? ((totalPos - totalNeg) / total).toFixed(2) : '0.00';
    const months = articles.map((a: any) => a.month).sort();
    const dateRange = months.length > 0 ? `${months[0]} to ${months[months.length - 1]}` : 'N/A';
    return {
      totalArticles,
      datedArticles,
      undatedArticles,
      avgSentiment,
      dateRange,
      topEntitiesCount: entitiesRes.data.entities?.length || 0,
    };
  });

  if (loading) return (
    <div className="stat-grid" style={{ marginBottom: 'var(--space-4)' }}>
      <div className="skeleton skeleton-stat" />
      <div className="skeleton skeleton-stat" />
      <div className="skeleton skeleton-stat" />
    </div>
  );
  if (!stats) return null;

  const sentNum = parseFloat(stats.avgSentiment);
  const sentColor = sentNum > 0.1 ? chartColors.positive : sentNum < -0.1 ? chartColors.negative : chartColors.neutral;

  return (
    <div className="stat-grid" style={{ marginBottom: 'var(--space-4)' }}>
      <div className="stat-card stat-card--accent">
        <span className="stat-label">Total Articles</span>
        <span className="stat-value">{stats.totalArticles.toLocaleString()}</span>
        {/* Removed the "X dated · Y awaiting date recovery" subline.
            It was telling reviewers about an internal pipeline state
            that has no place in the user-facing KPI — the headline
            number is what matters. */}
      </div>
      <div className="stat-card">
        <span className="stat-label">Coverage Period</span>
        <span className="stat-value" style={{ fontSize: 'var(--font-size-md)' }}>
          {stats.dateRange}
        </span>
      </div>
      <div className="stat-card">
        <span className="stat-label">Overall Sentiment</span>
        <span className="stat-value" style={{ color: sentColor }}>
          {sentNum > 0 ? '+' : ''}{stats.avgSentiment}
        </span>
      </div>
    </div>
  );
};

// Sentiment Distribution Pie Chart
interface SentimentDistributionProps {
  /**
   * Drill-through: fired when the user clicks a slice or legend tile.
   * The dashboard wires this to pin a sentiment filter on the search view.
   */
  onSliceClick?: (label: 'positive' | 'neutral' | 'negative') => void;
}

export const SentimentDistribution: React.FC<SentimentDistributionProps> = ({ onSliceClick }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const { data: raw, loading } = useAnalyticsCache('sentiment_distribution', async () => {
    const response = await axios.get(`${API_BASE}/analytics/sentiment-over-time`);
    const timeline = response.data.timeline || [];
    let positive = 0, neutral = 0, negative = 0;
    timeline.forEach((item: any) => {
      positive += item.positive || 0;
      neutral += item.neutral || 0;
      negative += item.negative || 0;
    });
    const total = positive + neutral + negative;
    return [
      { name: 'Positive', value: positive, percentage: total > 0 ? ((positive / total) * 100).toFixed(1) : '0.0' },
      { name: 'Neutral', value: neutral, percentage: total > 0 ? ((neutral / total) * 100).toFixed(1) : '0.0' },
      { name: 'Negative', value: negative, percentage: total > 0 ? ((negative / total) * 100).toFixed(1) : '0.0' }
    ];
  });
  const data: any[] = raw || [];

  const COLORS = [chartColors.positive, chartColors.neutral, chartColors.negative];

  if (loading) return <SkeletonChart />;
  if (data.length === 0) return (
    <EmptyStatePrim title="No sentiment data available" description="Sentiment hasn't been computed for any articles yet." />
  );

  // Net sentiment = positive − negative as a share of all articles. Useful at
  // a glance: a single signed number that says "is the corpus net-positive?"
  const totalArticles = data.reduce((sum, d) => sum + d.value, 0);
  const positiveCount = data.find(d => d.name === 'Positive')?.value || 0;
  const negativeCount = data.find(d => d.name === 'Negative')?.value || 0;
  const netPct = totalArticles > 0
    ? (((positiveCount - negativeCount) / totalArticles) * 100).toFixed(1)
    : '0.0';
  const netNum = parseFloat(netPct);
  const netColor = netNum > 0 ? chartColors.positive : netNum < 0 ? chartColors.negative : chartColors.neutral;

  return (
    <div ref={chartRef}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Overall Sentiment Distribution</h3>
        <ChartExportButton targetRef={chartRef} filenamePrefix="mediascope-sentiment" />
      </div>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
        Breakdown of positive, neutral, and negative articles across the entire archive ·
        <span style={{ marginLeft: 8, fontWeight: 600, color: netColor }}>
          Net {netNum > 0 ? '+' : ''}{netPct}%
        </span>
      </p>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={(entry: any) => `${entry.name}: ${(entry.percent * 100).toFixed(1)}%`}
              outerRadius={110}
              fill="#8884d8"
              dataKey="value"
              onClick={onSliceClick ? (e: any) => onSliceClick(String(e?.name || '').toLowerCase() as any) : undefined}
              style={onSliceClick ? { cursor: 'pointer' } : undefined}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '12px' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '1rem' }}>
        {data.map((entry, index) => {
          const lbl = entry.name.toLowerCase() as 'positive' | 'neutral' | 'negative';
          const clickable = !!onSliceClick;
          return (
            <button
              key={entry.name}
              onClick={() => onSliceClick?.(lbl)}
              disabled={!clickable}
              title={clickable ? `Filter search to ${lbl} articles` : undefined}
              style={{
                textAlign: 'center',
                background: 'transparent',
                border: 'none',
                padding: '4px 8px',
                borderRadius: 6,
                cursor: clickable ? 'pointer' : 'default',
              }}
              onMouseEnter={e => { if (clickable) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{
                width: '12px', height: '12px', borderRadius: '50%',
                background: COLORS[index], display: 'inline-block', marginRight: '6px'
              }} />
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>{entry.name}</span>
              <div style={{ fontSize: '18px', fontWeight: '700', color: COLORS[index], marginTop: '2px' }}>
                {entry.percentage}%
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{entry.value.toLocaleString()} articles</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Topic Distribution Chart
const TOPIC_MAJOR_THRESHOLD = 30;  // articles required to be a "major" bucket
const TOPIC_MIN_VISIBLE = 5;       // articles required to render at all (drops empty/orphan topics)

export const TopicDistribution: React.FC = () => {
  const navigate = useNavigate();
  // Cache key bumped to v2 because the threshold changed from >=30 to
  // >=5 — old v1 entries had only 27 topics; bumping forces a refetch
  // that includes the long-tail.
  const { data: raw, loading } = useAnalyticsCache('topic_distribution_v2', async () => {
    const response = await axios.get(`${API_BASE}/topics/`);
    const topics = response.data.topics || [];
    // Keep anything with at least TOPIC_MIN_VISIBLE articles. The previous
    // hard >=30 cutoff hid the long-tail buckets (e.g. Puzzles &
    // Crosswords, IMF & External Debt) which are real categories with
    // smaller counts — and made the dashboard look like the corpus only
    // had 27 topics when 47 are actually populated.
    // Hide the catch-all "Other / Uncategorised" bucket. It's a sink
    // for everything the topic classifier wasn't sure about, so it
    // outranks real categories alphabetically (and was sitting at
    // position 2 in the list with ~2k articles, which made the
    // taxonomy look broken).
    const isCatchall = (label: string) => {
      const t = (label || '').trim().toLowerCase();
      return t === 'other' || t === 'uncategorized' || t === 'uncategorised'
        || t === 'other / uncategorised' || t === 'other / uncategorized'
        || t === 'unknown' || t === 'misc' || t === 'miscellaneous';
    };
    return topics
      .filter((t: any) => (t.count ?? 0) >= TOPIC_MIN_VISIBLE)
      .filter((t: any) => !isCatchall(t.label || t.name))
      .sort((a: any, b: any) => b.count - a.count);
  });
  const data: any[] = raw || [];

  if (loading) return <SkeletonChart />;
  if (data.length === 0) return (
    <div className="empty-state">
      <p className="empty-state__title">No topics yet</p>
      <p className="empty-state__body">
        The topic backfill hasn't classified anything above the {TOPIC_MIN_VISIBLE}-article threshold yet.
        Let it run, or lower the threshold.
      </p>
    </div>
  );

  return (
    <div>
      <div className="section-header">
        <div>
          <div className="section-eyebrow">Topic taxonomy</div>
          <h3 className="section-title" style={{ margin: 0 }}>
            {data.length} populated topics
          </h3>
        </div>
      </div>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: `0 0 var(--space-3) 0` }}>
        Pick one from the dropdown or scroll the list below.
      </p>

      {/* Quick-jump dropdown — 82 topics is too many to scroll. Picking
          a topic from here navigates straight to its detail page. */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        marginBottom: 'var(--space-3)',
      }}>
        <label style={{
          fontSize: '0.75rem',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-serif-smallcaps, serif)',
        }} htmlFor="topic-quickjump">Jump to:</label>
        <select
          id="topic-quickjump"
          defaultValue=""
          onChange={(e) => {
            const id = e.target.value;
            if (id) navigate(`/topic/${id}`);
          }}
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm, 6px)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            font: 'inherit',
          }}
        >
          <option value="">— select a topic —</option>
          {data.map((topic) => (
            <option key={topic.topic_id} value={topic.topic_id}>
              {topic.name} ({(topic.count || 0).toLocaleString()})
            </option>
          ))}
        </select>
      </div>

      <TopicGroupedList data={data} onSelect={(id) => navigate(`/topic/${id}`)} />
    </div>
  );
};

// Render a topic card with the vintage palette colour band on its left.
function TopicCard({ topic, idx, onSelect }:
  { topic: any; idx: number; onSelect: (id: string|number) => void }) {
  const topicColor = TOPIC_COLORS[idx % TOPIC_COLORS.length];
  return (
    <div
      key={topic.topic_id}
      onClick={() => onSelect(topic.topic_id)}
      style={{
        border: '1px solid var(--border-color)',
        borderLeft: `4px solid ${topicColor}`,
        borderRadius: '8px',
        background: 'var(--bg-primary)',
        padding: '12px 16px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        transition: 'background 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-secondary)';
        e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--bg-primary)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '14px' }}>
            {topic.name}
          </span>
          <span style={{
            background: topicColor,
            color: 'var(--paper-cream, white)',
            padding: '2px 10px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 600,
            fontFeatureSettings: '"tnum" 1, "lnum" 1',
          }}>
            {(topic.count || 0).toLocaleString()} articles
          </span>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {(topic.keywords || []).slice(0, 8).join(' • ')}
        </div>
      </div>
      <span style={{ color: 'var(--text-tertiary)', fontSize: '16px' }}>→</span>
    </div>
  );
}

// Group topics by article-count tier and render each tier as a
// collapsible section. 82 topics in one flat list is too long; tiering
// puts the news-defining ones on top and tucks the long tail away.
function TopicGroupedList({ data, onSelect }:
  { data: any[]; onSelect: (id: string|number) => void }) {
  // Tier thresholds chosen to land roughly in 3 reasonable buckets for
  // this corpus (top: 5–10 dominant categories; mid: 20–30; tail: rest).
  const major       = data.filter((t: any) => (t.count || 0) >= 500);
  const significant = data.filter((t: any) => (t.count || 0) < 500 && (t.count || 0) >= 100);
  const minor       = data.filter((t: any) => (t.count || 0) < 100);

  const [showSig, setShowSig] = useState(true);
  const [showMinor, setShowMinor] = useState(false);

  const tierStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    margin: '1rem 0 0.5rem', padding: '0.4rem 0',
    borderBottom: '1px solid var(--border-color)',
  };
  const eyebrowStyle: React.CSSProperties = {
    fontSize: '0.78rem', letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--text-secondary)',
    fontFamily: 'var(--font-serif-smallcaps, serif)', fontWeight: 600,
  };
  const counterStyle: React.CSSProperties = {
    fontSize: '0.78rem', color: 'var(--text-tertiary, var(--text-secondary))',
    fontFeatureSettings: '"tnum" 1, "lnum" 1',
  };
  const toggleBtnStyle: React.CSSProperties = {
    background: 'transparent', border: '1px solid var(--border-color)',
    borderRadius: '999px', padding: '0.2rem 0.7rem',
    fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer',
  };

  return (
    <div>
      {/* Tier 1 — major (always expanded) */}
      {major.length > 0 && (
        <>
          <div style={tierStyle}>
            <span style={eyebrowStyle}>Major topics · 500+ articles</span>
            <span style={counterStyle}>{major.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {major.map((t: any, i: number) => (
              <TopicCard key={t.topic_id} topic={t} idx={i} onSelect={onSelect} />
            ))}
          </div>
        </>
      )}

      {/* Tier 2 — significant (collapsible, default open) */}
      {significant.length > 0 && (
        <>
          <div style={tierStyle}>
            <span style={eyebrowStyle}>Significant topics · 100–499 articles</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={counterStyle}>{significant.length}</span>
              <button type="button" style={toggleBtnStyle} onClick={() => setShowSig(s => !s)}>
                {showSig ? 'Hide' : 'Show'}
              </button>
            </span>
          </div>
          {showSig && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {significant.map((t: any, i: number) => (
                <TopicCard key={t.topic_id} topic={t} idx={major.length + i} onSelect={onSelect} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Tier 3 — minor (collapsible, default hidden) */}
      {minor.length > 0 && (
        <>
          <div style={tierStyle}>
            <span style={eyebrowStyle}>Smaller topics · &lt;100 articles</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={counterStyle}>{minor.length}</span>
              <button type="button" style={toggleBtnStyle} onClick={() => setShowMinor(s => !s)}>
                {showMinor ? 'Hide' : 'Show'}
              </button>
            </span>
          </div>
          {showMinor && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {minor.map((t: any, i: number) => (
                <TopicCard key={t.topic_id} topic={t} idx={major.length + significant.length + i} onSelect={onSelect} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Enhanced Entity Co-occurrence with Network Visualization
export const EntityCooccurrenceNetwork: React.FC = () => {
  const [entityType, setEntityType] = useState<string>('');
  const [cooccurrences, setCooccurrences] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPair, setExpandedPair] = useState<number | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const loadCooccurrences = async () => {
    setLoading(true);
    setHasLoaded(true);
    try {
      const response = await axios.get(`${API_BASE}/analytics/entity-cooccurrence`, {
        params: {
          entity_type: entityType || undefined,
          min_count: 2,
          limit: 20
        }
      });
      setCooccurrences(response.data.pairs || []);
    } catch (error) {
      console.error('Error loading entity co-occurrences:', error);
      setCooccurrences([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasLoaded) {
      loadCooccurrences();
    }
  }, [entityType]);

  // Adapter from the central entityTypes map → the shape this widget expects.
  // (`icon` is no longer used; kept as '' for back-compat with the JSX below.)
  const ENTITY_TYPE_INFO = new Proxy({} as Record<string, { label: string; icon: string; color: string }>, {
    get: (_t, k: string) => {
      const info = entityInfo(k);
      return { label: info.singular, icon: '', color: info.color };
    },
  });

  return (
    <div className="entity-cooccurrence-network">
      <h3 style={{ marginBottom: '0.5rem' }}>Entity Relationships</h3>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
        Entities that frequently appear together in the same articles — showing connections and relationships
      </p>

      {/* Filter pills */}
      <div style={{
        display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap',
        alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-secondary)',
        borderRadius: '8px', border: '1px solid var(--border-color)'
      }}>
        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Filter by type:</span>
        {[
          { value: '', label: 'All' },
          { value: 'PERSON', label: 'People' },
          { value: 'ORG', label: 'Organizations' },
          { value: 'GPE', label: 'Locations' },
        ].map(opt => {
          const active = entityType === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setEntityType(opt.value)}
              style={{
                padding: '4px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                border: `2px solid ${active ? 'var(--primary-color)' : 'var(--border-color)'}`,
                background: active ? 'var(--primary-color)' : 'var(--bg-primary)',
                color: active ? 'white' : 'var(--text-primary)',
                fontWeight: active ? '600' : '400',
                transition: 'all 0.15s ease',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {!hasLoaded ? (
        <div style={{ textAlign: 'center', padding: '2rem 0' }}>
          <button
            onClick={loadCooccurrences}
            style={{
              padding: '10px 24px',
              fontSize: '14px',
              fontWeight: '600',
              background: 'var(--primary-color)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Load Entity Relationships
          </button>
          <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
            This query scans all 4,200+ articles and may take 1–2 minutes on first load.
          </p>
        </div>
      ) : loading ? (
        <SkeletonChart />
      ) : cooccurrences.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {cooccurrences.map((pair, idx) => {
            const entity1Info = ENTITY_TYPE_INFO[pair.entity1_type] || { label: pair.entity1_type, icon: '', color: '#6b7280' };
            const entity2Info = ENTITY_TYPE_INFO[pair.entity2_type] || { label: pair.entity2_type, icon: '', color: '#6b7280' };
            const isExpanded = expandedPair === idx;
            
            return (
              <div key={idx} style={{ marginBottom: '8px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '16px',
                    background: 'var(--bg-primary)',
                    border: '2px solid var(--border-color)',
                    borderRadius: '10px',
                    gap: '16px',
                    transition: 'all 0.2s',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                    e.currentTarget.style.borderColor = 'var(--primary-color)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                  onClick={() => setExpandedPair(isExpanded ? null : idx)}
                >
                  {/* Rank Badge */}
                  <div style={{
                    minWidth: '36px',
                    height: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--primary-color)',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '700',
                    color: 'white',
                    boxShadow: '0 2px 4px rgba(102,126,234,0.3)'
                  }}>
                    #{idx + 1}
                  </div>

                  {/* Entity 1 */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        background: entity1Info.color,
                        color: 'white',
                        borderRadius: '4px',
                        fontWeight: '600'
                      }}>
                        {entity1Info.label}
                      </span>
                    </div>
                    <div style={{
                      fontSize: '15px',
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}>
                      {pair.entity1}
                    </div>
                  </div>

                  {/* Connection Arrow */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <div style={{
                      fontSize: '20px',
                      color: 'var(--text-tertiary)'
                    }}>
                      ↔️
                    </div>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: '700',
                      color: 'var(--primary-color)',
                      background: '#eff6ff',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      whiteSpace: 'nowrap'
                    }}>
                      {pair.cooccurrence_count} articles
                    </div>
                  </div>

                  {/* Entity 2 */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        background: entity2Info.color,
                        color: 'white',
                        borderRadius: '4px',
                        fontWeight: '600'
                      }}>
                        {entity2Info.label}
                      </span>
                    </div>
                    <div style={{
                      fontSize: '15px',
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}>
                      {pair.entity2}
                    </div>
                  </div>

                  {/* Expand indicator */}
                  <div style={{
                    fontSize: '18px',
                    color: 'var(--text-tertiary)',
                    transition: 'transform 0.2s',
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                  }}>
                    ▼
                  </div>
                </div>

                {/* Relationship Evidence - Expanded Section */}
                {isExpanded && pair.examples && pair.examples.length > 0 && (
                  <div style={{
                    marginTop: '8px',
                    padding: '16px',
                    background: 'var(--bg-secondary)',
                    border: '2px solid var(--border-color)',
                    borderRadius: '8px'
                  }}>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      Evidence of Relationship ({pair.examples.length} example{pair.examples.length > 1 ? 's' : ''})
                    </div>
                    {pair.examples.map((example: any, exIdx: number) => (
                      <div
                        key={exIdx}
                        style={{
                          padding: '12px',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          marginBottom: exIdx < pair.examples.length - 1 ? '10px' : '0',
                          fontSize: '13px',
                          lineHeight: '1.6'
                        }}
                      >
                        <div style={{
                          fontWeight: '600',
                          color: '#1e40af',
                          marginBottom: '6px',
                          fontSize: '12px'
                        }}>
                          {example.headline}
                        </div>
                        <div style={{
                          color: 'var(--text-secondary)',
                          fontStyle: 'italic',
                          background: '#fef3c7',
                          padding: '8px',
                          borderRadius: '4px',
                          borderLeft: '3px solid #f59e0b'
                        }}>
                          {example.context}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{
          padding: '40px 20px',
          textAlign: 'center',
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          border: '1px dashed var(--border-color)'
        }}>
          <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)' }}>
            No Entity Relationships Found
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Try selecting a different entity type or add more articles to the database
          </div>
        </div>
      )}
    </div>
  );
};

// Coverage Heatmap - Shows publication intensity by month
export const CoverageHeatmap: React.FC = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const { data: raw, loading } = useAnalyticsCache('coverage_heatmap', async () => {
    const response = await axios.get(`${API_BASE}/analytics/articles-over-time`);
    return response.data.timeline || [];
  });
  const data: any[] = raw || [];

  if (loading) return <SkeletonChart />;
  if (data.length === 0) return (
    <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
      <strong>No coverage data available.</strong>
    </div>
  );

  const maxCount = Math.max(...data.map((d: any) => d.count));

  return (
    <div ref={chartRef}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>Coverage Intensity</h3>
        <ChartExportButton targetRef={chartRef} filenamePrefix="mediascope-coverage" />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
        {data.map((item, idx) => {
          const intensity = item.count / maxCount;
          const bgColor = `rgba(79, 70, 229, ${intensity * 0.85 + 0.08})`;

          return (
            <div
              key={idx}
              style={{
                minWidth: '68px',
                padding: '7px 8px',
                background: bgColor,
                borderRadius: '6px',
                textAlign: 'center',
                color: intensity > 0.5 ? 'white' : 'var(--text-primary)',
                fontWeight: 500,
                fontSize: '12px'
              }}
              title={`${item.count} articles`}
            >
              <div>{item.month}</div>
              <div style={{ fontSize: '14px', fontWeight: 700, marginTop: '2px' }}>{item.count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Topic Trends Over Time - Shows how topic prevalence changes.
// Vintage palette to match the newspaper-themed UI: sepia, rust,
// faded gold, dusty rose — 15 muted hues that still read distinctly
// without screaming "modern dashboard".
const TOPIC_COLORS = [
  '#8b3a1f', '#a87a3e', '#5a7a3e', '#3b2a1c', '#7a4a2c',
  '#c47b5a', '#a89378', '#6e5a3a', '#9c5a3c', '#8a7a62',
  '#b8946a', '#765538', '#a23a2c', '#5a4a2c', '#c8a574',
];

// Human-readable names for known topic labels
const TOPIC_NAME_MAP: Record<string, string> = {
  '00_kgs_grams_oil_40 kgs':                                  'Commodities',
  '21_rs 21_rates_buying_selling':                             'Currency Rates',
  '66_67_closing_cotton_fri':                                  'Cotton Market',
  'airconditioning_car_airconditioners_installation_sunny':    'Appliances',
  'arab_israel_iran_syria_iraq':                               'Middle East',
  'artistes_exhibition_arts_paintings_council':                'Arts & Culture',
  'billion_tax_cent_budget_programme':                         'Budget & Tax',
  'car_contact_suzuki_toyota_model':                           'Automotive',
  'cargo_containers_tons_ships_general cargo':                 'Shipping & Cargo',
  'company_directors_general meeting_dividend_year ended':     'Corporate Finance',
  'computer_ibm_machines_quotations_machinery':                'Technology',
  'correspond_clue_black_panel_numbers':                       'Crossword / Puzzles',
  'cotton_bids_bid_seed_ginning':                              'Cotton Trade',
  'doctors_strike_newspaper_patients_protest':                 'Medical Strike',
  'dollar_yen_japanese_japan_cent':                            'Foreign Exchange',
  'dollars_afternoon_kerb_thursday_gold':                      'Forex & Gold',
  'driving_pick drop_instructors_metropole_drop':              'Transport',
  'experience_candidates_applications_apply_years experience': 'Job Listings',
  'fumigation_proofing_tank cleaning_termite_water tank':      'Pest Control',
  'imf_countries_debt_gold_nations':                           'IMF & Debt',
  'iv_ii_results_intermediate_examination':                    'Exam Results',
  'match_cricket_team_final_england':                          'Cricket',
  'mep_export price_price_minimum_export':                     'Export Policy',
  'mqm_kashmir_ppp_sindh_minister':                            'Sindh Politics',
  'mujahideen_sri_kabul_regime_tanai':                         'Afghanistan',
  'news_00 news_35_katrak_transmission':                       'Media / Radio',
  'notice_claim_objection_shall_person':                       'Legal Notices',
  'nuclear_company_radiation_ray_paec':                        'Nuclear (PAEC)',
  'nuclear_french_eec_plant_chamber':                          'Nuclear Energy',
  'oil_opec_petroleum_uae_kuwait':                             'Oil & OPEC',
  'police_injured_shot_dead_killed':                           'Crime & Violence',
  'power_generation_electricity_energy_conservation':          'Electricity & Energy',
  'quality_productivity_process_improvement_continuous':       'Industry',
  'radio_soyem_held_imam_death':                               'Obituaries',
  'refrigerators_household_vcr_airconditioners_cookers':       'Electronics',
  'science_education_university_teaching_educational':         'Science & Education',
  'shares_paisa_modaraba_market_investors':                    'Stock Market',
  'soviet_union_soviet union_europe_gorbachev':                'Soviet Union',
  'students_teachers_schools_college_university':              'Schools & Teachers',
  'technology_hmc_cad_cam_engineering':                        'Engineering',
  'telephone_bills_subscribers_exchange_dates':                'Telecom',
  'tender_tenders_90_earnest money_earnest':                   'Tenders',
  'water_kwsb_supply_areas_colony':                            'Water Supply',
  'wheat_tons_million tons_port_stocks':                       'Wheat & Food',
  'women_health_motherhood_safe motherhood_safe':              "Women's Health",
  'yards_defence_clifton_estate_phone':                        'Real Estate',
};

// Readable name: use map first, then smart fallback
const toReadableTopicName = (raw: string): string => {
  if (TOPIC_NAME_MAP[raw]) return TOPIC_NAME_MAP[raw];
  const seen = new Set<string>();
  const words = raw.split('_')
    .filter(w => w.length > 1 && !/^\d+$/.test(w))
    .filter(w => { if (seen.has(w.toLowerCase())) return false; seen.add(w.toLowerCase()); return true; })
    .map(w => w.charAt(0).toUpperCase() + w.slice(1));
  return words.slice(0, 2).join(' ') || raw;
};

export const TopicTrendsOverTime: React.FC = () => {
  const [rawData, setRawData] = useState<any[]>([]);
  const [allTopics, setAllTopics] = useState<{ raw: string; label: string; total: number }[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'year' | 'month' | 'day'>('month');
  // Pull the actual corpus span from /data-version. Defaulting these to
  // empty strings caused the browser <input type="date"> to render
  // "today" (May 4, 2026), and querying that range returned empty —
  // hence the "No trend data available" placeholder.
  const [minBound, maxBound] = useDateBounds();
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  // Auto-fill the pickers once the bounds resolve, but only if the
  // user hasn't manually typed in them.
  useEffect(() => {
    if (minBound && !startDate) setStartDate(minBound);
    if (maxBound && !endDate) setEndDate(maxBound);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minBound, maxBound]);

  const loadTrends = async () => {
    setLoading(true);
    try {
      const params: any = { granularity };
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const response = await axios.get(`${API_BASE}/topics/trends-over-time`, { params });
      const trendsData = response.data.trends || [];

      // Tally total articles per topic across all periods.
      // Filter out (a) placeholder "Topic 10000" labels that come from
      // legacy BERTopic clusters never replaced with real names, and
      // (b) Tenders & Classifieds + Job Listings, which dominate the
      // chart but aren't editorial content the user wants to track.
      const HIDE_TOPICS = new Set([
        'tenders & classifieds',
        'job listings',
        'legal notices',
        'obituaries & condolences',
        'puzzles & crosswords',
        'other / uncategorised',
        'other / uncategorized',
        'uncategorized',
        'uncategorised',
      ]);
      const isPlaceholder = (name: string) => /^topic\s*\d{3,}$/i.test(name.trim());
      const topicTotals: Record<string, number> = {};
      trendsData.forEach((periodData: any) => {
        periodData.topics.forEach((topic: any) => {
          const name = (topic.topic_name || '').trim();
          if (!name) return;
          if (isPlaceholder(name)) return;
          if (HIDE_TOPICS.has(name.toLowerCase())) return;
          topicTotals[name] = (topicTotals[name] || 0) + topic.count;
        });
      });

      // Sort topics by total article count descending
      const sortedTopics = Object.entries(topicTotals)
        .sort((a, b) => b[1] - a[1])
        .map(([raw, total]) => ({ raw, label: toReadableTopicName(raw), total }));

      // Transform to recharts format: one object per period
      const allTopicNames = new Set(sortedTopics.map(t => t.raw));
      const transformed = trendsData.map((periodData: any) => {
        const point: any = { period: periodData.period };
        allTopicNames.forEach(name => { point[name] = 0; });
        periodData.topics.forEach((topic: any) => {
          if (topic.topic_name) point[topic.topic_name] = topic.count;
        });
        return point;
      });

      setAllTopics(sortedTopics);
      setRawData(transformed);
      // Pre-select the top 3 topics
      setSelectedTopics(new Set(sortedTopics.slice(0, 3).map(t => t.raw)));
    } catch (error) {
      console.error('Failed to load topic trends:', error);
      setRawData([]);
      setAllTopics([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTrends(); }, [granularity, startDate, endDate]);

  const toggleTopic = (raw: string) => {
    setSelectedTopics(prev => {
      const next = new Set(prev);
      if (next.has(raw)) next.delete(raw);
      else next.add(raw);
      return next;
    });
  };

  const selectedList = allTopics.filter(t => selectedTopics.has(t.raw));

  if (loading) return <SkeletonChart />;

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Topic Trends Over Time</h3>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
        Select topics below to compare how they rise and fall over time
      </p>

      {/* Controls row */}
      <div style={{
        display: 'flex', gap: '1rem', marginBottom: '1rem',
        flexWrap: 'wrap', alignItems: 'center',
        padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderRadius: '8px'
      }}>
        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: 'var(--text-primary)' }}>Granularity:</label>
          <select value={granularity} onChange={(e) => setGranularity(e.target.value as any)}
            style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', background: 'var(--bg-primary)' }}>
            <option value="year">Yearly</option>
            <option value="month">Monthly</option>
            <option value="day">Daily</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: 'var(--text-primary)' }}>From:</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', background: 'var(--bg-primary)' }} />
        </div>
        <div>
          <label style={{ fontSize: '13px', fontWeight: '600', marginRight: '8px', color: 'var(--text-primary)' }}>To:</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', background: 'var(--bg-primary)' }} />
        </div>
        {(startDate || endDate) && (
          <button onClick={() => { setStartDate(''); setEndDate(''); }}
            style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', fontSize: '13px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            Clear
          </button>
        )}
      </div>

      {rawData.length === 0 ? (
        <div style={{ margin: '2rem 0', padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
          <strong>No trend data available.</strong><br />
          Articles don't have topic labels assigned. Upload newspapers and run topic extraction to see trends.
        </div>
      ) : (
        <>
          {/* Topic picker */}
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                Topics ({selectedTopics.size} selected)
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setSelectedTopics(new Set(allTopics.slice(0, 5).map(t => t.raw)))}
                  style={{ padding: '3px 10px', borderRadius: '5px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', fontSize: '12px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                  Top 5
                </button>
                <button onClick={() => setSelectedTopics(new Set())}
                  style={{ padding: '3px 10px', borderRadius: '5px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', fontSize: '12px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                  Clear all
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {allTopics.map((topic, idx) => {
                const active = selectedTopics.has(topic.raw);
                const color = TOPIC_COLORS[allTopics.findIndex(t => t.raw === topic.raw) % TOPIC_COLORS.length];
                return (
                  <button key={topic.raw} onClick={() => toggleTopic(topic.raw)}
                    title={topic.raw.replace(/_/g, ' ')}
                    style={{
                      padding: '4px 10px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                      border: `2px solid ${active ? color : 'var(--border-color)'}`,
                      background: active ? color : 'var(--bg-primary)',
                      color: active ? 'white' : 'var(--text-primary)',
                      fontWeight: active ? '600' : '400',
                      transition: 'all 0.15s ease',
                    }}>
                    {topic.label}
                    <span style={{ marginLeft: '5px', opacity: 0.75, fontSize: '11px' }}>
                      {topic.total}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chart */}
          {selectedList.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px', border: '2px dashed var(--border-color)', borderRadius: '8px' }}>
              Select one or more topics above to see their trend lines
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={420}>
              <BarChart data={rawData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: 'Articles', angle: -90, position: 'insideLeft', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '12px' }}
                  formatter={(value: any, name: string | undefined) => [value, name ? toReadableTopicName(name) : name]}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                  formatter={(value) => toReadableTopicName(value)}
                />
                {selectedList.map((topic) => {
                  const colorIdx = allTopics.findIndex(t => t.raw === topic.raw) % TOPIC_COLORS.length;
                  return (
                    <Bar
                      key={topic.raw}
                      dataKey={topic.raw}
                      stackId="a"
                      fill={TOPIC_COLORS[colorIdx]}
                      name={topic.raw}
                    />
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  );
};

// Topic Sentiment Over Time - Track sentiment changes for topics
export const TopicSentimentOverTime: React.FC = () => {
  const [rawData, setRawData] = useState<any[]>([]);
  const [topics, setTopics] = useState<any[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'year' | 'month' | 'day'>('month');

  // Vintage palette (mirrors TOPIC_COLORS) so per-keyword sentiment
  // lines blend with the newspaper aesthetic instead of fighting it.
  const SENT_COLORS = ['#8b3a1f', '#a87a3e', '#5a7a3e', '#3b2a1c', '#7a4a2c', '#c47b5a', '#a89378', '#6e5a3a', '#9c5a3c', '#8a7a62'];

  // Load topics list
  useEffect(() => {
    const fetchTopics = async () => {
      try {
        const response = await axios.get(`${API_BASE}/topics/`);
        // Same hide-list as TopicTrendsOverTime: skip placeholder
        // "Topic 10000" labels and the non-editorial buckets
        // (tenders, jobs, legal notices, obituaries) so the chart
        // shows real news topics, not classifieds noise.
        const HIDE_TOPICS = new Set([
          'tenders & classifieds',
          'job listings',
          'legal notices',
          'obituaries & condolences',
          'puzzles & crosswords',
          'other / uncategorised',
          'other / uncategorized',
          'uncategorized',
          'uncategorised',
        ]);
        const isPlaceholder = (n: string) => /^topic\s*\d{3,}$/i.test((n || '').trim());
        const loaded = (response.data.topics || [])
          .filter((t: any) => t.count >= 30)
          .filter((t: any) => !isPlaceholder(t.name || t.label || ''))
          .filter((t: any) => !HIDE_TOPICS.has(((t.name || t.label || '') as string).toLowerCase()));
        setTopics(loaded);
        // Pre-select top 3
        setSelectedTopicIds(new Set(loaded.slice(0, 3).map((t: any) => t.topic_id as number)));
      } catch (error) {
        console.error('Failed to load topics:', error);
      }
    };
    fetchTopics();
  }, []);

  // Load all sentiment data (no topic_id filter — filter client-side)
  const loadSentiment = async () => {
    setLoading(true);
    try {
      const params: any = { granularity };
      const response = await axios.get(`${API_BASE}/topics/sentiment-over-time`, { params });
      const trends = response.data.trends || [];

      // Build a flat map: period -> { topic_id -> avg_sentiment }
      const chartData = trends.map((period: any) => {
        const dataPoint: any = { period: period.period };
        period.topics.forEach((topic: any) => {
          dataPoint[`t_${topic.topic_id}`] = topic.avg_sentiment;
        });
        return dataPoint;
      });

      setRawData(chartData);
    } catch (error) {
      console.error('Failed to load topic sentiment:', error);
      setRawData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSentiment();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity]);

  const toggleTopic = (id: number) => {
    setSelectedTopicIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedList = topics.filter(t => selectedTopicIds.has(t.topic_id));

  if (loading) return <SkeletonChart />;

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Topic Sentiment Over Time</h3>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
        Track how sentiment changes for each topic over time — select topics to compare
      </p>

      {/* Granularity control bar */}
      <div style={{
        display: 'flex', gap: '1rem', marginBottom: '1rem',
        flexWrap: 'wrap', alignItems: 'center',
        padding: '0.75rem 1rem', background: 'var(--bg-secondary)',
        borderRadius: '8px', border: '1px solid var(--border-color)'
      }}>
        <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Granularity:</label>
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as 'year' | 'month' | 'day')}
          style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', background: 'var(--bg-primary)' }}
        >
          <option value="year">Yearly</option>
          <option value="month">Monthly</option>
          <option value="day">Daily</option>
        </select>
      </div>

      {rawData.length === 0 ? (
        <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
          <strong>No sentiment data available.</strong><br />
          Make sure topics are trained and articles have sentiment scores.
        </div>
      ) : (
        <>
          {/* Topic pill picker */}
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                Topics ({selectedTopicIds.size} selected)
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setSelectedTopicIds(new Set(topics.slice(0, 3).map(t => t.topic_id)))}
                  style={{ padding: '3px 10px', borderRadius: '5px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', fontSize: '12px', cursor: 'pointer', color: 'var(--text-primary)' }}
                >
                  Top 3
                </button>
                <button
                  onClick={() => setSelectedTopicIds(new Set())}
                  style={{ padding: '3px 10px', borderRadius: '5px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', fontSize: '12px', cursor: 'pointer', color: 'var(--text-secondary)' }}
                >
                  Clear all
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {topics.map((topic, idx) => {
                const active = selectedTopicIds.has(topic.topic_id);
                const color = SENT_COLORS[idx % SENT_COLORS.length];
                const label = toReadableTopicName(topic.keywords?.[0] || `Topic ${topic.topic_id}`);
                return (
                  <button
                    key={topic.topic_id}
                    onClick={() => toggleTopic(topic.topic_id)}
                    title={topic.keywords?.join(', ')}
                    style={{
                      padding: '4px 10px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                      border: `2px solid ${active ? color : 'var(--border-color)'}`,
                      background: active ? color : 'var(--bg-primary)',
                      color: active ? 'white' : 'var(--text-primary)',
                      fontWeight: active ? '600' : '400',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {label}
                    <span style={{ marginLeft: '5px', opacity: 0.75, fontSize: '11px' }}>{topic.count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedList.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px', border: '2px dashed var(--border-color)', borderRadius: '8px' }}>
              Select one or more topics above to see their sentiment lines
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={420}>
              <LineChart data={rawData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" height={70} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  domain={[-1, 1]}
                  label={{ value: 'Avg Sentiment', angle: -90, position: 'insideLeft', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '12px' }}
                  formatter={(value: any, name?: string) => {
                    if (name && name.startsWith('t_')) {
                      const tid = parseInt(name.replace('t_', ''));
                      const t = topics.find(t => t.topic_id === tid);
                      const label = t ? toReadableTopicName(t.keywords?.[0] || `Topic ${tid}`) : name;
                      return [typeof value === 'number' ? value.toFixed(3) : value, label];
                    }
                    return [value, name];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                  formatter={(value) => {
                    if (value && value.startsWith('t_')) {
                      const tid = parseInt(value.replace('t_', ''));
                      const t = topics.find(t => t.topic_id === tid);
                      return t ? toReadableTopicName(t.keywords?.[0] || `Topic ${tid}`) : value;
                    }
                    return value;
                  }}
                />
                {selectedList.map((topic) => {
                  const color = SENT_COLORS[topics.findIndex(t => t.topic_id === topic.topic_id) % SENT_COLORS.length];
                  return (
                    <Line
                      key={topic.topic_id}
                      type="monotone"
                      dataKey={`t_${topic.topic_id}`}
                      stroke={color}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      name={`t_${topic.topic_id}`}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  );
};

// Entity Sentiment Over Time - Track sentiment for specific entities
export const EntitySentimentOverTime: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [entity, setEntity] = useState<string>('Pakistan');
  const [topEntities, setTopEntities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'year' | 'month' | 'day'>('month');

  // Load top entities
  useEffect(() => {
    const fetchEntities = async () => {
      try {
        const response = await axios.get(`${API_BASE}/analytics/top-entities-fixed?limit=20`);
        const entities = response.data.entities || [];
        const uniqueEntities: string[] = Array.from(new Set(entities.map((e: any) => e.text as string)));
        setTopEntities(uniqueEntities);
        if (uniqueEntities.length > 0 && !entity) {
          setEntity(uniqueEntities[0]);
        }
      } catch (error) {
        console.error('Failed to load entities:', error);
      }
    };
    fetchEntities();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load sentiment data
  const loadSentiment = async () => {
    if (!entity) return;
    setLoading(true);
    try {
      const params: any = { entity, granularity };
      const response = await axios.get(`${API_BASE}/analytics/entity-sentiment-over-time`, { params });
      const trends = response.data.data || [];
      setData(trends.map((t: any) => ({
        period: t.date,
        sentiment: t.sentiment_score,
        count: t.count
      })));
    } catch (error) {
      console.error('Failed to load entity sentiment:', error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (entity) {
      loadSentiment();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, entity]);

  if (loading) return <SkeletonChart />;

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Entity Sentiment Over Time</h3>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
        Track sentiment changes for a specific entity — click a pill to switch entities
      </p>

      {/* Control bar: granularity */}
      <div style={{
        display: 'flex', gap: '1rem', marginBottom: '1rem',
        flexWrap: 'wrap', alignItems: 'center',
        padding: '0.75rem 1rem', background: 'var(--bg-secondary)',
        borderRadius: '8px', border: '1px solid var(--border-color)'
      }}>
        <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Granularity:</label>
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as 'year' | 'month' | 'day')}
          style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', background: 'var(--bg-primary)' }}
        >
          <option value="year">Yearly</option>
          <option value="month">Monthly</option>
          <option value="day">Daily</option>
        </select>
      </div>

      {/* Entity pill picker */}
      {topEntities.length > 0 && (
        <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.6rem' }}>
            Select entity:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {topEntities.map(ent => {
              const active = entity === ent;
              return (
                <button
                  key={ent}
                  onClick={() => setEntity(ent)}
                  style={{
                    padding: '4px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                    border: `2px solid ${active ? 'var(--primary-color)' : 'var(--border-color)'}`,
                    background: active ? 'var(--primary-color)' : 'var(--bg-primary)',
                    color: active ? 'white' : 'var(--text-primary)',
                    fontWeight: active ? '600' : '400',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {ent}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Chart */}
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" height={70} />
            <YAxis
              tick={{ fontSize: 11 }}
              domain={[-1, 1]}
              label={{ value: 'Avg Sentiment', angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '12px' }}
              formatter={(value: any, name?: string) => {
                if (name === 'sentiment') return [typeof value === 'number' ? value.toFixed(3) : value, 'Sentiment'];
                return [value, 'Articles'];
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Line
              type="monotone"
              dataKey="sentiment"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
              name={`${entity} Sentiment`}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
          <strong>No sentiment data available for this entity.</strong>
        </div>
      )}
    </div>
  );
};

// Keyword Sentiment Over Time - Track sentiment for keywords
export const KeywordSentimentOverTime: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [keyword, setKeyword] = useState<string>('election');
  const [inputValue, setInputValue] = useState<string>('election');
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'year' | 'month' | 'day'>('month');

  const QUICK_KEYWORDS = ['election', 'karachi', 'pakistan', 'india', 'kashmir', 'economy', 'government', 'army', 'war', 'cricket'];

  // Load sentiment data
  const loadSentiment = async (kw?: string) => {
    const searchKw = kw !== undefined ? kw : keyword;
    if (!searchKw) return;

    setLoading(true);
    try {
      const params: any = { keyword: searchKw, granularity };
      const response = await axios.get(`${API_BASE}/analytics/keyword-sentiment-over-time`, { params });
      const trends = response.data.trends || [];
      setData(trends.map((t: any) => ({
        period: t.period,
        sentiment: t.avg_sentiment,
        count: t.article_count
      })));
    } catch (error) {
      console.error('Failed to load keyword sentiment:', error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSentiment();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, keyword]);

  const handleSearch = () => {
    setKeyword(inputValue.trim());
  };

  const handlePillClick = (kw: string) => {
    setInputValue(kw);
    setKeyword(kw);
  };

  if (loading) return <SkeletonChart />;

  return (
    <div>
      <h3 style={{ marginBottom: '0.5rem' }}>Keyword Sentiment Over Time</h3>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
        Track sentiment changes for specific keywords across the archive
      </p>

      {/* Control bar */}
      <div style={{
        display: 'flex', gap: '1rem', marginBottom: '1rem',
        flexWrap: 'wrap', alignItems: 'center',
        padding: '0.75rem 1rem', background: 'var(--bg-secondary)',
        borderRadius: '8px', border: '1px solid var(--border-color)'
      }}>
        <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Keyword:</label>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          placeholder="Enter keyword..."
          style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', background: 'var(--bg-primary)', minWidth: '160px' }}
        />
        <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Granularity:</label>
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as 'year' | 'month' | 'day')}
          style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', background: 'var(--bg-primary)' }}
        >
          <option value="year">Yearly</option>
          <option value="month">Monthly</option>
          <option value="day">Daily</option>
        </select>
        <button
          onClick={handleSearch}
          style={{
            padding: '5px 16px', borderRadius: '6px', border: 'none',
            background: 'var(--primary-color)', color: 'white',
            fontSize: '13px', fontWeight: '600', cursor: 'pointer'
          }}
        >
          Search
        </button>
      </div>

      {/* Quick-select keyword pills */}
      <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Quick select:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {QUICK_KEYWORDS.map(kw => {
            const active = keyword === kw;
            return (
              <button
                key={kw}
                onClick={() => handlePillClick(kw)}
                style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                  border: `2px solid ${active ? '#10b981' : 'var(--border-color)'}`,
                  background: active ? '#10b981' : 'var(--bg-primary)',
                  color: active ? 'white' : 'var(--text-primary)',
                  fontWeight: active ? '600' : '400',
                  transition: 'all 0.15s ease',
                }}
              >
                {kw}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" height={70} />
            <YAxis
              tick={{ fontSize: 11 }}
              domain={[-1, 1]}
              label={{ value: 'Avg Sentiment', angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '12px' }}
              formatter={(value: any, name?: string) => {
                if (name === 'sentiment') return [typeof value === 'number' ? value.toFixed(3) : value, 'Sentiment'];
                return [value, 'Articles'];
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Line
              type="monotone"
              dataKey="sentiment"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
              name={`"${keyword}" Sentiment`}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ padding: '2rem', background: '#fef3c7', borderRadius: '8px', textAlign: 'center', fontSize: '13px' }}>
          <strong>No sentiment data available for this keyword.</strong>
        </div>
      )}
    </div>
  );
};
