'use client';

import { useRouter } from 'next/navigation';
import type { OngoingMatch } from '@/types/tennis';
import { SurfaceBadge } from './SurfaceBadge';

interface Props {
  match: OngoingMatch;
}

function RankBadge({ rank }: { rank: number }) {
  if (!rank || rank <= 0) return null;
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground tabular-nums leading-none">
      #{rank}
    </span>
  );
}

export function MatchCard({ match }: Props) {
  const router = useRouter();

  function handleClick() {
    // Navega pro simulador com os campos pré-preenchidos
    const params = new URLSearchParams({
      p1: match.player1,
      p2: match.player2,
      surface: match.surface,
    });
    if (match.tourneyName) params.set('tourney', match.tourneyName);
    if (match.round)      params.set('round',   match.round);
    router.push(`/?${params.toString()}`);
  }

  return (
    <button
      onClick={handleClick}
      className="w-full text-left rounded-2xl border border-l-4 border-l-primary bg-card hover:bg-accent/50 active:scale-[0.99] transition-all p-4 space-y-3"
    >
      {/* Players VS layout */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="font-bold text-sm leading-snug">{match.player1}</p>
          <RankBadge rank={match.player1Rank} />
        </div>

        <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          <span className="text-[10px] font-bold text-muted-foreground tracking-wider">vs</span>
        </div>

        <div className="flex-1 min-w-0 text-right space-y-1.5">
          <p className="font-bold text-sm leading-snug">{match.player2}</p>
          <div className="flex justify-end">
            <RankBadge rank={match.player2Rank} />
          </div>
        </div>
      </div>

      {/* Separator */}
      <div className="border-t border-border/50" />

      {/* Bottom row: tourney info + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0 flex-wrap">
          <SurfaceBadge surface={match.surface} small />
          {match.tourneyName && <span className="truncate">{match.tourneyName}</span>}
          {match.round && <><span>·</span><span>{match.round}</span></>}
          {match.scheduledTime && <><span>·</span><span className="shrink-0">{match.scheduledTime}</span></>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {match.status === 'live' && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              Ao vivo
            </span>
          )}
          <span className="text-xs text-primary font-medium opacity-70">Analisar →</span>
        </div>
      </div>
    </button>
  );
}
