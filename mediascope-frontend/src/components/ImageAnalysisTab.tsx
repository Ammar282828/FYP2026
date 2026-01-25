import React, { useState } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:8000/api';

interface AdAnalysis {
  detected_text: string;
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
            {analysis.detected_text.split('##').map((section, idx) => {
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

                      // Check if it's a key-value pair (e.g., "Brand Name: XYZ")
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
            })}
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
