import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE } from '../config';

interface CommandPaletteProps {
  // Optional callback for tab switching from inside the dashboard.
  // When mounted at App level (so the palette works on detail pages),
  // we fall back to navigating to `/?tab=...` instead.
  onNavigate?: (tab: string) => void;
}

interface SearchResult {
  id: string;
  type: 'article' | 'topic' | 'nav' | 'action';
  title: string;
  subtitle?: string;
  icon: string;
}

const NAV_ITEMS: SearchResult[] = [
  { id: 'nav-home',      type: 'nav', title: 'Home',       subtitle: 'Go to dashboard', icon: '\u2302' },
  { id: 'nav-search',    type: 'nav', title: 'Search',     subtitle: 'Search articles',  icon: '\u2315' },
  { id: 'nav-stories',   type: 'nav', title: 'Stories',    subtitle: 'Browse stories',   icon: '\u2261' },
  { id: 'nav-analytics', type: 'nav', title: 'Analytics',  subtitle: 'View analytics',   icon: '\u2237' },
  { id: 'nav-profile',   type: 'nav', title: 'Profile',    subtitle: 'Your bookmarks & history', icon: '\u25CB' },
  { id: 'nav-ocr',       type: 'nav', title: 'OCR Upload', subtitle: 'Upload newspaper', icon: '\u21E7' },
  { id: 'nav-ad-browser',type: 'nav', title: 'Ad Browser', subtitle: 'Browse ads',       icon: '\u25A1' },
  { id: 'action-random', type: 'action', title: 'Random Article', subtitle: 'Open a random article from the archive', icon: '\uD83C\uDFB2' },
];

const CommandPalette: React.FC<CommandPaletteProps> = ({ onNavigate }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>(NAV_ITEMS);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Cmd+K / Ctrl+K toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults(NAV_ITEMS);
      setSelected(0);
    }
  }, [open]);

  // Search logic
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults(NAV_ITEMS);
      setSearching(false);
      return;
    }

    const lower = q.toLowerCase();

    // Filter nav items
    const navMatches = NAV_ITEMS.filter(n =>
      n.title.toLowerCase().includes(lower) || n.subtitle?.toLowerCase().includes(lower)
    );

    // Search articles via API
    setSearching(true);
    try {
      const res = await axios.post(`${API_BASE}/search/keyword`, { keyword: q, limit: 6 });
      const articles: SearchResult[] = (res.data.articles || []).map((a: any) => ({
        id: a.id,
        type: 'article' as const,
        title: a.headline || 'Untitled',
        subtitle: `${a.publication_date?.slice(0, 10) || ''} \u2022 ${a.sentiment_label || ''}`,
        icon: '\u2637'
      }));
      setResults([...navMatches, ...articles]);
    } catch {
      setResults(navMatches);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setSelected(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const executeResult = async (result: SearchResult) => {
    setOpen(false);
    if (result.type === 'nav') {
      const tab = result.id.replace('nav-', '');
      if (onNavigate) {
        // Inside the dashboard — switch tabs without a route change.
        onNavigate(tab);
      } else {
        // App-level mount — drive the dashboard via its URL state.
        navigate(`/?tab=${tab}`);
      }
    } else if (result.type === 'article') {
      navigate(`/article/${result.id}`);
    } else if (result.type === 'action' && result.id === 'action-random') {
      try {
        const res = await axios.get(`${API_BASE}/articles/random`);
        const id = res.data?.article?.id;
        if (id) navigate(`/article/${id}`);
      } catch (err) {
        console.error('Failed to load random article', err);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(s => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(s => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && results[selected]) {
      executeResult(results[selected]);
    }
  };

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={() => setOpen(false)}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-row">
          <span className="cmd-search-icon">{'\u2315'}</span>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search articles, navigate..."
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="cmd-kbd">esc</kbd>
        </div>

        <div className="cmd-results">
          {searching && (
            <div className="cmd-searching">Searching...</div>
          )}

          {!query && <div className="cmd-section-label">Quick Navigation</div>}
          {query && results.length > 0 && <div className="cmd-section-label">Results</div>}

          {results.map((r, i) => (
            <button
              key={r.id}
              className={`cmd-result ${i === selected ? 'cmd-result-active' : ''}`}
              onClick={() => executeResult(r)}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="cmd-result-icon">{r.icon}</span>
              <div className="cmd-result-text">
                <span className="cmd-result-title">{r.title}</span>
                {r.subtitle && <span className="cmd-result-sub">{r.subtitle}</span>}
              </div>
              <span className="cmd-result-type">{r.type}</span>
            </button>
          ))}

          {query && results.length === 0 && !searching && (
            <div className="cmd-empty">No results for "{query}"</div>
          )}
        </div>

        <div className="cmd-footer">
          <span><kbd>{'\u2191'}</kbd><kbd>{'\u2193'}</kbd> navigate</span>
          <span><kbd>{'\u21B5'}</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
