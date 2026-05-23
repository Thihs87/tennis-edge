'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { MarketSelector } from '@/components/MarketSelector';
import { ConfidenceBar } from '@/components/ConfidenceBar';
import { EdgeBadge } from '@/components/EdgeBadge';
import { SurfaceBadge } from '@/components/SurfaceBadge';
import { PlayerStatsSection } from '@/components/PlayerStatsSection';
import { Skeleton } from '@/components/ui/skeleton';
import type { Market, ModelResult } from '@/services/model';

interface AnalysisData {
  result: ModelResult;
  justification: string;
  fetchedAt: string;
}

function AnalysisContent() {
  const params      = useSearchParams();
  const router      = useRouter();
  const p1          = params.get('p1') ?? '';
  const p2          = params.get('p2') ?? '';
  const surface     = params.get('surface') ?? 'Hard';
  const tourney     = params.get('tourney') ?? '';
  const round       = params.get('round') ?? '';

  const [market, setMarket]   = useState<Market>('moneyline');
  const [data, setData]       = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const fetchAnalysis = useCallback(async (m: Market) => {
    setLoading(true);
    setError('');
    try {
      const url = `/api/analysis?${new URLSearchParams({ p1, p2, surface, market: m }).toString()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro desconhecido');
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Falha na análise');
    } finally {
      setLoading(false);
    }
  }, [p1, p2, surface]);

  useEffect(() => { fetchAnalysis(market); }, [market, fetchAnalysis]);

  function handleMarketChange(m: Market) {
    setMarket(m);
  }

  if (!p1 || !p2) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center">
        <p className="text-muted-foreground">Partida não especificada.</p>
        <button onClick={() => router.push('/')} className="mt-4 text-sm underline">Voltar</button>
      </div>
    );
  }

  const result = data?.result;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}>
      {/* Back + match header */}
      <div className="space-y-1">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Voltar
        </button>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold">
            {p1} <span className="text-muted-foreground font-normal">vs</span> {p2}
          </h1>
          <SurfaceBadge surface={surface} />
        </div>
        {(tourney || round) && (
          <p className="text-sm text-muted-foreground">
            {[tourney, round].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {/* Market selector */}
      <MarketSelector selected={market} onChange={handleMarketChange} loading={loading} />

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => fetchAnalysis(market)}
            className="flex items-center gap-1.5 text-xs font-medium text-destructive/80 hover:text-destructive transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
            Tentar novamente
          </button>
        </div>
      )}

      {/* Results */}
      {!loading && result && (
        <>
          {/* Recommendation banner */}
          <EdgeBadge edge={result.edge} />

          {/* Main prediction card */}
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Sugestão</p>
              <p className="text-xl font-bold">{result.suggestion}</p>
              {result.reasoning && (
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  {result.reasoning}
                </p>
              )}
            </div>

            <ConfidenceBar value={result.confidence} />

            {result.oddValue && (
              <div className="flex items-center gap-3 text-sm pt-1 border-t">
                <span className="text-muted-foreground">Odd {result.bookmaker}</span>
                <span className="font-mono font-bold text-xl">{result.oddValue.toFixed(2)}</span>
                {result.impliedProbability && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    prob. implícita: {(result.impliedProbability * 100).toFixed(0)}%
                    {' · '}modelo: {(result.modelProbability * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Claude justification */}
          {data?.justification && (
            <div className="rounded-xl border bg-card p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">Análise</p>
              <p className="text-sm leading-relaxed">{data.justification}</p>
            </div>
          )}

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-1">
              {result.warnings.map((w, i) => (
                <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400 flex gap-2">
                  <span>⚠️</span>{w}
                </p>
              ))}
            </div>
          )}

          {/* Stats */}
          <PlayerStatsSection
            stats1={result.support.player1Stats}
            stats2={result.support.player2Stats}
            h2h={result.support.h2h}
          />
        </>
      )}
    </div>
  );
}

export default function AnalysisPage() {
  return (
    <div className="min-h-screen">
      <Header />
      <Suspense fallback={
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-3">
          <Skeleton className="h-8 w-48 rounded" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      }>
        <AnalysisContent />
      </Suspense>
    </div>
  );
}
