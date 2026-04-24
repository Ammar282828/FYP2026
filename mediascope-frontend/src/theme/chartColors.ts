/**
 * Chart color tokens — central palette so the same six colors aren't pasted
 * inline across two dozen widgets.
 *
 * Use these instead of raw hex strings in chart props, badges, etc. Values
 * intentionally don't reference CSS custom properties because Recharts/SVG
 * don't pick up `var(--...)` reliably.
 */

export const chartColors = {
  // Sentiment polarity — green/red is the universally-understood mapping.
  positive: '#10b981',
  neutral: '#6b7280',
  negative: '#ef4444',

  // Generic data series — used for anonymous "value over time" charts.
  primary: '#3b82f6',
  secondary: '#8b5cf6',
  accent: '#f59e0b',
  highlight: '#ec4899',
  muted: '#94a3b8',

  // Reference lines / axes.
  axisLabel: '#94a3b8',
  axisGrid: 'var(--border-color)',
} as const;

/** Sentiment color helper — accepts any of the labels we emit. */
export function colorForSentiment(label?: string | null): string {
  switch ((label || '').toLowerCase()) {
    case 'positive': return chartColors.positive;
    case 'negative': return chartColors.negative;
    default:         return chartColors.neutral;
  }
}

/**
 * Categorical palette for "N series of unknown count" charts. Picked from
 * the per-series colors above so the chart looks coordinated even at N=8.
 */
export const categoricalPalette: readonly string[] = [
  chartColors.primary,
  chartColors.secondary,
  chartColors.accent,
  chartColors.positive,
  chartColors.negative,
  chartColors.highlight,
  chartColors.muted,
  '#0ea5e9',
];

/** Stable hash → palette index, so the same series name keeps the same color. */
export function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return categoricalPalette[Math.abs(hash) % categoricalPalette.length];
}
