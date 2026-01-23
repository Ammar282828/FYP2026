import React, { useState } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:8000/api';

interface AdAnalysis {
  detected_text: string;
  brands: string[];
  sentiment: string;
  sentiment_score: number;
  categories: string[];
  colors: string[];
  dominant_emotion: string;
  target_demographic: string;
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

      {analysis && (
        <div className="analysis-results">
          <h3>Analysis Results</h3>

          <div className="results-grid">
            <div className="result-card">
              <div className="result-label">Detected Text</div>
              <div className="result-value">{analysis.detected_text}</div>
            </div>

            <div className="result-card">
              <div className="result-label">Sentiment</div>
              <div className="result-value sentiment">
                <span className={`sentiment-badge ${analysis.sentiment}`}>
                  {analysis.sentiment.toUpperCase()}
                </span>
                <span className="score">Score: {(analysis.sentiment_score * 100).toFixed(0)}%</span>
              </div>
            </div>

            <div className="result-card">
              <div className="result-label">Dominant Emotion</div>
              <div className="result-value">{analysis.dominant_emotion}</div>
            </div>

            <div className="result-card">
              <div className="result-label">Target Demographic</div>
              <div className="result-value">{analysis.target_demographic}</div>
            </div>

            <div className="result-card full-width">
              <div className="result-label">Detected Brands</div>
              <div className="tags-list">
                {analysis.brands.map((brand, idx) => (
                  <span key={idx} className="tag brand-tag">{brand}</span>
                ))}
              </div>
            </div>

            <div className="result-card full-width">
              <div className="result-label">Categories</div>
              <div className="tags-list">
                {analysis.categories.map((cat, idx) => (
                  <span key={idx} className="tag category-tag">{cat}</span>
                ))}
              </div>
            </div>

            <div className="result-card full-width">
              <div className="result-label">Color Palette</div>
              <div className="color-palette">
                {analysis.colors.map((color, idx) => (
                  <div
                    key={idx}
                    className="color-swatch"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
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
