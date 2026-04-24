/**
 * AnalyticsCharts — historically held three charts; only ArticlesOverTime is
 * still wired up. The other two (SentimentOverTime / TopKeywordsCloud) were
 * orphaned and have been removed; their concerns live in better widgets:
 *   - sentiment-over-time → SentimentDistribution + EnhancedAnalytics charts
 *   - top-keywords cloud  → InteractiveKeywords (search + drill)
 */
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, ReferenceLine, Legend, Bar
} from 'recharts';
import { API_BASE } from '../config';
import { SkeletonChart } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import { HISTORICAL_EVENTS, EVENT_COLORS } from '../data/historicalEvents';
import { chartColors } from '../theme/chartColors';

interface ArticlesOverTimeProps {
  /**
   * Drill-through: fired when the user clicks a month bar. The dashboard
   * wires this to pin a date-range filter on the search view.
   */
  onMonthClick?: (month: string) => void;
}

export const ArticlesOverTime: React.FC<ArticlesOverTimeProps> = ({ onMonthClick }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showAvg, setShowAvg] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await axios.get(`${API_BASE}/analytics/articles-over-time`);
        setData(response.data.timeline || []);
      } catch (error) {
        console.error('Failed to load articles over time:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Compute the corpus average + map historical events to the months we have.
  const { avg, eventsForChart } = useMemo(() => {
    if (!data.length) return { avg: 0, eventsForChart: [] };
    const total = data.reduce((s, d) => s + (d.count || 0), 0);
    const monthsPresent = new Set(data.map(d => d.month));
    const events = HISTORICAL_EVENTS
      .map(e => ({ ...e, month: e.date.slice(0, 7) }))
      .filter(e => monthsPresent.has(e.month));
    return { avg: Math.round(total / data.length), eventsForChart: events };
  }, [data]);

  if (loading) return <SkeletonChart />;
  if (data.length === 0) return <EmptyState title="No publication data available" />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Articles Published Over Time</h3>
        <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={showAvg} onChange={e => setShowAvg(e.target.checked)} />
            Monthly avg
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={showEvents} onChange={e => setShowEvents(e.target.checked)} />
            Historical events
          </label>
        </div>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '8px 0 16px 0' }}>
        Monthly publication volume{showAvg ? ` · avg ${avg.toLocaleString()}/month` : ''}{showEvents && eventsForChart.length ? ` · ${eventsForChart.length} historical events overlaid` : ''}
      </p>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={data} margin={{ top: 30, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
          <XAxis dataKey="month" stroke="var(--text-secondary)" fontSize={12} />
          <YAxis stroke="var(--text-secondary)" fontSize={12} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6 }}
            content={({ active, payload, label }: any) => {
              if (!active || !payload?.length) return null;
              const evs = showEvents ? eventsForChart.filter(e => e.month === label) : [];
              return (
                <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, padding: 8, fontSize: 12 }}>
                  <div style={{ fontWeight: 600 }}>{label}</div>
                  <div>{(payload[0]?.value ?? 0).toLocaleString()} articles</div>
                  {evs.map((e, i) => (
                    <div key={i} style={{ marginTop: 4, color: EVENT_COLORS[e.category] }}>
                      ● {e.label} <span style={{ color: 'var(--text-tertiary)' }}>({e.date})</span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Legend />
          <Bar
            dataKey="count"
            fill={chartColors.primary}
            name="Articles"
            onClick={onMonthClick ? (e: any) => onMonthClick(String(e?.payload?.month || '')) : undefined}
            style={onMonthClick ? { cursor: 'pointer' } : undefined}
          />
          {showAvg && (
            <ReferenceLine y={avg} stroke={chartColors.axisLabel} strokeDasharray="4 4" label={{ value: 'avg', fill: chartColors.axisLabel, fontSize: 11, position: 'right' }} />
          )}
          {showEvents && eventsForChart.map((e, i) => (
            <ReferenceLine
              key={i}
              x={e.month}
              stroke={EVENT_COLORS[e.category]}
              strokeDasharray="2 4"
              label={{
                value: e.label,
                position: 'top',
                fill: EVENT_COLORS[e.category],
                fontSize: 10,
                offset: 6 + ((i % 3) * 12), // stagger to avoid overlap
              }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

