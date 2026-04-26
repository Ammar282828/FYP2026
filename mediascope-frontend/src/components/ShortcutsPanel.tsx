import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, X } from 'lucide-react';

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: { section: string; items: Shortcut[] }[] = [
  {
    section: 'Global',
    items: [
      { keys: ['/', 'Cmd+K'], description: 'Open command palette' },
      { keys: ['?'], description: 'Toggle this help' },
      { keys: ['Esc'], description: 'Close modals' },
    ],
  },
  {
    section: 'Navigation (press g, then…)',
    items: [
      { keys: ['g h'], description: 'Go to Home' },
      { keys: ['g s'], description: 'Go to Search' },
      { keys: ['g a'], description: 'Go to Analytics' },
      { keys: ['g p'], description: 'Go to Profile' },
      { keys: ['g b'], description: 'Go to Bookmarks (Profile)' },
    ],
  },
  {
    section: 'Article actions',
    items: [
      { keys: ['b'], description: 'Bookmark current article' },
      { keys: ['r'], description: 'Open a random article' },
    ],
  },
];

const isEditableTarget = (el: EventTarget | null): boolean => {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
};

const ShortcutsPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // `?` is Shift+/ on most layouts.
      if (e.key === '?' && !isEditableTarget(e.target)) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Sync state with the native <dialog>.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog"
      onClose={() => setOpen(false)}
      onClick={(e) => {
        // Click on backdrop closes the dialog.
        if (e.target === dialogRef.current) setOpen(false);
      }}
    >
      <header className="app-dialog__header">
        <h2 className="app-dialog__title">
          <Keyboard size={16} />
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </header>

      <div className="app-dialog__body stack">
        {SHORTCUTS.map(group => (
          <div key={group.section} className="stack stack--tight">
            <div className="section-eyebrow">{group.section}</div>
            <div className="stack stack--tight">
              {group.items.map((item, i) => (
                <div key={i} className="shortcut-row">
                  <span className="shortcut-row__desc">{item.description}</span>
                  <span className="cluster">
                    {item.keys.map((k, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && (
                          <span className="shortcut-row__sep">or</span>
                        )}
                        {k.split('+').map((part, idx, arr) => (
                          <React.Fragment key={idx}>
                            <kbd className="kbd">{part}</kbd>
                            {idx < arr.length - 1 && (
                              <span className="shortcut-row__sep">+</span>
                            )}
                          </React.Fragment>
                        ))}
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <footer className="app-dialog__footer">
        Press <kbd className="kbd">?</kbd> again to close.
      </footer>
    </dialog>
  );
};

export default ShortcutsPanel;
