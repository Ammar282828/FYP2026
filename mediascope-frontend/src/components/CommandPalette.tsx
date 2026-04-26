import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Search,
  Home,
  BookOpen,
  BarChart,
  User,
  Upload,
  Square,
  Shuffle,
  FileText,
  Command as CommandIcon,
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
} from 'lucide-react';
import { API_BASE } from '../config';

interface CommandPaletteProps {
  // Optional callback for tab switching from inside the dashboard.
  // When mounted at App level (so the palette works on detail pages),
  // we fall back to navigating to `/?tab=...` instead.
  onNavigate?: (tab: string) => void;
}

type ResultIcon = React.ComponentType<{ size?: number | string }>;

interface SearchResult {
  id: string;
  type: 'article' | 'topic' | 'nav' | 'action';
  title: string;
  subtitle?: string;
  Icon: ResultIcon;
}

const NAV_ITEMS: SearchResult[] = [
  { id: 'nav-home',       type: 'nav',    title: 'Home',          subtitle: 'Go to dashboard',                      Icon: Home },
  { id: 'nav-search',     type: 'nav',    title: 'Search',        subtitle: 'Search articles',                      Icon: Search },
  { id: 'nav-stories',    type: 'nav',    title: 'Stories',       subtitle: 'Browse stories',                       Icon: BookOpen },
  { id: 'nav-analytics',  type: 'nav',    title: 'Analytics',     subtitle: 'View analytics',                       Icon: BarChart },
  { id: 'nav-profile',    type: 'nav',    title: 'Profile',       subtitle: 'Your bookmarks & history',             Icon: User },
  { id: 'nav-ocr',        type: 'nav',    title: 'OCR Upload',    subtitle: 'Upload newspaper',                     Icon: Upload },
  { id: 'nav-ad-browser', type: 'nav',    title: 'Ad Browser',    subtitle: 'Browse ads',                           Icon: Square },
  { id: 'action-random',  type: 'action', title: 'Random Article', subtitle: 'Open a random article from the archive', Icon: Shuffle },
];

const CommandPalette: React.FC<CommandPaletteProps> = ({ onNavigate }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>(NAV_ITEMS);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Cmd+K / Ctrl+K toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Sync state with the native <dialog>; reset query/selection on open.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      setQuery('');
      setResults(NAV_ITEMS);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    if (!open && dlg.open) dlg.close();
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
        subtitle: `${a.publication_date?.slice(0, 10) || ''} • ${a.sentiment_label || ''}`,
        Icon: FileText,
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

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog cmd-dialog"
      onClose={() => setOpen(false)}
      onClick={(e) => {
        if (e.target === dialogRef.current) setOpen(false);
      }}
    >
      <div className="cmd-input-row">
        <Search size={16} className="cmd-search-icon" />
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder="Search articles, navigate…"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <kbd className="kbd">esc</kbd>
      </div>

      <div className="cmd-results">
        {searching && (
          <div className="cmd-searching">Searching the archive…</div>
        )}

        {!query && <div className="section-eyebrow cmd-section-label">Quick navigation</div>}
        {query && results.length > 0 && (
          <div className="section-eyebrow cmd-section-label">Results</div>
        )}

        {results.map((r, i) => {
          const Icon = r.Icon;
          return (
            <button
              key={r.id}
              className={`cmd-result ${i === selected ? 'cmd-result-active' : ''}`}
              onClick={() => executeResult(r)}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="cmd-result-icon"><Icon size={16} /></span>
              <div className="cmd-result-text">
                <span className="cmd-result-title">{r.title}</span>
                {r.subtitle && <span className="cmd-result-sub">{r.subtitle}</span>}
              </div>
              <span className="cmd-result-type">{r.type}</span>
            </button>
          );
        })}

        {query && results.length === 0 && !searching && (
          <div className="empty-state">
            <Search size={28} className="empty-state__icon" />
            <div className="empty-state__title">Nothing matched “{query}”</div>
            <div className="empty-state__body">
              Try a different keyword or jump back to a section above.
            </div>
          </div>
        )}
      </div>

      <div className="app-dialog__footer cmd-footer">
        <span className="cluster"><kbd className="kbd"><ArrowUp size={10} /></kbd><kbd className="kbd"><ArrowDown size={10} /></kbd> navigate</span>
        <span className="cluster"><kbd className="kbd"><CornerDownLeft size={10} /></kbd> open</span>
        <span className="cluster"><kbd className="kbd">esc</kbd> close</span>
        <span className="cluster" style={{ marginLeft: 'auto' }}>
          <CommandIcon size={11} /> command palette
        </span>
      </div>
    </dialog>
  );
};

export default CommandPalette;
