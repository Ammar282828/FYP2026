/**
 * useQueryState — bind a piece of React state to a URL query parameter.
 *
 * On mount, reads the param. On change, replaces the URL (no history push)
 * so back-button still works. Multiple instances share the same query string
 * cleanly because each one only touches its own key.
 *
 * Usage:
 *   const [tab, setTab] = useQueryState('tab', 'overview');
 *   const [from, setFrom] = useQueryState('from', '1990-01-01');
 *
 * Pages then become shareable: copy the URL, paste it, get the same view.
 */
import { useCallback, useEffect, useState } from 'react';

function read(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return new URLSearchParams(window.location.search).get(key) ?? fallback;
}

export function useQueryState(key: string, fallback: string): [string, (v: string) => void] {
  const [val, setVal] = useState<string>(() => read(key, fallback));

  // Sync when the user navigates with back/forward.
  useEffect(() => {
    const onPop = () => setVal(read(key, fallback));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [key, fallback]);

  const set = useCallback((next: string) => {
    setVal(next);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (next === fallback || next === '' || next == null) {
      params.delete(key);
    } else {
      params.set(key, next);
    }
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', url);
  }, [key, fallback]);

  return [val, set];
}

/**
 * Convenience wrapper for a JSON-encoded blob (e.g. arrays of keywords).
 */
export function useQueryStateJSON<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [raw, setRaw] = useQueryState(key, JSON.stringify(fallback));
  let parsed: T = fallback;
  try { parsed = JSON.parse(raw) as T; } catch { /* keep fallback */ }
  const set = useCallback((next: T) => setRaw(JSON.stringify(next)), [setRaw]);
  return [parsed, set];
}
