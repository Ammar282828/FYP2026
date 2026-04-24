/**
 * NER entity-type metadata: human-readable label + display color.
 *
 * Lives in one place because at least three components (ArticleAnalytics,
 * EnhancedAnalytics' co-occurrence widget, EntityPage) had been carrying
 * their own near-duplicate maps with subtly different labels.
 *
 * Codes match spaCy's en_core_web_lg defaults.
 */
import { chartColors } from '../theme/chartColors';

export interface EntityTypeInfo {
  /** Plural form, used for headings ("People · 12"). */
  label: string;
  /** Singular form, used in filter buttons ("Person"). */
  singular: string;
  color: string;
}

export const ENTITY_TYPES: Record<string, EntityTypeInfo> = {
  PERSON:      { label: 'People',         singular: 'Person',       color: chartColors.primary },
  ORG:         { label: 'Organizations',  singular: 'Organization', color: chartColors.secondary },
  GPE:         { label: 'Locations',      singular: 'Location',     color: chartColors.positive },
  NORP:        { label: 'Nationalities',  singular: 'Group',        color: chartColors.accent },
  EVENT:       { label: 'Events',         singular: 'Event',        color: chartColors.highlight },
  LOC:         { label: 'Places',         singular: 'Place',        color: '#0ea5e9' },
  WORK_OF_ART: { label: 'Works',          singular: 'Work',         color: '#9333ea' },
  LAW:         { label: 'Laws',           singular: 'Law',          color: '#a16207' },
  FAC:         { label: 'Facilities',     singular: 'Facility',     color: '#0891b2' },
  PRODUCT:     { label: 'Products',       singular: 'Product',      color: '#65a30d' },
};

/** Fallback for unknown / OTHER types. */
export const ENTITY_FALLBACK: EntityTypeInfo = {
  label: 'Other',
  singular: 'Other',
  color: '#6b7280',
};

export function entityInfo(type?: string | null): EntityTypeInfo {
  if (!type) return ENTITY_FALLBACK;
  return ENTITY_TYPES[type] || { ...ENTITY_FALLBACK, label: type, singular: type };
}
