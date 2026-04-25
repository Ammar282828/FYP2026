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
import { useLocation } from 'react-router-dom';

function read(key: string, fallback: string, search?: string): string {
  if (typeof window === 'undefined') return fallback;
  const src = search ?? window.location.search;
  return new URLSearchParams(src).get(key) ?? fallback;
}

export function useQueryState(key: string, fallback: string): [string, (v: string) => void] {
  // useLocation lets us re-render whenever react-router changes the URL —
  // including when something like the CommandPalette navigates with
  // `navigate('/?tab=search')` from outside this component tree. Without
  // it, only browser back/forward (popstate) would resync.
  const location = useLocation();
  const [val, setVal] = useState<string>(() => read(key, fallback));

  // Sync on URL changes (router navigation + browser back/forward).
  useEffect(() => {
    setVal(read(key, fallback, location.search));
  }, [key, fallback, location.search]);

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
