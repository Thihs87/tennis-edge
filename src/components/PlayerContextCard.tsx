'use client';

import { useState } from 'react';

interface Source {
  title: string;
  url: string;
  publisher: string;
  when: string;
}

interface ContextResult {
  summary: string;
  sources: Source[];
  fetchedAt: string;
  warning?: string;
}

interface Props {
  p1: string;
  p2: string;
}

export function PlayerContextCard({ p1, p2 }: Props) {
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<ContextResult | null>(null);
  const [error, setError]           = useState('');
  const [showSources, setShowSources] = useState(false);

  async function fetchContext() {
    setLoading(true);
    setError('');
    setResult(null);
    setShowSources(false);
    try {
      const res = await fetch('/api/player-context', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ p1, p2 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro desconhecido');
      setResult(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Falha ao buscar contexto');
    } finally {
      setLoading(false);
    }
  }

  // Estado inicial
  if (!result && !loading && !error) {
    return (
      <button
        type="button"
        onClick={fetchContext}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <span>📰</span>
        Buscar contexto recente sobre os jogadores
      </button>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
        <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Buscando notícias recentes na web...</p>
      </div>
    );
  }

  // Erro
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 space-y-2">
        <p className="text-sm font-medium text-destructive">Falha ao buscar contexto</p>
        <p className="text-xs text-destructive/80">{error}</p>
        <button
          type="button"
          onClick={fetchContext}
          className="text-xs font-medium text-destructive/80 hover:text-destructive underline"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!result) return null;

  const hasSummary  = !!result.summary?.trim();
  const hasSources  = result.sources.length > 0;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">📰</span>
          <p className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Contexto recente</p>
        </div>
        <p className="text-xs text-muted-foreground italic">
          Informativo apenas. Estas notícias não entram nos cálculos do modelo.
        </p>
      </div>

      {result.warning && (
        <p className="text-xs text-yellow-600 dark:text-yellow-500">
          ⚠️ {result.warning}
        </p>
      )}

      {!hasSummary && !hasSources ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma notícia relevante encontrada nos últimos 30 dias sobre os jogadores.
        </p>
      ) : (
        <>
          {hasSummary && (
            <p className="text-sm leading-relaxed">{result.summary}</p>
          )}

          {hasSources && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowSources(!showSources)}
                className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
              >
                <span>{showSources ? '▼' : '▶'}</span>
                {showSources ? 'Ocultar fontes' : `Ler matérias completas (${result.sources.length})`}
              </button>

              {showSources && (
                <ul className="mt-2 space-y-2">
                  {result.sources.map((src, i) => (
                    <li key={i} className="text-xs">
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground hover:text-primary transition-colors underline decoration-muted-foreground/40 hover:decoration-primary/60 block leading-relaxed"
                      >
                        {src.title}
                      </a>
                      <span className="text-muted-foreground">
                        {src.publisher}
                        {src.when ? ` · ${src.when}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <button
        type="button"
        onClick={fetchContext}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
      >
        ↻ Atualizar busca
      </button>
    </div>
  );
}
