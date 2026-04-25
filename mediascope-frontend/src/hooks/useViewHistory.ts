/**
 * useViewHistory — client-side recently-viewed-articles list.
 *
 * Why client-side
 * ---------------
 * The backend has bookmarks but no view-history endpoint, and adding one
 * means a DB write on every article open (noisy + privacy-fraught). A
 * localStorage ring buffer captures "what did I just read" without any
 * server traffic, scoped to the device the user actually browsed on.
 *
 * Behavior
 * --------
 * - Capped at 50 entries; oldest fall off when a new one is recorded.
 * - Recording the same article id twice in a row only updates `viewedAt`
 *   (no duplicate row), so the order reflects most-recent-touch.
 * - All timestamps ISO-8601 UTC for portability.
 * - The hook subscribes to a custom `mediascope:history-changed` event so
 *   multiple components stay in sync on the same tab (storage events only
 *   fire across tabs).
 */
import { useCallback, useEffect, useState } from 'react';

const KEY = 'ms_view_history';
const MAX = 50;
const EVENT = 'mediascope:history-changed';

export interface HistoryEntry {
  id: string;
  headline: string;
  date?: string;
  sentiment?: string;
  topic?: string;
  viewedAt: string;
}

function readAll(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: HistoryEntry[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* quota exceeded — silently drop */
  }
}

export function recordView(entry: Omit<HistoryEntry, 'viewedAt'>) {
  if (!entry.id || !entry.headline) return;
  const now = new Date().toISOString();
  const next: HistoryEntry = { ...entry, viewedAt: now };
  const current = readAll().filter(e => e.id !== entry.id);
  current.unshift(next);
  if (current.length > MAX) current.length = MAX;
  writeAll(current);
}

export function clearHistory() {
  writeAll([]);
}

export function removeFromHistory(id: string) {
  writeAll(readAll().filter(e => e.id !== id));
}

export function useViewHistory(): HistoryEntry[] {
  const [history, setHistory] = useState<HistoryEntry[]>(() => readAll());

  useEffect(() => {
    const sync = () => setHistory(readAll());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync); // cross-tab
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Re-export the stable function so consumers can record without
  // double-importing — convenient but kept as a separate named export
  // for use outside of hooks too.
  return history;
}

export function useRecordView(): (e: Omit<HistoryEntry, 'viewedAt'>) => void {
  return useCallback(recordView, []);
}
