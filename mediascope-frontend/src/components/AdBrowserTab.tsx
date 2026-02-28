import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './AdBrowserTab.css';

const API_BASE = 'http://localhost:8000/api';

interface Advertisement {
  id: string;
  newspaper_id: string;
  publication_date: string;
  identifier: string;
  location: string;
  description: string;
  analysis: string;
  model: string;
  created_at: string;
  coordinates: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

const AdBrowserTab: React.FC = () => {
  const [ads, setAds] = useState<Advertisement[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedAd, setSelectedAd] = useState<Advertisement | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    loadAds();
  }, []);

  const loadAds = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/ads/browse`, {
        params: { limit: 100 }
      });
      setAds(response.data.ads);
      setTotal(response.data.total);
    } catch (error) {
      console.error('Error loading ads:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchKeyword.trim()) {
      loadAds();
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE}/ads/search`, {
        keyword: searchKeyword,
        limit: 100
      });
      setAds(response.data.ads);
      setTotal(response.data.total);
    } catch (error) {
      console.error('Error searching ads:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderAnalysisSection = (analysis: any) => {
    // Try to parse if it's a string
    let parsedAnalysis = analysis;
    if (typeof analysis === 'string') {
      try {
        parsedAnalysis = JSON.parse(analysis);
      } catch {
        // Fallback to old text parsing
        return analysis.split('##').map((section: string, idx: number) => {
          if (idx === 0 || !section.trim()) return null;
          const lines = section.trim().split('\n');
          const title = lines[0].trim();
          const content = lines.slice(1).join('\n').trim();
          return (
            <div key={idx} className="analysis-section">
              <h4 className="section-title">{title}</h4>
              <div className="section-content">
                <p>{content}</p>
              </div>
            </div>
          );
        });
      }
    }

    // Render structured JSON format
    return (
      <div className="structured-analysis">
        {/* Brand Info Card */}
        {parsedAnalysis.brand && (
          <div className="insight-card brand-card">
            <h3 className="card-title">📦 Brand & Product</h3>
            <div className="card-content">
              <div className="brand-info">
                <div className="brand-name">{parsedAnalysis.brand.name}</div>
                <div className="product-info">{parsedAnalysis.brand.product}</div>
                <span className="category-badge">{parsedAnalysis.brand.category}</span>
              </div>
            </div>
          </div>
        )}

        {/* Visual Analysis Card */}
        {parsedAnalysis.visualAnalysis && (
          <div className="insight-card visual-card">
            <h3 className="card-title">🎨 Visual Analysis</h3>
            <div className="card-content">
              <div className="visual-grid">
                <div className="visual-item">
                  <span className="visual-label">Colors:</span>
                  <div className="color-tags">
                    {parsedAnalysis.visualAnalysis.colors?.map((color: string, idx: number) => (
                      <span key={idx} className="color-tag">{color}</span>
                    ))}
                  </div>
                </div>
                <div className="visual-item">
                  <span className="visual-label">Style:</span>
                  <span>{parsedAnalysis.visualAnalysis.designStyle}</span>
                </div>
                <div className="visual-item full-width">
                  <span className="visual-label">Imagery:</span>
                  <p>{parsedAnalysis.visualAnalysis.imagery}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Strategy Card */}
        {parsedAnalysis.advertisingStrategy && (
          <div className="insight-card strategy-card">
            <h3 className="card-title">🎯 Advertising Strategy</h3>
            <div className="card-content">
              <div className="strategy-item highlight">
                <strong>Main Message:</strong>
                <p>{parsedAnalysis.advertisingStrategy.mainMessage}</p>
              </div>
              <div className="strategy-item">
                <strong>Emotional Appeal:</strong>
                <p>{parsedAnalysis.advertisingStrategy.emotionalAppeal}</p>
              </div>
              <div className="strategy-item">
                <strong>Techniques:</strong>
                <div className="technique-tags">
                  {parsedAnalysis.advertisingStrategy.persuasionTechniques?.map((tech: string, idx: number) => (
                    <span key={idx} className="technique-tag">{tech}</span>
                  ))}
                </div>
              </div>
              {parsedAnalysis.advertisingStrategy.callToAction && (
                <div className="strategy-item cta">
                  <strong>Call to Action:</strong>
                  <p className="cta-text">"{parsedAnalysis.advertisingStrategy.callToAction}"</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Target Audience Card */}
        {parsedAnalysis.targetAudience && (
          <div className="insight-card audience-card">
            <h3 className="card-title">👥 Target Audience</h3>
            <div className="card-content">
              <div className="audience-item">
                <span className="audience-label">Demographics:</span>
                <p>{parsedAnalysis.targetAudience.demographics}</p>
              </div>
              <div className="audience-item">
                <span className="audience-label">Psychographics:</span>
                <p>{parsedAnalysis.targetAudience.psychographics}</p>
              </div>
            </div>
          </div>
        )}

        {/* Cultural Context Card */}
        {parsedAnalysis.culturalContext && (
          <div className="insight-card cultural-card">
            <h3 className="card-title">🕰️ Cultural Context</h3>
            <div className="card-content">
              <div className="cultural-item">
                <strong>Time Period:</strong> <span className="period-badge">{parsedAnalysis.culturalContext.timePeriod}</span>
              </div>
              {parsedAnalysis.culturalContext.timePeriodIndicators?.length > 0 && (
                <div className="cultural-item">
                  <strong>Period Indicators:</strong>
                  <ul>
                    {parsedAnalysis.culturalContext.timePeriodIndicators.map((ind: string, idx: number) => (
                      <li key={idx}>{ind}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Assessment Card */}
        {parsedAnalysis.assessment && (
          <div className="insight-card assessment-card">
            <h3 className="card-title">📊 Overall Assessment</h3>
            <div className="card-content">
              <div className="assessment-header">
                <span className={`sentiment-badge sentiment-${parsedAnalysis.assessment.sentiment?.toLowerCase()}`}>
                  {parsedAnalysis.assessment.sentiment}
                </span>
              </div>
              <div className="assessment-item">
                <strong>Effectiveness:</strong>
                <p>{parsedAnalysis.assessment.effectiveness}</p>
              </div>
              {parsedAnalysis.assessment.keyInsights?.length > 0 && (
                <div className="assessment-item">
                  <strong>Key Insights:</strong>
                  <ul className="insights-list">
                    {parsedAnalysis.assessment.keyInsights.map((insight: string, idx: number) => (
                      <li key={idx} className="insight-item">💡 {insight}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Text Content (Collapsible) */}
        {parsedAnalysis.textContent && (
          <details className="insight-card text-card">
            <summary className="card-title">📝 Detected Text Content</summary>
            <div className="card-content">
              {parsedAnalysis.textContent.headlines?.length > 0 && (
                <div className="text-section">
                  <strong>Headlines:</strong>
                  <ul>
                    {parsedAnalysis.textContent.headlines.map((h: string, idx: number) => (
                      <li key={idx}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}
              {parsedAnalysis.textContent.bodyCopy?.length > 0 && (
                <div className="text-section">
                  <strong>Body Copy:</strong>
                  {parsedAnalysis.textContent.bodyCopy.map((p: string, idx: number) => (
                    <p key={idx}>{p}</p>
                  ))}
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    );
  };

  return (
    <div className="ad-browser-view">
      <div className="ad-browser-header">
        <h2>Advertisement Browser</h2>
        <p className="tagline">Browse and search historical newspaper advertisements</p>
      </div>

      <div className="search-section">
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            placeholder="Search advertisements by keyword..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="search-input"
          />
          <button type="submit" className="search-btn">
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchKeyword('');
              loadAds();
            }}
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
              {ads.map((ad) => (
                <div
                  key={ad.id}
                  className="ad-card"
                  onClick={() => setSelectedAd(ad)}
                >
                  <div className="ad-card-header">
                    <h3>{ad.identifier}</h3>
                    <span className="ad-location">{ad.location}</span>
                  </div>
                  <div className="ad-card-meta">
                    <span className="ad-date">
                      {new Date(ad.publication_date).toLocaleDateString()}
                    </span>
                    <span className="ad-model">{ad.model}</span>
                  </div>
                  <div className="ad-description">
                    {ad.description}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedAd && (
        <div className="modal-overlay" onClick={() => setSelectedAd(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedAd(null)}>
              ×
            </button>
            <div className="modal-header">
              <h2>{selectedAd.identifier}</h2>
              <div className="modal-meta">
                <span className="model-badge">{selectedAd.model}</span>
                <span className="timestamp-badge">
                  {new Date(selectedAd.publication_date).toLocaleDateString()}
                </span>
              </div>
            </div>
            <div className="modal-body">
              <div className="ad-info-section">
                <div className="info-row">
                  <span className="info-label">Location:</span>
                  <span className="info-value">{selectedAd.location}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Description:</span>
                  <span className="info-value">{selectedAd.description}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Position:</span>
                  <span className="info-value">
                    {selectedAd.coordinates.left}%, {selectedAd.coordinates.top}% ({selectedAd.coordinates.width}% × {selectedAd.coordinates.height}%)
                  </span>
                </div>
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
