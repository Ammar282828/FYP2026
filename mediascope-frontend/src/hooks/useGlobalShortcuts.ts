/**
 * useGlobalShortcuts — implements the keyboard shortcuts the Help panel
 * advertises (`?`).
 *
 * Until now the Help panel listed shortcuts that nothing actually wired
 * up: `/`, `g h/s/b/p`, `r`, `b`. They've been silent props. This hook
 * is the single place that handles all of them so the next person can
 * find the implementation without grepping six files.
 *
 * Shortcuts
 * ---------
 *   /            → open the command palette (synthesizes Cmd+K)
 *   g h          → navigate to Home tab
 *   g s          → navigate to Search tab
 *   g b          → navigate to Bookmarks (Profile > Bookmarks if logged in)
 *   g p          → navigate to Profile
 *   r            → open a random article
 *   b            → bookmark the current article (when on /article/:id)
 *
 * `Cmd+K` and `?` are still owned by the components that show the
 * matching UI — CommandPalette and ShortcutsPanel respectively — so they
 * keep working even on routes that don't mount this hook.
 *
 * Editable-target guard
 * ---------------------
 * Single-key shortcuts are skipped when focus is in an input/textarea/
 * contenteditable. Otherwise the user can't type `b` in the search bar.
 */
import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { API_BASE } from '../config';

const isEditableTarget = (el: EventTarget | null): boolean => {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
};

const G_SEQUENCE_WINDOW_MS = 1200;

export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  // Refs so the listener stays stable across renders and we don't
  // re-bind on every navigate.
  const navRef = useRef(navigate);
  const locRef = useRef(location);
  useEffect(() => { navRef.current = navigate; }, [navigate]);
  useEffect(() => { locRef.current = location; }, [location]);

  // Sequence state for `g <something>` two-key combos.
  const gPrimedRef = useRef<number | null>(null);

  useEffect(() => {
    const goToTab = (tab: string) => {
      // ?tab= is the dashboard's URL-driven state. Replacing the URL
      // here means the dashboard re-renders into that tab when it mounts.
      navRef.current(`/?tab=${tab}`);
    };

    const openRandom = async () => {
      try {
        const res = await axios.get(`${API_BASE}/articles/random`);
        const id = res.data?.article?.id;
        if (id) navRef.current(`/article/${id}`);
      } catch (err) {
        console.error('random article failed', err);
      }
    };

    const handler = (e: KeyboardEvent) => {
      // Never swallow modifier-driven keys other than Cmd+K — those
      // belong to the OS / other components.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      const key = e.key;

      // `/` — open command palette (synthesize the Cmd+K it already listens for).
      if (key === '/') {
        e.preventDefault();
        gPrimedRef.current = null;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
        return;
      }

      // Two-key `g <x>` sequence.
      const now = Date.now();
      const primed = gPrimedRef.current;
      if (primed !== null && now - primed < G_SEQUENCE_WINDOW_MS) {
        if (key === 'h') { e.preventDefault(); gPrimedRef.current = null; goToTab('home'); return; }
        if (key === 's') { e.preventDefault(); gPrimedRef.current = null; goToTab('search'); return; }
        if (key === 'b') { e.preventDefault(); gPrimedRef.current = null; goToTab('profile'); return; }
        if (key === 'p') { e.preventDefault(); gPrimedRef.current = null; goToTab('profile'); return; }
        if (key === 'a') { e.preventDefault(); gPrimedRef.current = null; goToTab('analytics'); return; }
        gPrimedRef.current = null;
      }

      if (key === 'g') {
        gPrimedRef.current = now;
        return;
      }

      // Single-letter actions.
      if (key === 'r') {
        e.preventDefault();
        openRandom();
        return;
      }

      if (key === 'b') {
        // Only meaningful on an article page. Re-broadcast as a custom
        // event so ArticleDetailPage's bookmark button can act without
        // being aware of the global shortcut layer.
        if (locRef.current.pathname.startsWith('/article/')) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('mediascope:toggle-bookmark'));
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
