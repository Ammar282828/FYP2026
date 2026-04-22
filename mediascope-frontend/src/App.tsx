import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './components/ui/Toast';
import MediaScopeDashboard from './MediaScopeDashboard';
import ArticleDetailPage from './components/ArticleDetailPage';
import TopicDetailPage from './components/TopicDetailPage';
import EntityPage from './components/EntityPage';
import './App.css';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <Router>
            <Routes>
              <Route path="/" element={<MediaScopeDashboard />} />
              <Route path="/article/:id" element={<ArticleDetailPage />} />
              <Route path="/topic/:id" element={<TopicDetailPage />} />
              <Route path="/entity/:name" element={<EntityPage />} />
            </Routes>
          </Router>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
