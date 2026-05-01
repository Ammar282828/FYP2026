import React, { useState, useRef, useEffect } from 'react';
import { X, BookOpenText } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface AuthPageProps {
  onClose?: () => void;
  initialMode?: 'login' | 'register';
}

/**
 * Auth dialog. Uses the native <dialog> element instead of a hand-rolled
 * overlay+card so we get focus trapping, escape-to-close, and the proper
 * `::backdrop` pseudo-element for free. Falls back gracefully when
 * `onClose` isn't passed (the dialog opens on mount and locks the screen
 * — useful for the protected-route flow).
 */
const AuthPage: React.FC<AuthPageProps> = ({ onClose, initialMode = 'login' }) => {
  const { login, register } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (typeof dlg.showModal === 'function' && !dlg.open) {
      dlg.showModal();
    }
    return () => {
      if (dlg.open) dlg.close();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        if (!name.trim()) {
          setError('Name is required');
          setLoading(false);
          return;
        }
        await register(email, password, name);
      }
      if (onClose) onClose();
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Something went wrong';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const isLogin = mode === 'login';

  return (
    <dialog ref={dialogRef} className="auth-dialog" onClose={onClose}>
      <form method="dialog" onSubmit={handleSubmit} className="auth-form">
        {onClose && (
          <button
            type="button"
            className="auth-dialog__close btn btn--ghost btn--sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        )}

        <header className="auth-dialog__header">
          <BookOpenText size={28} strokeWidth={1.5} className="auth-dialog__mark" />
          <div>
            <div className="section-eyebrow">MediaScope</div>
            <h2 className="auth-dialog__title">
              {isLogin ? 'Sign in to continue' : 'Create your account'}
            </h2>
          </div>
        </header>

        <div className="auth-form__fields">
          {!isLogin && (
            <label className="auth-field">
              <span className="auth-field__label">Name</span>
              <input
                type="text"
                className="auth-field__input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />
            </label>
          )}

          <label className="auth-field">
            <span className="auth-field__label">Email</span>
            <input
              type="email"
              className="auth-field__input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </label>

          <label className="auth-field">
            <span className="auth-field__label">Password</span>
            <input
              type="password"
              className="auth-field__input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={isLogin ? 'Your password' : 'At least 6 characters'}
              required
              minLength={6}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </label>
        </div>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn btn--primary btn--lg auth-submit"
          disabled={loading}
        >
          {loading ? 'Please wait…' : (isLogin ? 'Sign in' : 'Create account')}
        </button>

        <button
          type="button"
          className="auth-toggle"
          onClick={() => { setMode(isLogin ? 'register' : 'login'); setError(''); }}
        >
          {isLogin ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
        </button>
      </form>
    </dialog>
  );
};

export default AuthPage;
