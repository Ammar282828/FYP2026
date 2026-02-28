import React, { useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';

// Removed - using config

interface OCRJob {
  file_id: string;
  filename: string;
  path: string;
  size: number;
  status: string;
  progress?: number;
  message?: string;
}

const OCRTab: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [publicationDate, setPublicationDate] = useState('1990-01-01');
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<OCRJob | null>(null);
  const [ocrStatus, setOcrStatus] = useState<OCRJob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [localFolderMode, setLocalFolderMode] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [bulkResults, setBulkResults] = useState<any>(null);
  const [extractedDate, setExtractedDate] = useState<string | null>(null);
  const [filesNeedingDates, setFilesNeedingDates] = useState<any[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processProgress, setProcessProgress] = useState(0);
  const [currentProcessingFile, setCurrentProcessingFile] = useState('');

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (bulkMode) {
      const files = Array.from(event.target.files || []);
      setSelectedFiles(files);
      setBulkResults(null);
    } else {
      const file = event.target.files?.[0];
      if (file) {
        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        setUploadedFile(null);
        setOcrStatus(null);
        setExtractedDate(null);
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setExtractedDate(null);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await axios.post(`${API_BASE}/ocr/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const progress = progressEvent.total
            ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
            : 0;
          setUploadProgress(progress);
        },
      });

      setUploadedFile(response.data);
      setUploadProgress(100);

      // Set extracted date if available
      if (response.data.extracted_date) {
        setExtractedDate(response.data.extracted_date);
        setPublicationDate(response.data.extracted_date);
      }

      alert(response.data.message || 'Newspaper image uploaded successfully!');
    } catch (error: any) {
      console.error('Upload error:', error);
      alert(error.response?.data?.detail || 'Failed to upload newspaper image');
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  };

  const handleBulkUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setBulkResults(null);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      selectedFiles.forEach(file => {
        formData.append('files', file);
      });

      const response = await axios.post(`${API_BASE}/ocr/upload-bulk`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const progress = progressEvent.total
            ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
            : 0;
          setUploadProgress(progress);
        },
      });

      setUploadProgress(100);
      setBulkResults(response.data);
      alert(`${response.data.message}\n\nStarting OCR processing for all files...`);

      // Auto-process all uploaded files
      setProcessing(true);
      setProcessProgress(0);
      await handleBulkProcess(response.data.results);

    } catch (error: any) {
      console.error('Bulk upload error:', error);
      alert(error.response?.data?.detail || 'Failed to upload files');
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  };

  const handleBulkProcess = async (uploadedFiles: any[]) => {
    let completed = 0;
    let failed = 0;
    const missingDates: any[] = [];
    const totalFiles = uploadedFiles.filter(f => f.status === 'uploaded' && f.file_id).length;

    for (const fileData of uploadedFiles) {
      if (fileData.status === 'uploaded' && fileData.file_id) {
        try {
          setCurrentProcessingFile(fileData.filename);
          // Process even without date - backend will use default or skip date validation
          await axios.post(`${API_BASE}/ocr/process`, {
            file_id: fileData.file_id,
            file_path: fileData.path,
            publication_date: fileData.extracted_date || null,
          });
          completed++;
          setProcessProgress(Math.round((completed / totalFiles) * 100));
          console.log(`Processed: ${fileData.filename}`);

          // Track files without extracted dates
          if (!fileData.extracted_date) {
            missingDates.push({
              ...fileData,
              index: uploadedFiles.indexOf(fileData) + 1,
            });
          }
        } catch (error) {
          failed++;
          setProcessProgress(Math.round(((completed + failed) / totalFiles) * 100));
          console.error(`Failed: ${fileData.filename}`, error);
        }
      }
    }

    setProcessing(false);
    setCurrentProcessingFile('');
    setFilesNeedingDates(missingDates);
    setTimeout(() => setProcessProgress(0), 1000);

    let message = `Batch processing complete!\nSuccessful: ${completed}\nFailed: ${failed}`;
    if (missingDates.length > 0) {
      message += `\n\n${missingDates.length} files processed without date detection.\nYou can update dates later if needed.`;
    }
    alert(message);
  };

  const handleStartOCR = async () => {
    if (!uploadedFile) return;

    setProcessing(true);
    setProcessProgress(0);
    setCurrentProcessingFile(uploadedFile.filename || 'Processing...');
    try {
      const response = await axios.post(`${API_BASE}/ocr/process`, {
        file_id: uploadedFile.file_id,
        publication_date: publicationDate,
      });

      setOcrStatus(response.data);
      setProcessProgress(100);
      setProcessing(false);
      setCurrentProcessingFile('');
      setTimeout(() => setProcessProgress(0), 1000);

      // Note: The actual status polling has been simplified since processing happens synchronously
    } catch (error) {
      console.error('OCR processing error:', error);
      alert('Failed to start OCR processing');
      setProcessing(false);
      setCurrentProcessingFile('');
      setProcessProgress(0);
    }
  };

  const handleProcessLocalFolder = async () => {
    if (!folderPath.trim()) {
      alert('Please enter a folder path');
      return;
    }

    setProcessing(true);
    setBulkResults(null);
    setProcessProgress(0);
    setCurrentProcessingFile('Scanning folder...');
    try {
      const response = await axios.post(`${API_BASE}/ocr/process-folder`, {
        folder_path: folderPath,
      });

      setBulkResults(response.data);
      setProcessProgress(100);
      setProcessing(false);
      setCurrentProcessingFile('');
      setTimeout(() => setProcessProgress(0), 1000);
      alert(response.data.message);
    } catch (error: any) {
      console.error('Local folder processing error:', error);
      alert(error.response?.data?.detail || 'Failed to process local folder');
      setProcessing(false);
      setCurrentProcessingFile('');
      setProcessProgress(0);
    }
  };

  return (
    <div className="ocr-view">
      <div className="ocr-header">
        <h2>OCR Processing</h2>
        <p className="tagline">Upload newspaper images for text extraction and analysis</p>
      </div>

      <div className="mode-toggle">
        <button
          className={!bulkMode && !localFolderMode ? 'active' : ''}
          onClick={() => {
            setBulkMode(false);
            setLocalFolderMode(false);
            setSelectedFiles([]);
            setBulkResults(null);
          }}
        >
          Single Upload
        </button>
        <button
          className={bulkMode && !localFolderMode ? 'active' : ''}
          onClick={() => {
            setBulkMode(true);
            setLocalFolderMode(false);
            setSelectedFile(null);
            setPreviewUrl(null);
          }}
        >
          Bulk Upload
        </button>
        <button
          className={localFolderMode ? 'active' : ''}
          onClick={() => {
            setBulkMode(false);
            setLocalFolderMode(true);
            setSelectedFile(null);
            setSelectedFiles([]);
            setPreviewUrl(null);
            setBulkResults(null);
          }}
        >
          Local Folder
        </button>
      </div>

      <div className="ocr-panel">
        <div className="upload-section">
          {localFolderMode ? (
            <div className="folder-path-input">
              <div className="input-group">
                <label htmlFor="folder-path">Enter Local Folder Path:</label>
                <input
                  type="text"
                  id="folder-path"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/path/to/your/newspaper/images"
                  className="folder-path-field"
                />
              </div>
              <div className="folder-hint">
                Enter the full path to a folder containing newspaper images (JPG, PNG, HEIC).
                All images will be processed directly without uploading.
              </div>
              <button
                onClick={handleProcessLocalFolder}
                disabled={processing || !folderPath.trim()}
                className="process-btn"
              >
                {processing ? 'Processing...' : 'Process Folder'}
              </button>
            </div>
          ) : (
            <div className="file-upload-area">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                id="ocr-file-input"
                style={{ display: 'none' }}
                multiple={bulkMode}
                {...(bulkMode ? { webkitdirectory: "", directory: "" } : {})}
              />
              <label htmlFor="ocr-file-input" className="upload-label">
                <div className="upload-text">
                  {bulkMode
                    ? selectedFiles.length > 0
                      ? `${selectedFiles.length} files selected from folder`
                      : 'Click to select a folder of newspaper images'
                    : selectedFile
                    ? selectedFile.name
                    : 'Click to select a newspaper image'}
                </div>
                <div className="upload-hint">{bulkMode ? 'Select a folder - all images will be processed automatically' : 'Supported: JPG, PNG, PDF'}</div>
              </label>
            </div>
          )}

          {uploadedFile && !bulkMode && (
            <div className="ocr-metadata">
              {extractedDate ? (
                <div className="auto-detected-date">
                  Auto-detected date: <strong>{extractedDate}</strong>
                </div>
              ) : (
                <div className="manual-date-entry">
                  <div className="warning-message">
                    Could not auto-detect date. Please enter manually:
                  </div>
                  <div className="metadata-field">
                    <label>Publication Date</label>
                    <input
                      type="date"
                      value={publicationDate}
                      onChange={(e) => setPublicationDate(e.target.value)}
                      min="1990-01-01"
                      max="1992-12-31"
                      className="date-input"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {!localFolderMode && (selectedFile || selectedFiles.length > 0) && (
            <div className="upload-actions">
              {!bulkMode ? (
                <>
                  <button
                    onClick={handleUpload}
                    disabled={uploading || !!uploadedFile}
                    className="upload-btn"
                  >
                    {uploading ? 'Uploading...' : uploadedFile ? 'Uploaded' : 'Upload Image'}
                  </button>

                  {uploadedFile && (
                    <button
                      onClick={handleStartOCR}
                      disabled={processing}
                      className="process-btn"
                    >
                      {processing ? 'Processing...' : 'Start OCR Processing'}
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={handleBulkUpload}
                  disabled={uploading || selectedFiles.length === 0}
                  className="upload-btn"
                >
                  {uploading
                    ? 'Uploading...'
                    : `Upload ${selectedFiles.length} Images`}
                </button>
              )}
            </div>
          )}

          {/* Upload Progress Bar */}
          {uploading && uploadProgress > 0 && (
            <div className="progress-container">
              <div className="progress-header">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Processing Progress Bar */}
          {processing && (
            <div className="progress-container">
              <div className="progress-header">
                <span>{currentProcessingFile || 'Processing...'}</span>
                <span>{processProgress}%</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill processing"
                  style={{ width: `${processProgress || 10}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {previewUrl && (
          <div className="preview-section">
            <h3>Preview</h3>
            <img src={previewUrl} alt="Newspaper preview" className="newspaper-preview-image" />
          </div>
        )}
      </div>

      {ocrStatus && (
        <div className="ocr-status">
          <h3>Processing Status</h3>
          <div className="status-card">
            <div className="status-header">
              <span className={`status-badge ${ocrStatus.status}`}>
                {ocrStatus.status.toUpperCase()}
              </span>
              {ocrStatus.progress !== undefined && (
                <span className="progress-text">{ocrStatus.progress}%</span>
              )}
            </div>

            {ocrStatus.progress !== undefined && (
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${ocrStatus.progress}%` }}
                />
              </div>
            )}

            <div className="status-message">{ocrStatus.message}</div>

            {ocrStatus.status === 'processing' && (
              <div className="status-info">
                <p>Estimated time: {uploadedFile?.status === 'processing' ? '5-10 minutes' : 'Calculating...'}</p>
              </div>
            )}

            {ocrStatus.status === 'completed' && (
              <div className="status-success">
                <p>OCR processing completed successfully.</p>
                <p>The extracted articles have been added to the database and are now searchable.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {bulkResults && (
        <div className="bulk-results">
          <h3>{localFolderMode ? 'Local Folder Processing Results' : 'Bulk Upload Results'}</h3>
          <div className="bulk-summary">
            <div className="summary-stat success">
              <div className="stat-label">Successful</div>
              <div className="stat-value">{bulkResults.successful}</div>
            </div>
            <div className="summary-stat failed">
              <div className="stat-label">Failed</div>
              <div className="stat-value">{bulkResults.failed}</div>
            </div>
            <div className="summary-stat total">
              <div className="stat-label">Total</div>
              <div className="stat-value">{bulkResults.total_files}</div>
            </div>
          </div>

          <div className="results-table">
            <table>
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Status</th>
                  <th>Detected Date</th>
                  {!localFolderMode && <th>Size</th>}
                  {localFolderMode && <th>Path</th>}
                </tr>
              </thead>
              <tbody>
                {bulkResults.results.map((result: any, idx: number) => (
                  <tr key={idx} className={result.status}>
                    <td>{result.filename}</td>
                    <td>
                      <span className={`status-badge ${result.status}`}>
                        {localFolderMode
                          ? result.status === 'completed' ? 'Completed' : result.status === 'failed' ? 'Failed' : 'Error'
                          : result.status === 'uploaded' ? 'Uploaded' : 'Error'}
                      </span>
                    </td>
                    <td>{result.extracted_date || 'Not detected'}</td>
                    {!localFolderMode && <td>{result.size ? `${(result.size / 1024).toFixed(1)} KB` : '-'}</td>}
                    {localFolderMode && <td className="path-cell">{result.path}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filesNeedingDates.length > 0 && (
        <div className="files-needing-dates">
          <h3>Files Processed Without Date Detection</h3>
          <p className="info-message">
            The following {filesNeedingDates.length} file(s) were processed successfully but dates could not be auto-detected.
            They were processed with default dates. You can update them later in the database if needed.
          </p>
          <div className="files-list">
            {filesNeedingDates.map((file, idx) => (
              <div key={idx} className="file-item">
                <span className="file-index">#{file.index}</span>
                <span className="file-name">{file.filename}</span>
                <span className="file-status">No date detected</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ocr-info">
        <h3>About OCR Processing</h3>
        <p>
          This tool allows you to process newspaper images and extract text using Optical Character Recognition (OCR).
          The extracted text is then processed for:
        </p>
        <ul>
          <li>Article extraction and segmentation</li>
          <li>Named entity recognition (people, organizations, locations)</li>
          <li>Sentiment analysis</li>
          <li>Topic classification</li>
        </ul>
        <p>
          <strong>Processing modes:</strong>
        </p>
        <ul>
          <li><strong>Single Upload:</strong> Upload and process one image at a time</li>
          <li><strong>Bulk Upload:</strong> Upload and process multiple images from a folder</li>
          <li><strong>Local Folder:</strong> Process images directly from a local folder path without uploading (recommended for large batches)</li>
        </ul>
        <p>
          <strong>Processing time:</strong> Typically 5-10 minutes per newspaper page depending on image quality and size.
        </p>
      </div>
    </div>
  );
};

export default OCRTab;
