import React, { useState } from 'react';
import axios from 'axios';
import './AdBrowserTab.css'; // Reuse the beautiful styles

const API_BASE = 'http://localhost:8000/api';

interface AdAnalysis {
  analysis: any; // The structured JSON analysis
  timestamp: string;
  model: string;
  file_id: string;
  file_path: string;
}

interface UploadedAd {
  file_id: string;
  filename: string;
  path: string;
  size: number;
  analysis?: AdAnalysis;
}

const ImageAnalysisTab: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadedAd, setUploadedAd] = useState<UploadedAd | null>(null);
  const [analysis, setAnalysis] = useState<AdAnalysis | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const renderAnalysisSection = (analysisData: any) => {
    if (!analysisData) return null;

    // Render structured JSON format (same as AdBrowserTab)
    return (
      <div className="structured-analysis">
        {/* Brand Info Card */}
        {analysisData.brand && (
          <div className="insight-card brand-card">
            <h3 className="card-title">📦 Brand & Product</h3>
            <div className="card-content">
              <div className="brand-info">
                <div className="brand-name">{analysisData.brand.name}</div>
                <div className="product-info">{analysisData.brand.product}</div>
                <span className="category-badge">{analysisData.brand.category}</span>
              </div>
            </div>
          </div>
        )}

        {/* Visual Analysis Card */}
        {analysisData.visualAnalysis && (
          <div className="insight-card visual-card">
            <h3 className="card-title">🎨 Visual Analysis</h3>
            <div className="card-content">
              <div className="visual-grid">
                <div className="visual-item">
                  <span className="visual-label">Colors:</span>
                  <div className="color-tags">
                    {analysisData.visualAnalysis.colors?.map((color: string, idx: number) => (
                      <span key={idx} className="color-tag">{color}</span>
                    ))}
                  </div>
                </div>
                <div className="visual-item">
                  <span className="visual-label">Style:</span>
                  <span>{analysisData.visualAnalysis.designStyle}</span>
                </div>
                <div className="visual-item full-width">
                  <span className="visual-label">Imagery:</span>
                  <p>{analysisData.visualAnalysis.imagery}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Strategy Card */}
        {analysisData.advertisingStrategy && (
          <div className="insight-card strategy-card">
            <h3 className="card-title">🎯 Advertising Strategy</h3>
            <div className="card-content">
              <div className="strategy-item highlight">
                <strong>Main Message:</strong>
                <p>{analysisData.advertisingStrategy.mainMessage}</p>
              </div>
              <div className="strategy-item">
                <strong>Emotional Appeal:</strong>
                <p>{analysisData.advertisingStrategy.emotionalAppeal}</p>
              </div>
              <div className="strategy-item">
                <strong>Techniques:</strong>
                <div className="technique-tags">
                  {analysisData.advertisingStrategy.persuasionTechniques?.map((tech: string, idx: number) => (
                    <span key={idx} className="technique-tag">{tech}</span>
                  ))}
                </div>
              </div>
              {analysisData.advertisingStrategy.callToAction && (
                <div className="strategy-item cta">
                  <strong>Call to Action:</strong>
                  <p className="cta-text">"{analysisData.advertisingStrategy.callToAction}"</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Target Audience Card */}
        {analysisData.targetAudience && (
          <div className="insight-card audience-card">
            <h3 className="card-title">👥 Target Audience</h3>
            <div className="card-content">
              <div className="audience-item">
                <span className="audience-label">Demographics:</span>
                <p>{analysisData.targetAudience.demographics}</p>
              </div>
              <div className="audience-item">
                <span className="audience-label">Psychographics:</span>
                <p>{analysisData.targetAudience.psychographics}</p>
              </div>
            </div>
          </div>
        )}

        {/* Cultural Context Card */}
        {analysisData.culturalContext && (
          <div className="insight-card cultural-card">
            <h3 className="card-title">🕰️ Cultural Context</h3>
            <div className="card-content">
              <div className="cultural-item">
                <strong>Time Period:</strong> <span className="period-badge">{analysisData.culturalContext.timePeriod}</span>
              </div>
              {analysisData.culturalContext.timePeriodIndicators?.length > 0 && (
                <div className="cultural-item">
                  <strong>Period Indicators:</strong>
                  <ul>
                    {analysisData.culturalContext.timePeriodIndicators.map((ind: string, idx: number) => (
                      <li key={idx}>{ind}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Assessment Card */}
        {analysisData.assessment && (
          <div className="insight-card assessment-card">
            <h3 className="card-title">📊 Overall Assessment</h3>
            <div className="card-content">
              <div className="assessment-header">
                <span className={`sentiment-badge sentiment-${analysisData.assessment.sentiment?.toLowerCase()}`}>
                  {analysisData.assessment.sentiment}
                </span>
              </div>
              <div className="assessment-item">
                <strong>Effectiveness:</strong>
                <p>{analysisData.assessment.effectiveness}</p>
              </div>
              {analysisData.assessment.keyInsights?.length > 0 && (
                <div className="assessment-item">
                  <strong>Key Insights:</strong>
                  <ul className="insights-list">
                    {analysisData.assessment.keyInsights.map((insight: string, idx: number) => (
                      <li key={idx} className="insight-item">💡 {insight}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Text Content (Collapsible) */}
        {analysisData.textContent && (
          <details className="insight-card text-card">
            <summary className="card-title">📝 Detected Text Content</summary>
            <div className="card-content">
              {analysisData.textContent.headlines?.length > 0 && (
                <div className="text-section">
                  <strong>Headlines:</strong>
                  <ul>
                    {analysisData.textContent.headlines.map((h: string, idx: number) => (
                      <li key={idx}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}
              {analysisData.textContent.bodyCopy?.length > 0 && (
                <div className="text-section">
                  <strong>Body Copy:</strong>
                  {analysisData.textContent.bodyCopy.map((p: string, idx: number) => (
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

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setAnalysis(null);
      setUploadedAd(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await axios.post(`${API_BASE}/ads/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setUploadedAd(response.data);
      alert('Ad uploaded successfully!');
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload ad image');
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!uploadedAd) return;

    setAnalyzing(true);
    try {
      const response = await axios.post(`${API_BASE}/ads/analyze`, {
        file_id: uploadedAd.file_id,
      });

      setAnalysis(response.data.analysis);
    } catch (error) {
      console.error('Analysis error:', error);
      alert('Failed to analyze ad image');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="image-analysis-view">
      <div className="analysis-header">
        <h2>Advertisement Image Analysis (Beta)</h2>
        <p className="tagline">Upload advertisement images for AI-powered analysis</p>
      </div>

      <div className="upload-panel">
        <div className="upload-section">
          <div className="file-upload-area">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              id="ad-file-input"
              style={{ display: 'none' }}
            />
            <label htmlFor="ad-file-input" className="upload-label">
              <div className="upload-icon">Upload</div>
              <div className="upload-text">
                {selectedFile ? selectedFile.name : 'Click to select an advertisement image'}
              </div>
              <div className="upload-hint">Supported: JPG, PNG, GIF</div>
            </label>
          </div>

          {selectedFile && (
            <div className="upload-actions">
              <button
                onClick={handleUpload}
                disabled={uploading || !!uploadedAd}
                className="upload-btn"
              >
                {uploading ? 'Uploading...' : uploadedAd ? 'Uploaded' : 'Upload Image'}
              </button>

              {uploadedAd && !analysis && (
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="analyze-btn"
                >
                  {analyzing ? 'Analyzing...' : 'Analyze Image'}
                </button>
              )}
            </div>
          )}
        </div>

        {previewUrl && (
          <div className="preview-section">
            <h3>Preview</h3>
            <img src={previewUrl} alt="Ad preview" className="ad-preview-image" />
          </div>
        )}
      </div>

      {analyzing && (
        <div className="analysis-loading">
          <div className="loading-spinner"></div>
          <p>Analyzing advertisement with AI...</p>
          <p className="loading-subtext">This may take a few moments</p>
        </div>
      )}

      {analysis && !analyzing && (
        <div className="analysis-results">
          <div className="analysis-header-section">
            <h3>Advertisement Analysis</h3>
            <div className="analysis-meta">
              <span className="model-badge">{analysis.model}</span>
              <span className="timestamp-badge">
                {new Date(analysis.timestamp).toLocaleString()}
              </span>
            </div>
          </div>

          <div className="analysis-content-structured">
            {renderAnalysisSection(analysis.analysis)}
          </div>
        </div>
      )}

      <div className="analysis-info">
        <h3>About Image Analysis</h3>
        <p>
          This beta feature uses AI to analyze advertisement images from historical newspapers.
          The analysis includes text detection, brand recognition, sentiment analysis, and visual characteristics.
        </p>
        <p>
          <strong>Note:</strong> This is a beta feature. Analysis accuracy may vary depending on image quality and age.
        </p>
      </div>
    </div>
  );
};

export default ImageAnalysisTab;
