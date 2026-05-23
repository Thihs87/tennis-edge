'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect') || '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Falha no login');
      router.push(redirect);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Falha no login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 animate-fade-in">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-0.5">
            <span className="font-bold text-2xl tracking-tight">Tennis</span>
            <span className="font-bold text-2xl tracking-tight text-primary">Edge</span>
          </div>
          <p className="text-sm text-muted-foreground">Acesse para continuar</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border bg-card p-5 shadow-elevated">
          <div>
            <label htmlFor="username" className="text-xs font-medium text-muted-foreground block mb-1.5">
              Usuário
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading}
              autoComplete="username"
              autoFocus
              className="w-full px-4 py-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="password" className="text-xs font-medium text-muted-foreground block mb-1.5">
              Senha
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="current-password"
                className="w-full px-4 py-3 pr-12 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPwd(s => !s)}
                tabIndex={-1}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-lg"
                aria-label={showPwd ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPwd ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] enabled:glow-primary"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                Entrando...
              </>
            ) : (
              'Entrar'
            )}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Acesso restrito. Se você não tem credenciais, peça para o admin.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginForm />
    </Suspense>
  );
}
