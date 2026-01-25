import React, { useState, useEffect } from 'react';
import axios from 'axios';

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

  const renderAnalysisSection = (analysis: string) => {
    return analysis.split('##').map((section, idx) => {
      if (idx === 0 || !section.trim()) return null;

      const lines = section.trim().split('\n');
      const title = lines[0].trim();
      const content = lines.slice(1).join('\n').trim();

      return (
        <div key={idx} className="analysis-section">
          <h4 className="section-title">{title}</h4>
          <div className="section-content">
            {content.split('\n').map((line, lineIdx) => {
              if (!line.trim()) return null;

              // Check if it's a key-value pair
              const kvMatch = line.match(/^([^:]+):\s*(.+)$/);
              if (kvMatch) {
                return (
                  <div key={lineIdx} className="kv-pair">
                    <span className="kv-key">{kvMatch[1]}:</span>
                    <span className="kv-value">{kvMatch[2]}</span>
                  </div>
                );
              }

              return <p key={lineIdx}>{line}</p>;
            })}
          </div>
        </div>
      );
    });
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
