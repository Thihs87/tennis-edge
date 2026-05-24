'use client';

import { useRouter } from 'next/navigation';
import { SurfaceBadge } from './SurfaceBadge';
import { ConfidenceBar } from './ConfidenceBar';
import type { TopPick } from '@/services/topPicks';
import type { Market } from '@/services/model';

interface Props {
  pick: TopPick;
  rank: 1 | 2 | 3;
}

const MARKET_NAMES: Record<Market, string> = {
  moneyline:   'Vencedor da partida',
  first_set:   'Vencedor do 1º set',
  total_sets:  'Total de sets',
  total_games: 'Total de games',
  total_aces:  'Total de aces',
  total_dfs:   'Duplas faltas',
};

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' } as const;

function formatTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return '';
  }
}

export function TopPickCard({ pick, rank }: Props) {
  const router = useRouter();
  const { match, result } = pick;

  // Selo de qualidade
  const confidence = result.confidence;
  const qualityBadge =
    confidence >= 0.70 ? null :
    confidence >= 0.65 ? { tone: 'amber',  label: 'Confiança moderada',  icon: '🟡' } :
                         { tone: 'rose',   label: 'Confiança baixa',      icon: '🔴' };

  const badgeClass =
    qualityBadge?.tone === 'amber' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30' :
    qualityBadge?.tone === 'rose'  ? 'bg-rose-500/15  text-rose-700  dark:text-rose-400  border-rose-500/30'  :
    '';

  // Destaque pra primeiro lugar
  const cardClass = rank === 1
    ? 'rounded-2xl border-gradient bg-card p-5 shadow-elevated space-y-3'
    : 'rounded-2xl border bg-card p-5 shadow-elevated space-y-3';

  function handleOpenSimulator() {
    const params = new URLSearchParams({
      p1: match.player1,
      p2: match.player2,
      surface: match.surface,
    });
    if (match.tourneyName) params.set('tourney', match.tourneyName);
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className={cardClass}>
      {/* Cabeçalho: medalha + mercado + horário */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-2xl shrink-0">{MEDALS[rank]}</span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
              {MARKET_NAMES[result.market]}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {formatTime(match.startTime) || match.scheduledTime || 'horário não disponível'}
            </p>
          </div>
        </div>
        {qualityBadge && (
          <span className={`shrink-0 text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full border ${badgeClass}`}>
            {qualityBadge.icon} {qualityBadge.label}
          </span>
        )}
      </div>

      {/* Sugestão */}
      <div>
        <p className="text-2xl font-bold tracking-tight leading-tight">{result.suggestion}</p>
        <div className="flex items-center gap-2 flex-wrap mt-1.5">
          <p className="text-sm">
            {match.player1} <span className="text-muted-foreground font-normal">vs</span> {match.player2}
          </p>
          <SurfaceBadge surface={match.surface} small />
          {match.tourneyName && (
            <span className="text-xs text-muted-foreground truncate">· {match.tourneyName}</span>
          )}
        </div>
      </div>

      {/* Confidence */}
      <ConfidenceBar value={result.confidence} />

      {/* Reasoning */}
      {result.reasoning && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {result.reasoning}
        </p>
      )}

      {/* CTA */}
      <button
        type="button"
        onClick={handleOpenSimulator}
        className="w-full mt-1 py-2.5 rounded-xl border text-sm font-semibold text-primary hover:bg-primary/10 active:scale-[0.98] transition-all"
      >
        Abrir no simulador →
      </button>
    </div>
  );
}
