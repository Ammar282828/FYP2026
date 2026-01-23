// API Configuration
// This will use the environment variable if set, otherwise falls back to localhost for development
export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
export const API_BASE = `${API_BASE_URL}/api`;
