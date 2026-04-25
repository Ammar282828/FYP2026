import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './components/ui/Toast';
import MediaScopeDashboard from './MediaScopeDashboard';
import ArticleDetailPage from './components/ArticleDetailPage';
import TopicDetailPage from './components/TopicDetailPage';
import EntityPage from './components/EntityPage';
import CommandPalette from './components/CommandPalette';
import ShortcutsPanel from './components/ShortcutsPanel';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import './App.css';

// Tiny inner component so the keyboard hook can use react-router context.
// Mounting CommandPalette + ShortcutsPanel here means they work on every
// route — previously they only existed inside MediaScopeDashboard, so
// `?` and Cmd+K were dead on the article/topic/entity detail pages.
function GlobalChrome() {
  useGlobalShortcuts();
  return (
    <>
      <CommandPalette />
      <ShortcutsPanel />
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <Router>
            <GlobalChrome />
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
