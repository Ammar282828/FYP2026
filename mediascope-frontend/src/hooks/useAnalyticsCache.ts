import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';

// Fetches the current article count from the backend.
// This is a cheap query (just counts docs) used as a version key.
let _versionPromise: Promise<string> | null = null;

async function fetchVersion(): Promise<string> {
  if (!_versionPromise) {
    _versionPromise = axios
      .get(`${API_BASE}/analytics/data-version`)
      .then(r => String(r.data.article_count))
      .catch(() => 'unknown')
      .finally(() => { _versionPromise = null; });
  }
  return _versionPromise;
}

/**
 * useAnalyticsCache — wraps an async fetch function with localStorage caching.
 *
 * The cache is keyed by `cacheKey + article_count`. If the article count in the
 * database hasn't changed since the last fetch, the cached result is returned
 * immediately without hitting Firestore. When new articles are added, the count
 * changes and the data is refetched automatically.
 *
 * Usage:
 *   const { data, loading } = useAnalyticsCache('sentiment_over_time', () =>
 *     axios.get(`${API_BASE}/analytics/sentiment-over-time`).then(r => r.data)
 *   );
 */
export function useAnalyticsCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  deps: any[] = []
): { data: T | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const version = await fetchVersion();
      const storageKey = `analytics_${cacheKey}_v${version}`;

      // Try localStorage first
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        setData(JSON.parse(cached));
        setLoading(false);
        return;
      }

      // Fetch fresh data
      const result = await fetcher();
      setData(result);

      // Persist to localStorage (clear old versions for this key first)
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(`analytics_${cacheKey}_v`)) {
          localStorage.removeItem(key);
        }
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify(result));
      } catch {
        // Ignore quota errors
      }
    } catch (err) {
      console.error(`[analytics cache] failed for ${cacheKey}:`, err);
    } finally {
      setLoading(false);
    }
  }, [cacheKey, refreshToken, ...deps]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => setRefreshToken(t => t + 1), []);

  return { data, loading, refresh };
}
