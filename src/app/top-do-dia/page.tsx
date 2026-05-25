'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { TopPickCard } from '@/components/TopPickCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { TopPicksResult, TopPick } from '@/services/topPicks';

function formatHour(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return '';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
    });
  } catch {
    return '';
  }
}

function formatTargetDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return '';
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const date = new Date(y, m, d);
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}

export default function TopDoDiaPage() {
  const [data, setData]       = useState<TopPicksResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function load(force = false) {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = await fetch(force ? '/api/top-do-dia?force=true' : '/api/top-do-dia');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro desconhecido');
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar top do dia');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const hasAny = data && (data.topPicks.length > 0 || data.mediumPicks.length > 0);

  return (
    <div className="min-h-screen">
      <Header />

      <main
        className="max-w-3xl mx-auto px-4 py-6 space-y-5"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
      >
        {/* Hero */}
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Top do dia</h1>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                As melhores apostas entre as partidas {data?.targetDate ? `de ${formatTargetDate(data.targetDate)}` : 'do dia seguinte'} que ainda não começaram.
              </p>
            </div>
            <button
              type="button"
              onClick={() => load(true)}
              disabled={loading || refreshing}
              className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              title="Recalcular agora"
              aria-label="Recalcular"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? 'animate-spin' : ''}>
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                <path d="M8 16H3v5"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-48 w-full rounded-2xl" />
            <Skeleton className="h-44 w-full rounded-2xl" />
            <Skeleton className="h-44 w-full rounded-2xl" />
          </div>
        )}

        {/* Erro */}
        {!loading && error && (
          <div className="rounded-2xl border border-destructive/50 bg-destructive/10 p-4 space-y-2">
            <p className="text-sm font-medium text-destructive">Falha ao carregar</p>
            <p className="text-xs text-destructive/80">{error}</p>
            <button
              type="button"
              onClick={() => load(true)}
              className="text-xs font-medium text-destructive/80 hover:text-destructive underline"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Vazio total */}
        {!loading && !error && data && !hasAny && (
          <div className="rounded-2xl border bg-card p-8 text-center space-y-3">
            <p className="text-3xl">🎾</p>
            <p className="font-semibold">Sem partidas pra analisar</p>
            <p className="text-sm text-muted-foreground">
              {data.sourceMatchCount === 0
                ? 'Não encontramos partidas elegíveis para amanhã. Volte mais tarde quando o calendário estiver definido.'
                : `Analisamos ${data.sourceMatchCount} partidas, mas nenhuma teve confiança suficiente pra entrar nas listas.`
              }
            </p>
          </div>
        )}

        {/* Resultados */}
        {!loading && !error && data && hasAny && (
          <>
            <p className="text-xs text-muted-foreground">
              Analisamos {data.sourceMatchCount} {data.sourceMatchCount === 1 ? 'partida' : 'partidas'} de amanhã.
            </p>

            {/* Bloco 1: Top 3 */}
            {data.topPicks.length > 0 && (
              <section className="space-y-3">
                <SectionHeader
                  emoji="🏆"
                  title="Top 3 do dia"
                  subtitle="As 3 apostas com maior confiança do modelo, em qualquer mercado."
                />
                <div className="space-y-3 animate-stagger">
                  {data.topPicks.map((pick, i) => (
                    <TopPickCard key={`top-${i}`} pick={pick} rank={(i + 1) as 1 | 2 | 3} />
                  ))}
                </div>
              </section>
            )}

            {/* Bloco 2: Intermediárias */}
            {data.mediumPicks.length > 0 && (
              <section className="space-y-3 pt-2">
                <SectionHeader
                  emoji="🎲"
                  title="Apostas intermediárias"
                  subtitle="Confiança entre 70% e 80% — mais ousadas, geralmente com odds melhores que as do Top."
                />
                <div className="space-y-3 animate-stagger">
                  {data.mediumPicks.map((pick, i) => (
                    <MediumPickCard key={`med-${i}`} pick={pick} index={i + 1} />
                  ))}
                </div>
              </section>
            )}

            {/* Footer */}
            <div className="rounded-xl border bg-card/50 p-3 text-xs text-muted-foreground text-center space-y-0.5">
              <p>Lista gerada às {formatHour(data.generatedAt)} de {formatDate(data.generatedAt)}.</p>
              <p>Próxima atualização automática à meia-noite (ou use o botão de recarregar acima).</p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ─── Sub-componentes locais ─────────────────────────────────────────────────

function SectionHeader({ emoji, title, subtitle }: { emoji: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-2xl shrink-0 mt-0.5">{emoji}</span>
      <div>
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">{subtitle}</p>
      </div>
    </div>
  );
}

// Card simplificado pra apostas intermediárias (sem medalha)
function MediumPickCard({ pick, index }: { pick: TopPick; index: number }) {
  // Reaproveita o TopPickCard só que sem o ranking de medalha.
  // Pra manter consistência visual, faço wrap usando o próprio TopPickCard com rank=3
  // mas com um indicador numérico discreto no canto.
  // Solução simples: render direto um card próprio, parecido com o TopPickCard.
  return <TopPickCard pick={pick} rank={3} indexLabel={`#${index}`} />;
}
