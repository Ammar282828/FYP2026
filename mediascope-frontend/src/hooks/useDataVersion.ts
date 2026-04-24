/**
 * useDataVersion — exposes `{article_count, min_date, max_date}` for the corpus.
 *
 * The result is cached in module scope so every consumer shares one HTTP call.
 * Components can rely on `min_date` / `max_date` to seed date pickers instead
 * of hardcoding 1990-01-01 / 1992-12-31.
 *
 * The hook returns `defaults` immediately (1990-01-01..2030-12-31) so the UI
 * never has empty inputs while we wait for the network response.
 */

import { useEffect, useState } from 'react';
import api from '../api';

export interface DataVersion {
  article_count: number;
  version: string;
  min_date: string | null;
  max_date: string | null;
}

const FALLBACK: DataVersion = {
  article_count: 0,
  version: 'unknown',
  min_date: '1990-01-01',
  max_date: '2030-12-31',
};

let _cache: DataVersion | null = null;
let _inFlight: Promise<DataVersion> | null = null;
const _subscribers = new Set<(v: DataVersion) => void>();

async function fetchDataVersion(): Promise<DataVersion> {
  if (_cache) return _cache;
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const data = await api.getDataVersion();
      const v: DataVersion = {
        article_count: data.article_count ?? 0,
        version: data.version ?? 'unknown',
        min_date: data.min_date ?? FALLBACK.min_date,
        max_date: data.max_date ?? FALLBACK.max_date,
      };
      _cache = v;
      _subscribers.forEach(fn => fn(v));
      return v;
    } catch {
      _cache = FALLBACK;
      return FALLBACK;
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}

export function useDataVersion(): DataVersion {
  const [state, setState] = useState<DataVersion>(_cache ?? FALLBACK);
  useEffect(() => {
    let cancelled = false;
    if (_cache) {
      setState(_cache);
    } else {
      fetchDataVersion().then(v => {
        if (!cancelled) setState(v);
      });
    }
    _subscribers.add(setState);
    return () => {
      cancelled = true;
      _subscribers.delete(setState);
    };
  }, []);
  return state;
}

/**
 * useDateBounds — convenience tuple `[minDate, maxDate]` using the data version.
 * Returns ISO strings, with sane fallbacks while loading.
 */
export function useDateBounds(): [string, string] {
  const v = useDataVersion();
  return [v.min_date || FALLBACK.min_date!, v.max_date || FALLBACK.max_date!];
}
