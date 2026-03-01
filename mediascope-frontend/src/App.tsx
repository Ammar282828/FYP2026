import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MediaScopeDashboard from './MediaScopeDashboard';
import ArticleDetailPage from './components/ArticleDetailPage';
import TopicDetailPage from './components/TopicDetailPage';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MediaScopeDashboard />} />
        <Route path="/article/:id" element={<ArticleDetailPage />} />
        <Route path="/topic/:id" element={<TopicDetailPage />} />
      </Routes>
    </Router>
  );
}

export default App;
