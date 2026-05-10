/**
 * CalendarHeatmap — GitHub-style day-grid showing publication intensity.
 *
 * One block per year, each block being a 7×N grid where:
 *   - Rows = days of the week (Sun..Sat)
 *   - Columns = ISO weeks
 *   - Cell color = log-scaled article count
 *
 * Click a cell to filter the search view to that exact date (caller decides
 * what to do via the optional `onDayClick` prop).
 *
 * Data source: /api/analytics/articles-by-day
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertCircle, Calendar } from 'lucide-react';
import { API_BASE } from '../config';
import { SkeletonChart } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';

interface Day { date: string; count: number; }
interface Resp { days: Day[]; total: number; }

interface Props {
  onDayClick?: (date: string, count: number) => void;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function parseISO(d: string): Date {
  // Treat as UTC date (no time component) so rendering is stable across TZ.
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function isoForDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function colorFor(count: number, max: number): string {
  // Even zero-article days get a faint tint so empty cells blend with low-volume
  // ones rather than reading as data gaps.
  if (count === 0) return 'rgba(79, 70, 229, 0.08)';
  // Log scale so a few high-volume days don't wash out the rest.
  const intensity = Math.log10(1 + count) / Math.log10(1 + max);
  // Lifted floor (was 0.15) so low-volume days sit closer to the rest of the ramp.
  const alpha = 0.32 + intensity * 0.68;
  return `rgba(79, 70, 229, ${alpha.toFixed(3)})`;
}

const CalendarHeatmap: React.FC<Props> = ({ onDayClick }) => {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios.get(`${API_BASE}/analytics/articles-by-day`)
      .then(r => { if (!cancelled) { setData(r.data); setLoading(false); } })
      .catch(err => { if (!cancelled) { setError(err?.message || 'Failed to load'); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const yearGroups = useMemo(() => {
    if (!data?.days?.length) return [];
    const byYear = new Map<number, Map<string, number>>();
    let max = 0;
    for (const d of data.days) {
      const year = parseInt(d.date.slice(0, 4), 10);
      if (!byYear.has(year)) byYear.set(year, new Map());
      byYear.get(year)!.set(d.date, d.count);
      if (d.count > max) max = d.count;
    }
    const years = Array.from(byYear.keys()).sort();
    return years.map(year => ({ year, days: byYear.get(year)!, max }));
  }, [data]);

  if (loading) return <SkeletonChart />;
  if (error) return <EmptyState icon={<AlertCircle size={28} aria-hidden />} title="Couldn't load coverage" description={error} />;
  if (!yearGroups.length) return <EmptyState icon={<Calendar size={28} aria-hidden />} title="No coverage to chart" description="No publication dates have been indexed for this corpus yet — once they are, the year grid will fill in here." />;

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Coverage Calendar</div>
        <div className="section-eyebrow" style={{ marginBottom: 0 }}>
          {data!.total.toLocaleString()} articles · click any day to drill in
        </div>
      </div>
      <p className="chart-caption">
        One cell per day; darker = more articles published.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {yearGroups.map(({ year, days, max }) => {
          // Build a 7-row grid spanning the year's actual coverage window. Trim
          // the grid to the last month with data so years that are only partly
          // in scope (e.g. Jan 1991) don't render long stretches of empty cells.
          const start = new Date(Date.UTC(year, 0, 1));
          let lastMonthWithData = 11;
          for (let m = 11; m >= 0; m--) {
            const monthStart = new Date(Date.UTC(year, m, 1));
            const monthEnd = new Date(Date.UTC(year, m + 1, 0));
            let hasAny = false;
            for (let d = new Date(monthStart); d <= monthEnd; d = new Date(d.getTime() + 86400000)) {
              if ((days.get(isoForDate(d)) ?? 0) > 0) { hasAny = true; break; }
            }
            if (hasAny) { lastMonthWithData = m; break; }
            if (m === 0) lastMonthWithData = 0;
          }
          const end = new Date(Date.UTC(year, lastMonthWithData + 1, 0));
          const cells: { date: Date; count: number }[] = [];
          // Pad leading days so column-0 is always a Sunday.
          const startDay = start.getUTCDay();
          for (let i = 0; i < startDay; i++) cells.push({ date: new Date(NaN), count: -1 });
          for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
            const iso = isoForDate(d);
            cells.push({ date: new Date(d), count: days.get(iso) ?? 0 });
          }

          const weeks: { date: Date; count: number }[][] = [];
          for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

          // Compute month-label x-positions: first column where each new month appears.
          const monthCols: { month: number; col: number }[] = [];
          let lastMonth = -1;
          weeks.forEach((week, col) => {
            const firstReal = week.find(c => !isNaN(c.date.getTime()));
            if (firstReal) {
              const m = firstReal.date.getUTCMonth();
              if (m !== lastMonth) {
                monthCols.push({ month: m, col });
                lastMonth = m;
              }
            }
          });

          const cell = 11; // px
          const gap = 2;
          const stride = cell + gap;
          const gridWidth = weeks.length * stride;

          return (
            <div key={year} className="heatmap-year">
              <div className="heatmap-year__label">{year}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div
                  aria-hidden
                  style={{
                    display: 'flex', flexDirection: 'column',
                    fontSize: 9, color: 'var(--text-tertiary)',
                    paddingTop: 14, gap,
                  }}
                >
                  {DAY_LABELS.map((l, i) => (
                    <div key={i} style={{ height: cell, lineHeight: `${cell}px` }}>{l}</div>
                  ))}
                </div>
                <div>
                  <div
                    style={{
                      position: 'relative', height: 12, marginBottom: 2,
                      width: gridWidth, fontSize: 9, color: 'var(--text-tertiary)',
                    }}
                  >
                    {monthCols.map(({ month, col }) => (
                      <span
                        key={month}
                        style={{ position: 'absolute', left: col * stride, top: 0 }}
                      >
                        {MONTH_LABELS[month]}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap }}>
                    {weeks.map((week, wi) => (
                      <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap }}>
                        {week.map((c, di) => {
                          if (isNaN(c.date.getTime())) {
                            return <div key={di} style={{ width: cell, height: cell }} />;
                          }
                          const iso = isoForDate(c.date);
                          return (
                            <button
                              key={di}
                              onClick={() => onDayClick?.(iso, c.count)}
                              title={`${iso}: ${c.count} article${c.count === 1 ? '' : 's'}`}
                              style={{
                                width: cell, height: cell,
                                border: 0, padding: 0,
                                borderRadius: 2,
                                background: colorFor(c.count, max),
                                cursor: c.count > 0 ? 'pointer' : 'default',
                              }}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="heatmap-legend">
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const max = yearGroups[0]?.max || 1;
          return (
            <div
              key={t}
              style={{
                width: 11, height: 11, borderRadius: 2,
                background: colorFor(t === 0 ? 0 : Math.round(t * max), max),
              }}
            />
          );
        })}
        <span>More</span>
      </div>
    </div>
  );
};

// Suppress unused warning for parseISO (kept for callers that import named util)
export { parseISO };
export default CalendarHeatmap;
