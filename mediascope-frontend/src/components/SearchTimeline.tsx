import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TOOLTIP_STYLE, TOOLTIP_CURSOR, AXIS_STYLE } from '../theme/chartTheme';

interface Article {
  publication_date: string;
  [key: string]: any;
}

interface SearchTimelineProps {
  articles: Article[];
}

const SearchTimeline: React.FC<SearchTimelineProps> = ({ articles }) => {
  const timelineData = useMemo(() => {
    if (!articles || articles.length === 0) return [];

    // Group articles by month
    const monthMap: Record<string, number> = {};
    articles.forEach(article => {
      if (article.publication_date) {
        const month = article.publication_date.slice(0, 7); // "1990-01"
        monthMap[month] = (monthMap[month] || 0) + 1;
      }
    });

    // Convert to sorted array
    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({
        month,
        label: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        count
      }));
  }, [articles]);

  if (timelineData.length < 2) return null;

  return (
    <div className="search-timeline">
      <div className="search-timeline-header">
        <h4>Results Over Time</h4>
        <span className="search-timeline-total">
          {articles.length} articles across {timelineData.length} months
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={timelineData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_STYLE}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={AXIS_STYLE}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={TOOLTIP_CURSOR}
            formatter={(value: any) => [`${value} articles`, 'Count']}
          />
          <Bar dataKey="count" fill="var(--primary-color)" radius={[3, 3, 0, 0]} opacity={0.85} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SearchTimeline;
