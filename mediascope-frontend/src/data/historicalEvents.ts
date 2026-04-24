/**
 * Historical events the Dawn newspaper archive (1990-1992) covered.
 *
 * Used as overlay annotations on time-series charts so analysts can see
 * what was happening in the world at the moments coverage spiked.
 *
 * Each event has:
 *  - date     ISO YYYY-MM-DD (or YYYY-MM for month-resolution)
 *  - label    short headline (≤ 30 chars renders well)
 *  - category geopolitics | domestic | economy | culture
 *  - detail   one-sentence elaboration shown on hover
 */

export type EventCategory = 'geopolitics' | 'domestic' | 'economy' | 'culture' | 'science';

export interface HistoricalEvent {
  date: string;
  label: string;
  category: EventCategory;
  detail: string;
}

export const HISTORICAL_EVENTS: HistoricalEvent[] = [
  // 1990
  { date: '1990-02-11', label: 'Mandela freed',           category: 'geopolitics', detail: 'Nelson Mandela released from Victor Verster Prison after 27 years.' },
  { date: '1990-08-02', label: 'Iraq invades Kuwait',     category: 'geopolitics', detail: 'Iraqi forces invade Kuwait, triggering the Gulf crisis.' },
  { date: '1990-08-06', label: 'Bhutto dismissed',        category: 'domestic',    detail: 'President Ghulam Ishaq Khan dismisses PM Benazir Bhutto and dissolves the National Assembly.' },
  { date: '1990-10-03', label: 'German reunification',    category: 'geopolitics', detail: 'East and West Germany formally reunite.' },
  { date: '1990-10-24', label: 'IJI election win',        category: 'domestic',    detail: 'IJI (Nawaz Sharif) wins Pakistan general election.' },
  { date: '1990-11-06', label: 'Sharif sworn in',         category: 'domestic',    detail: 'Nawaz Sharif sworn in as 12th Prime Minister of Pakistan.' },
  // 1991
  { date: '1991-01-17', label: 'Operation Desert Storm',  category: 'geopolitics', detail: 'US-led coalition begins air campaign against Iraqi forces in Kuwait.' },
  { date: '1991-02-28', label: 'Gulf War ceasefire',      category: 'geopolitics', detail: 'President Bush announces ceasefire; Kuwait liberated.' },
  { date: '1991-05-21', label: 'Rajiv Gandhi assassinated', category: 'geopolitics', detail: 'Former Indian PM Rajiv Gandhi killed by LTTE suicide bomber in Tamil Nadu.' },
  { date: '1991-06-15', label: 'Mt Pinatubo erupts',      category: 'science',     detail: 'Major eruption in the Philippines; global temperatures dip.' },
  { date: '1991-08-19', label: 'Soviet coup attempt',     category: 'geopolitics', detail: 'Hardliners briefly seize power in Moscow before Yeltsin leads opposition.' },
  { date: '1991-12-25', label: 'USSR dissolved',          category: 'geopolitics', detail: 'Mikhail Gorbachev resigns; Soviet Union officially dissolved next day.' },
  // 1992
  { date: '1992-03-25', label: 'Pakistan win Cricket WC', category: 'culture',     detail: 'Pakistan beats England in the Cricket World Cup final at the MCG.' },
  { date: '1992-04-28', label: 'Mujahideen take Kabul',   category: 'geopolitics', detail: 'Najibullah government falls; mujahideen factions enter Kabul.' },
  { date: '1992-05-19', label: 'Karachi operation',       category: 'domestic',    detail: 'Army-led operation against MQM begins in Karachi.' },
  { date: '1992-09',    label: 'Pakistan floods',         category: 'domestic',    detail: 'Catastrophic monsoon floods kill ~2,000 in Punjab and elsewhere.' },
  { date: '1992-12-06', label: 'Babri Masjid demolished', category: 'geopolitics', detail: 'Mosque demolished in Ayodhya; sectarian violence follows across the subcontinent.' },
];

/**
 * Filter events by a date window (inclusive). Works with both YYYY-MM-DD and
 * YYYY-MM event dates — the latter are treated as "first of the month".
 */
export function eventsBetween(from: string, to: string): HistoricalEvent[] {
  const norm = (d: string) => (d.length === 7 ? `${d}-01` : d);
  return HISTORICAL_EVENTS.filter(e => {
    const ed = norm(e.date);
    return ed >= norm(from) && ed <= norm(to);
  });
}

export const EVENT_COLORS: Record<EventCategory, string> = {
  geopolitics: '#ef4444',
  domestic:    '#3b82f6',
  economy:     '#f59e0b',
  culture:     '#8b5cf6',
  science:     '#10b981',
};
