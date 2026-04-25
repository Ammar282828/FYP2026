import React, { useEffect, useState } from 'react';

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
    section: 'Navigation (press g, then\u2026)',
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      // `?` is Shift+/ on most layouts
      if (e.key === '?' && !isEditableTarget(e.target)) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '90vw',
          maxHeight: '75vh',
          overflowY: 'auto',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: 16,
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
          padding: '1.25rem 1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Keyboard Shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '1rem',
              padding: '4px 8px',
            }}
            aria-label="Close"
          >
            {'\u2715'}
          </button>
        </div>

        {SHORTCUTS.map(group => (
          <div key={group.section} style={{ marginBottom: '1rem' }}>
            <div
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: 'var(--text-secondary)',
                marginBottom: 8,
              }}
            >
              {group.section}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.items.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <span style={{ fontSize: 13 }}>{item.description}</span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    {item.keys.map((k, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && (
                          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>or</span>
                        )}
                        {k.split('+').map((part, idx, arr) => (
                          <React.Fragment key={idx}>
                            <kbd
                              style={{
                                padding: '2px 8px',
                                borderRadius: 4,
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-color)',
                                fontSize: 12,
                                fontFamily:
                                  'ui-monospace, SFMono-Regular, Menlo, monospace',
                                color: 'var(--text-primary)',
                              }}
                            >
                              {part}
                            </kbd>
                            {idx < arr.length - 1 && (
                              <span
                                style={{
                                  color: 'var(--text-tertiary)',
                                  fontSize: 12,
                                  alignSelf: 'center',
                                }}
                              >
                                +
                              </span>
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

        <div
          style={{
            marginTop: '0.5rem',
            fontSize: 11,
            color: 'var(--text-tertiary)',
            textAlign: 'center',
          }}
        >
          Press <kbd style={{ fontFamily: 'monospace' }}>?</kbd> again to close
        </div>
      </div>
    </div>
  );
};

export default ShortcutsPanel;
