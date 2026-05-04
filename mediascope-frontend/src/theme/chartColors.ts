/**
 * Chart color tokens — central palette so the same six colors aren't pasted
 * inline across two dozen widgets.
 *
 * Use these instead of raw hex strings in chart props, badges, etc. Values
 * intentionally don't reference CSS custom properties because Recharts/SVG
 * don't pick up `var(--...)` reliably.
 */

// Vintage newspaper palette — sepia / rust / muted greens rather than
// modern bright primaries. Sentiment still uses green/red so the
// universal meaning is preserved, but both are dampened to read as ink.
export const chartColors = {
  // Sentiment polarity
  positive: '#5a7a3e',     // muted moss
  neutral:  '#8a7a62',     // sepia gray
  negative: '#a23a2c',     // brick red

  // Generic data series — vintage tones
  primary:   '#8b3a1f',    // rust (paired with --accent-rust)
  secondary: '#3b2a1c',    // dark ink
  accent:    '#a87a3e',    // muted gold
  highlight: '#c47b5a',    // dusty rose
  muted:     '#a89378',    // faded sepia

  // Reference lines / axes
  axisLabel: '#8a7a62',
  axisGrid:  'var(--border-color)',
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
