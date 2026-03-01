import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './AdBrowserTab.css';

const API_BASE = 'http://localhost:8000/api';

interface Advertisement {
  id: string;
  newspaper_id: string;
  publication_date: string;
  identifier: string;
  brand: string;
  category: string;
  location: string;
  description: string;
  analysis: any;
  model: string;
  created_at: string;
  image_url?: string;
  coordinates: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

interface AnalyticsData {
  total_ads: number;
  categories: Record<string, number>;
  brands: Record<string, number>;
  sentiments: Record<string, number>;
  design_styles: Record<string, number>;
  emotional_appeals: Record<string, number>;
  monthly_volume: Record<string, number>;
}

const BAR_COLORS = [
  '#667eea', '#764ba2', '#f5576c', '#f093fb', '#4facfe',
  '#43e97b', '#fa709a', '#fee140', '#30cfd0', '#a18cd1'
];

const SENTIMENT_COLORS: Record<string, string> = {
  positive: '#22c55e',
  neutral:  '#f59e0b',
  negative: '#ef4444'
};

const AdBrowserTab: React.FC = () => {
  const [activeView, setActiveView]       = useState<'browse' | 'analytics'>('browse');
  const [ads, setAds]                     = useState<Advertisement[]>([]);
  const [loading, setLoading]             = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedAd, setSelectedAd]       = useState<Advertisement | null>(null);
  const [total, setTotal]                 = useState(0);
  const [analytics, setAnalytics]         = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    loadAds();
  }, []);

  useEffect(() => {
    if (activeView === 'analytics' && !analytics) {
      loadAnalytics();
    }
  }, [activeView]);

  const EXCLUDED_KEYWORDS = [
    'tender', 'quotation', 'bid invited', 'sealed tender', 'procurement',
    'vacancy', 'required', 'applications are invited', 'job opening',
    'lost & found', 'matrimonial', 'for sale', 'to let', 'legal notice',
    'public notice', 'court notice',
  ];

  const filterAds = (raw: Advertisement[]) =>
    raw.filter(ad => {
      const id = (ad.identifier || '').trim();
      const desc = (ad.description || '').trim();
      const brand = (ad.brand || '').trim().toLowerCase();
      const blanks = ['unknown', 'not available', 'n/a', ''];
      const combined = `${id} ${desc}`.toLowerCase();
      const isExcluded = EXCLUDED_KEYWORDS.some(kw => combined.includes(kw));
      return (
        !isExcluded &&
        ad.image_url &&
        (id.length > 3 || desc.length > 10) &&
        !blanks.includes(brand)
      );
    });

  const loadAds = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/ads/browse`, { params: { limit: 200 } });
      const filtered = filterAds(response.data.ads);
      setAds(filtered);
      setTotal(filtered.length);
    } catch (error) {
      console.error('Error loading ads:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/ads/analytics/summary`);
      setAnalytics(response.data);
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchKeyword.trim()) { loadAds(); return; }
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE}/ads/search`, { keyword: searchKeyword, limit: 200 });
      const filtered = filterAds(response.data.ads);
      setAds(filtered);
      setTotal(filtered.length);
    } catch (error) {
      console.error('Error searching ads:', error);
    } finally {
      setLoading(false);
    }
  };

  // ── Bar chart helpers ─────────────────────────────────────────────────────

  const renderHorizontalBars = (
    data: Record<string, number>,
    maxBars = 12,
    colors: string[] = BAR_COLORS
  ) => {
    const entries = Object.entries(data).slice(0, maxBars);
    const max = Math.max(...entries.map(([, v]) => v), 1);
    return (
      <div className="bar-chart">
        {entries.map(([label, value], idx) => (
          <div key={label} className="bar-row">
            <span className="bar-label" title={label}>{label.replace(/_/g, ' ')}</span>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(value / max) * 100}%`, background: colors[idx % colors.length] }}
              />
            </div>
            <span className="bar-count">{value}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderMonthlyChart = (data: Record<string, number>) => {
    const entries = Object.entries(data);
    if (!entries.length) return <p className="no-data">No data yet.</p>;
    const max = Math.max(...entries.map(([, v]) => v), 1);
    return (
      <div className="monthly-chart">
        {entries.map(([month, count]) => (
          <div key={month} className="month-col">
            <div className="month-bar-wrap">
              <span className="month-value">{count}</span>
              <div
                className="month-bar"
                style={{ height: `${Math.max((count / max) * 100, 4)}%`, background: '#667eea' }}
                title={`${month}: ${count}`}
              />
            </div>
            <span className="month-label">{month.slice(5)}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderSentimentBars = (sentiments: Record<string, number>) => {
    const entries = Object.entries(sentiments);
    const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
    return (
      <div className="sentiment-bars">
        {entries.map(([label, count]) => (
          <div key={label} className="sentiment-row">
            <span className="sentiment-label-txt">{label}</span>
            <div className="sentiment-bar-track">
              <div
                className="sentiment-bar-fill"
                style={{
                  width: `${(count / total) * 100}%`,
                  background: SENTIMENT_COLORS[label] || '#6b7280'
                }}
              />
            </div>
            <span className="sentiment-pct">{Math.round((count / total) * 100)}%</span>
            <span className="sentiment-cnt">({count})</span>
          </div>
        ))}
      </div>
    );
  };

  // ── Analytics panel ───────────────────────────────────────────────────────

  const renderAnalytics = () => {
    if (analyticsLoading) return (
      <div className="loading-state">
        <div className="loading-spinner"></div>
        <p>Loading analytics…</p>
      </div>
    );
    if (!analytics) return <p className="no-data">No analytics data available.</p>;
    if (analytics.total_ads === 0) return (
      <div className="empty-state">
        <p>No advertisements stored yet. Analyze some newspaper pages first.</p>
      </div>
    );

    return (
      <div className="analytics-panel">
        {/* KPI row */}
        <div className="kpi-row">
          <div className="kpi-card">
            <span className="kpi-number">{analytics.total_ads}</span>
            <span className="kpi-label">Total Ads</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-number">{Object.keys(analytics.categories).length}</span>
            <span className="kpi-label">Categories</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-number">{Object.keys(analytics.brands).length}</span>
            <span className="kpi-label">Unique Brands</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-number">{Object.keys(analytics.monthly_volume).length}</span>
            <span className="kpi-label">Months Covered</span>
          </div>
        </div>

        <div className="analytics-grid">
          {/* Category distribution */}
          <div className="analytics-card wide">
            <h3 className="analytics-card-title">Category Distribution</h3>
            {Object.keys(analytics.categories).length
              ? renderHorizontalBars(analytics.categories, 15)
              : <p className="no-data">No data yet.</p>}
          </div>

          {/* Sentiment */}
          <div className="analytics-card">
            <h3 className="analytics-card-title">Sentiment Breakdown</h3>
            {Object.keys(analytics.sentiments).length
              ? renderSentimentBars(analytics.sentiments)
              : <p className="no-data">No data yet.</p>}
          </div>

          {/* Design styles */}
          <div className="analytics-card">
            <h3 className="analytics-card-title">Design Styles</h3>
            {Object.keys(analytics.design_styles).length
              ? renderHorizontalBars(analytics.design_styles, 8, ['#4facfe', '#00f2fe', '#43e97b', '#fa709a', '#f59e0b', '#a78bfa', '#34d399', '#f87171'])
              : <p className="no-data">No data yet.</p>}
          </div>

          {/* Emotional appeals */}
          <div className="analytics-card">
            <h3 className="analytics-card-title">Emotional Appeals</h3>
            {Object.keys(analytics.emotional_appeals).length
              ? renderHorizontalBars(analytics.emotional_appeals, 8, ['#f093fb', '#f5576c', '#fee140', '#30cfd0', '#667eea', '#fa709a', '#43e97b', '#764ba2'])
              : <p className="no-data">No data yet.</p>}
          </div>

          {/* Top brands */}
          <div className="analytics-card wide">
            <h3 className="analytics-card-title">Top Brands</h3>
            {Object.keys(analytics.brands).length
              ? renderHorizontalBars(analytics.brands, 20)
              : <p className="no-data">No data yet.</p>}
          </div>

          {/* Monthly volume */}
          <div className="analytics-card full-width">
            <h3 className="analytics-card-title">Monthly Ad Volume</h3>
            {renderMonthlyChart(analytics.monthly_volume)}
          </div>
        </div>
      </div>
    );
  };

  // ── Ad analysis renderer ──────────────────────────────────────────────────

  const renderAnalysisSection = (analysis: any) => {
    let parsed = analysis;
    if (typeof analysis === 'string') {
      try {
        parsed = JSON.parse(analysis);
      } catch {
        return analysis.split('##').map((section: string, idx: number) => {
          if (idx === 0 || !section.trim()) return null;
          const lines = section.trim().split('\n');
          const title = lines[0].trim();
          const content = lines.slice(1).join('\n').trim();
          return (
            <div key={idx} className="analysis-section">
              <h4 className="section-title">{title}</h4>
              <div className="section-content"><p>{content}</p></div>
            </div>
          );
        });
      }
    }

    // Support both old schema (colors, headlines[], bodyCopy[]) and
    // new schema (dominantColors, headline string, bodyText string)
    const va = parsed?.visualAnalysis || {};
    const colors = va.colors || va.dominantColors || [];
    const tc = parsed?.textContent || {};
    const headlines: string[] = tc.headlines || (tc.headline ? [tc.headline] : []);
    const bodyCopy: string[] = tc.bodyCopy || (tc.bodyText ? [tc.bodyText] : []);
    const slogan = tc.slogan || null;
    const contactInfo = tc.contactInfo || null;

    const strat = parsed?.advertisingStrategy || {};
    const assess = parsed?.assessment || {};
    const brand = parsed?.brand || {};

    return (
      <div className="structured-analysis">
        {/* Brand */}
        {(brand.name || brand.product) && (
          <div className="insight-card brand-card">
            <h3 className="card-title">Brand & Product</h3>
            <div className="card-content">
              <div className="brand-info">
                <div className="brand-name">{brand.name || '—'}</div>
                <div className="product-info">{brand.product}</div>
                {brand.category && <span className="category-badge">{brand.category.replace(/_/g, ' ')}</span>}
              </div>
            </div>
          </div>
        )}

        {/* Visual Analysis */}
        {(colors.length > 0 || va.imagery || va.designStyle) && (
          <div className="insight-card visual-card">
            <h3 className="card-title">Visual Analysis</h3>
            <div className="card-content">
              <div className="visual-grid">
                {colors.length > 0 && (
                  <div className="visual-item">
                    <span className="visual-label">Colors:</span>
                    <div className="color-tags">
                      {colors.map((c: string, i: number) => (
                        <span key={i} className="color-tag">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
                {va.designStyle && (
                  <div className="visual-item">
                    <span className="visual-label">Style:</span>
                    <span>{va.designStyle}</span>
                  </div>
                )}
                {va.layout && (
                  <div className="visual-item">
                    <span className="visual-label">Layout:</span>
                    <span>{va.layout}</span>
                  </div>
                )}
                {va.imagery && (
                  <div className="visual-item full-width">
                    <span className="visual-label">Imagery:</span>
                    <p>{va.imagery}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Advertising Strategy */}
        {(strat.mainMessage || strat.emotionalAppeal || strat.callToAction) && (
          <div className="insight-card strategy-card">
            <h3 className="card-title">Advertising Strategy</h3>
            <div className="card-content">
              {strat.mainMessage && (
                <div className="strategy-item highlight">
                  <strong>Main Message:</strong>
                  <p>{strat.mainMessage}</p>
                </div>
              )}
              {strat.emotionalAppeal && (
                <div className="strategy-item">
                  <strong>Emotional Appeal:</strong>
                  <p>{strat.emotionalAppeal}</p>
                </div>
              )}
              {strat.persuasionTechniques?.length > 0 && (
                <div className="strategy-item">
                  <strong>Techniques:</strong>
                  <div className="technique-tags">
                    {strat.persuasionTechniques.map((t: string, i: number) => (
                      <span key={i} className="technique-tag">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {strat.callToAction && (
                <div className="strategy-item cta">
                  <strong>Call to Action:</strong>
                  <p className="cta-text">"{strat.callToAction}"</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Target Audience (old schema top-level OR new schema inside assessment) */}
        {(parsed?.targetAudience || assess.targetAudience) && (
          <div className="insight-card audience-card">
            <h3 className="card-title">Target Audience</h3>
            <div className="card-content">
              {parsed?.targetAudience?.demographics && (
                <div className="audience-item">
                  <span className="audience-label">Demographics:</span>
                  <p>{parsed.targetAudience.demographics}</p>
                </div>
              )}
              {parsed?.targetAudience?.psychographics && (
                <div className="audience-item">
                  <span className="audience-label">Psychographics:</span>
                  <p>{parsed.targetAudience.psychographics}</p>
                </div>
              )}
              {typeof assess.targetAudience === 'string' && (
                <div className="audience-item">
                  <p>{assess.targetAudience}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Assessment */}
        {assess.sentiment && (
          <div className="insight-card assessment-card">
            <h3 className="card-title">Overall Assessment</h3>
            <div className="card-content">
              <div className="assessment-header">
                <span className={`sentiment-badge sentiment-${assess.sentiment?.toLowerCase()}`}>
                  {assess.sentiment}
                </span>
              </div>
              {assess.effectiveness && (
                <div className="assessment-item">
                  <strong>Effectiveness:</strong>
                  <p>{assess.effectiveness}</p>
                </div>
              )}
              {assess.historicalNotes && (
                <div className="assessment-item">
                  <strong>Historical Notes:</strong>
                  <p>{assess.historicalNotes}</p>
                </div>
              )}
              {assess.keyInsights?.length > 0 && (
                <div className="assessment-item">
                  <strong>Key Insights:</strong>
                  <ul className="insights-list">
                    {assess.keyInsights.map((s: string, i: number) => (
                      <li key={i} className="insight-item">💡 {s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Historical / Cultural Context (old schema) */}
        {parsed?.culturalContext && (
          <div className="insight-card cultural-card">
            <h3 className="card-title">Cultural Context</h3>
            <div className="card-content">
              {parsed.culturalContext.timePeriod && (
                <div className="cultural-item">
                  <strong>Time Period:</strong>{' '}
                  <span className="period-badge">{parsed.culturalContext.timePeriod}</span>
                </div>
              )}
              {parsed.culturalContext.timePeriodIndicators?.length > 0 && (
                <div className="cultural-item">
                  <strong>Period Indicators:</strong>
                  <ul>
                    {parsed.culturalContext.timePeriodIndicators.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Text Content */}
        {(headlines.length > 0 || bodyCopy.length > 0 || slogan || contactInfo) && (
          <details className="insight-card text-card">
            <summary className="card-title">Detected Text Content</summary>
            <div className="card-content">
              {slogan && (
                <div className="text-section">
                  <strong>Slogan / Tagline:</strong>
                  <p>{slogan}</p>
                </div>
              )}
              {headlines.length > 0 && (
                <div className="text-section">
                  <strong>Headlines:</strong>
                  <ul>{headlines.map((h: string, i: number) => <li key={i}>{h}</li>)}</ul>
                </div>
              )}
              {bodyCopy.length > 0 && (
                <div className="text-section">
                  <strong>Body Copy:</strong>
                  {bodyCopy.map((p: string, i: number) => <p key={i}>{p}</p>)}
                </div>
              )}
              {contactInfo && (
                <div className="text-section">
                  <strong>Contact / Address:</strong>
                  <p>{typeof contactInfo === 'string' ? contactInfo : JSON.stringify(contactInfo)}</p>
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="ad-browser-view">
      <div className="ad-browser-header">
        <div>
          <h2>Advertisement Browser</h2>
          <p className="tagline">Browse and analyse historical newspaper advertisements</p>
        </div>
        <div className="view-switcher">
          <button
            className={`view-btn ${activeView === 'browse' ? 'view-btn--active' : ''}`}
            onClick={() => setActiveView('browse')}
          >
            Browse
          </button>
          <button
            className={`view-btn ${activeView === 'analytics' ? 'view-btn--active' : ''}`}
            onClick={() => setActiveView('analytics')}
          >
            Analytics
          </button>
        </div>
      </div>

      {activeView === 'analytics' ? renderAnalytics() : (
        <>
          <div className="search-section">
            <form onSubmit={handleSearch} className="search-form">
              <input
                type="text"
                placeholder="Search advertisements by keyword..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="search-input"
              />
              <button type="submit" className="search-btn">Search</button>
              <button
                type="button"
                onClick={() => { setSearchKeyword(''); loadAds(); }}
                className="clear-btn"
              >
                Clear
              </button>
            </form>
            <div className="results-count">
              {total > 0 && <span>Found {total} advertisement{total !== 1 ? 's' : ''}</span>}
            </div>
          </div>

          {loading ? (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <p>Loading advertisements...</p>
            </div>
          ) : (
            <div className="ads-container">
              {ads.length === 0 ? (
                <div className="empty-state">
                  <p>No advertisements found</p>
                  {searchKeyword && <p>Try a different search term</p>}
                </div>
              ) : (
                <div className="ads-grid">
                  {ads.map((ad) => {
                    const catLabel = ad.category || (typeof ad.analysis === 'object' ? ad.analysis?.brand?.category : '') || '';
                    const brandLabel = ad.brand || (typeof ad.analysis === 'object' ? ad.analysis?.brand?.name : '') || '';
                    return (
                      <div key={ad.id} className="ad-card" onClick={() => setSelectedAd(ad)}>
                        {ad.image_url && (
                          <div className="ad-card-image">
                            <img src={ad.image_url} alt={ad.identifier || 'Advertisement'} loading="lazy" />
                          </div>
                        )}
                        <div className="ad-card-header">
                          <h3>{ad.identifier}</h3>
                          <span className="ad-location">
                            {typeof ad.location === 'string' ? ad.location : ''}
                          </span>
                        </div>
                        {(brandLabel || catLabel) && (
                          <div className="ad-card-chips">
                            {brandLabel && <span className="chip chip--brand">{brandLabel}</span>}
                            {catLabel && <span className="chip chip--cat">{catLabel.replace(/_/g, ' ')}</span>}
                          </div>
                        )}
                        <div className="ad-card-meta">
                          <span className="ad-date">
                            {ad.publication_date ? new Date(ad.publication_date).toLocaleDateString() : '—'}
                          </span>
                          <span className="ad-model">{ad.model}</span>
                        </div>
                        <div className="ad-description">{ad.description}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {selectedAd && (
        <div className="modal-overlay" onClick={() => setSelectedAd(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedAd(null)}>×</button>
            <div className="modal-header">
              <h2>{selectedAd.identifier}</h2>
              <div className="modal-meta">
                <span className="model-badge">{selectedAd.model}</span>
                <span className="timestamp-badge">
                  {selectedAd.publication_date ? new Date(selectedAd.publication_date).toLocaleDateString() : '—'}
                </span>
              </div>
            </div>
            <div className="modal-body">
              {selectedAd.image_url && (
                <div className="modal-ad-image">
                  <img src={selectedAd.image_url} alt={selectedAd.identifier || 'Advertisement'} />
                </div>
              )}
              <div className="ad-info-section">
                <div className="info-row">
                  <span className="info-label">Location:</span>
                  <span className="info-value">
                    {typeof selectedAd.location === 'string' ? selectedAd.location : ''}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Description:</span>
                  <span className="info-value">{selectedAd.description}</span>
                </div>
                {selectedAd.coordinates && typeof selectedAd.coordinates === 'object' && (
                  <div className="info-row">
                    <span className="info-label">Position:</span>
                    <span className="info-value">
                      {(selectedAd.coordinates as any).left !== undefined
                        ? `${(selectedAd.coordinates as any).left}%, ${(selectedAd.coordinates as any).top}% (${(selectedAd.coordinates as any).width}% × ${(selectedAd.coordinates as any).height}%)`
                        : `x1:${(selectedAd.coordinates as any).x1} y1:${(selectedAd.coordinates as any).y1} → x2:${(selectedAd.coordinates as any).x2} y2:${(selectedAd.coordinates as any).y2}`
                      }
                    </span>
                  </div>
                )}
              </div>
              <div className="analysis-content-structured">
                {renderAnalysisSection(selectedAd.analysis)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdBrowserTab;
