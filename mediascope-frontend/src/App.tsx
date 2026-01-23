import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MediaScopeDashboard from './MediaScopeDashboard';
import ArticleDetailPage from './components/ArticleDetailPage';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MediaScopeDashboard />} />
        <Route path="/article/:id" element={<ArticleDetailPage />} />
      </Routes>
    </Router>
  );
}

export default App;
