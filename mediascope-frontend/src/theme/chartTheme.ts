/**
 * Shared Recharts theming.
 *
 * `TOOLTIP_STYLE` was previously duplicated inside three different chart
 * components (AdBrowserTab, EnhancedAnalytics, AdvancedAnalytics). When the
 * dashboard background tone changed, all three drifted apart visually.
 * Import from here so they stay in sync.
 */
import type { CSSProperties } from 'react';

export const TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  fontSize: '12px',
  color: 'var(--text-primary)',
  boxShadow: 'var(--shadow-md)',
  padding: '8px 10px',
};

// Cursor fill that matches the rest of the dashboard's hover surface.
export const TOOLTIP_CURSOR = { fill: 'var(--bg-secondary)' };

// Standard chart axis style — small, tertiary, never bold.
export const AXIS_STYLE = {
  fontSize: 11,
  fill: 'var(--text-tertiary)',
};
