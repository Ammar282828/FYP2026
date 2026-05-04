import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Calendar, ArrowRight, FileText, Megaphone } from 'lucide-react';
import { API_BASE } from '../config';
import { useToast } from './ui/Toast';
import './BrowseByDateTab.css';

interface Article {
  id: string;
  headline: string;
  publication_date?: string;
  page_number?: number;
  word_count?: number;
  topic_label?: string;
  sentiment_label?: string;
  content_preview?: string;
}

interface AdItem {
  id: string;
  identifier?: string;
  description?: string;
  publication_date?: string;
  page_number?: number;
  brand?: string;
  category?: string;
  image_url?: string;
  newspaper_image_url?: string;
}

type Mode = 'single' | 'range';

const fmt = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
};

// Group articles by their YYYY-MM-DD so the result list reads like a
// chronological calendar rather than a flat dump.
const groupByDay = (articles: Article[]): Array<{ day: string; items: Article[] }> => {
  const buckets = new Map<string, Article[]>();
  for (const a of articles) {
    const key = (a.publication_date || '').slice(0, 10) || 'undated';
    const arr = buckets.get(key) || [];
    arr.push(a);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, items]) => ({ day, items }));
};

// Same shape, but for ads — kept parallel to the article grouper so
// each day's section can render its articles AND ads side by side.
const groupAdsByDay = (ads: AdItem[]): Map<string, AdItem[]> => {
  const buckets = new Map<string, AdItem[]>();
  for (const a of ads) {
    const key = (a.publication_date || '').slice(0, 10) || 'undated';
    const arr = buckets.get(key) || [];
    arr.push(a);
    buckets.set(key, arr);
  }
  return buckets;
};

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const BrowseByDateTab: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('single');
  // Sensible defaults: single = mid-corpus date; range = an early week.
  const [singleDate, setSingleDate] = useState<string>('1990-10-29');
  const [rangeFrom, setRangeFrom] = useState<string>('1990-10-22');
  const [rangeTo, setRangeTo] = useState<string>('1990-10-28');
  const [articles, setArticles] = useState<Article[]>([]);
  const [ads, setAds] = useState<AdItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [adsTotal, setAdsTotal] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const grouped = useMemo(() => groupByDay(articles), [articles]);
  const adsByDay = useMemo(() => groupAdsByDay(ads), [ads]);

  const today = useMemo(() => todayIso(), []);

  const fetchSlice = useCallback(async (df: string, dt: string) => {
    setLoading(true);
    setHasSearched(true);
    try {
      // Run articles + ads queries in parallel — both endpoints accept
      // ISO date filters, so we pull the same window from each.
      const [artRes, adRes] = await Promise.all([
        axios.get(`${API_BASE}/articles`, {
          params: {
            date_from: df,
            date_to: dt,
            limit: 500,
            sort_by: 'date_asc',
          },
        }),
        axios.get(`${API_BASE}/ads/browse`, {
          params: {
            start_date: `${df}T00:00:00`,
            end_date:   `${dt}T23:59:59`,
            limit: 500,
          },
        }).catch(() => null),  // Ads are a nice-to-have; don't fail the page if they 500.
      ]);
      setArticles(artRes.data.articles || []);
      setTotal(artRes.data.total ?? (artRes.data.articles?.length || 0));
      const adData = adRes?.data;
      setAds(adData?.ads || []);
      setAdsTotal(adData?.total ?? (adData?.ads?.length || 0));
    } catch (err: any) {
      console.error('browse-by-date failed', err);
      const msg = err?.response?.data?.detail || err?.message || 'Failed to load articles';
      toast(msg, 'error');
      setArticles([]); setTotal(0);
      setAds([]); setAdsTotal(0);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'single') {
      if (!singleDate) { toast('Pick a date', 'info'); return; }
      fetchSlice(singleDate, singleDate);
    } else {
      if (!rangeFrom || !rangeTo) { toast('Pick a start and end date', 'info'); return; }
      if (rangeFrom > rangeTo) { toast('Start date is after end date', 'info'); return; }
      fetchSlice(rangeFrom, rangeTo);
    }
  };

  // Run the default query once on mount so the page isn't empty.
  useEffect(() => {
    fetchSlice(singleDate, singleDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToArticle = (id: string) => navigate(`/article/${id}`);

  return (
    <section className="browse-by-date">
      <header className="browse-by-date__header">
        <div className="browse-by-date__title">
          <Calendar size={18} strokeWidth={1.5} />
          <h2>Browse by date</h2>
        </div>
        <p className="browse-by-date__subtitle">
          Pick a single day or a date range and see every article from that slice of the archive.
        </p>
      </header>

      <form className="browse-by-date__form" onSubmit={handleSubmit}>
        <div className="browse-by-date__mode">
          <label className={mode === 'single' ? 'is-active' : ''}>
            <input
              type="radio"
              name="bbd-mode"
              checked={mode === 'single'}
              onChange={() => setMode('single')}
            />
            <span>Single day</span>
          </label>
          <label className={mode === 'range' ? 'is-active' : ''}>
            <input
              type="radio"
              name="bbd-mode"
              checked={mode === 'range'}
              onChange={() => setMode('range')}
            />
            <span>Date range</span>
          </label>
        </div>

        <div className="browse-by-date__inputs">
          {mode === 'single' ? (
            <label className="browse-by-date__field">
              <span>Date</span>
              <input
                type="date"
                value={singleDate}
                max={today}
                onChange={(e) => setSingleDate(e.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="browse-by-date__field">
                <span>From</span>
                <input
                  type="date"
                  value={rangeFrom}
                  max={rangeTo || today}
                  onChange={(e) => setRangeFrom(e.target.value)}
                />
              </label>
              <label className="browse-by-date__field">
                <span>To</span>
                <input
                  type="date"
                  value={rangeTo}
                  min={rangeFrom}
                  max={today}
                  onChange={(e) => setRangeTo(e.target.value)}
                />
              </label>
            </>
          )}
          <button
            type="submit"
            className="btn btn--primary"
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load articles'}
          </button>
        </div>
      </form>

      <div className="browse-by-date__summary">
        {hasSearched && !loading && (
          <p>
            <strong>{total.toLocaleString()}</strong> {total === 1 ? 'article' : 'articles'}
            {adsTotal > 0 && <> · <strong>{adsTotal.toLocaleString()}</strong> {adsTotal === 1 ? 'advertisement' : 'advertisements'}</>}
            {' '}
            {mode === 'single'
              ? <>from <em>{fmt(singleDate)}</em></>
              : <>between <em>{fmt(rangeFrom)}</em> and <em>{fmt(rangeTo)}</em></>}
          </p>
        )}
      </div>

      <div className="browse-by-date__results">
        {loading && (
          <div className="browse-by-date__loading">Reading the archive…</div>
        )}
        {!loading && hasSearched && articles.length === 0 && (
          <div className="browse-by-date__empty">
            <FileText size={32} strokeWidth={1.2} />
            <p>No articles in this period yet.</p>
            <p className="browse-by-date__empty-hint">
              The corpus covers 1990–1992 (and a little bit either side). Try a different date.
            </p>
          </div>
        )}
        {!loading && grouped.map(({ day, items }) => {
          const dayAds = adsByDay.get(day) || [];
          return (
          <section key={day} className="browse-by-date__day">
            <h3 className="browse-by-date__day-heading">
              {fmt(day)}
              <span className="browse-by-date__day-count">{items.length} articles</span>
              {dayAds.length > 0 && <span className="browse-by-date__day-count">{dayAds.length} ads</span>}
            </h3>
            <ul className="browse-by-date__list">
              {items.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="browse-by-date__item"
                    onClick={() => goToArticle(a.id)}
                  >
                    <span className="browse-by-date__item-head">
                      {a.headline || '(untitled)'}
                    </span>
                    <span className="browse-by-date__item-meta">
                      {a.topic_label && <span className="browse-by-date__chip">{a.topic_label}</span>}
                      {a.page_number && <span>p. {a.page_number}</span>}
                      {typeof a.word_count === 'number' && <span>{a.word_count} w</span>}
                      {a.sentiment_label && <span className={`browse-by-date__sentiment is-${a.sentiment_label}`}>{a.sentiment_label}</span>}
                    </span>
                    {a.content_preview && (
                      <span className="browse-by-date__item-preview">
                        {a.content_preview}{a.content_preview.length >= 200 ? '…' : ''}
                      </span>
                    )}
                    <ArrowRight size={14} className="browse-by-date__item-arrow" />
                  </button>
                </li>
              ))}
            </ul>

            {dayAds.length > 0 && (
              <div className="browse-by-date__ads">
                <h4 className="browse-by-date__ads-heading">
                  <Megaphone size={14} strokeWidth={1.6} />
                  Advertisements
                  <span className="browse-by-date__day-count">{dayAds.length}</span>
                </h4>
                <ul className="browse-by-date__ad-list">
                  {dayAds.map((ad) => {
                    const headline = ad.identifier || ad.brand || '(untitled ad)';
                    const preview = ad.description || '';
                    const cropUrl = ad.image_url || ad.newspaper_image_url;
                    return (
                      <li key={ad.id}>
                        <div className="browse-by-date__ad">
                          {cropUrl && (
                            <img
                              src={cropUrl}
                              alt={headline}
                              className="browse-by-date__ad-thumb"
                              loading="lazy"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                          <div className="browse-by-date__ad-body">
                            <span className="browse-by-date__ad-head">{headline}</span>
                            <span className="browse-by-date__item-meta">
                              {ad.category && <span className="browse-by-date__chip">{ad.category}</span>}
                              {ad.brand && ad.brand !== headline && <span>{ad.brand}</span>}
                              {ad.page_number && <span>p. {ad.page_number}</span>}
                            </span>
                            {preview && (
                              <span className="browse-by-date__item-preview">
                                {preview.slice(0, 180)}{preview.length > 180 ? '…' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
          );
        })}
      </div>
    </section>
  );
};

export default BrowseByDateTab;
