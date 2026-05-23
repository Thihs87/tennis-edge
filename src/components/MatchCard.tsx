'use client';

import { useRouter } from 'next/navigation';
import type { OngoingMatch } from '@/types/tennis';
import type { MatchPreview } from '@/services/model';
import { SurfaceBadge } from './SurfaceBadge';

interface Props {
  match: OngoingMatch;
  preview?: MatchPreview;
  featured?: boolean;
}

function RankBadge({ rank }: { rank: number }) {
  if (!rank || rank <= 0) return null;
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground tabular-nums leading-none">
      #{rank}
    </span>
  );
}

function ConfidenceColor(confidence: number): string {
  if (confidence >= 0.65) return 'text-green-500 dark:text-green-400';
  if (confidence >= 0.55) return 'text-yellow-500 dark:text-yellow-400';
  return 'text-muted-foreground';
}

export function MatchCard({ match, preview, featured }: Props) {
  const router = useRouter();

  function handleClick() {
    const params = new URLSearchParams({
      p1: match.player1,
      p2: match.player2,
      surface: match.surface,
      tourney: match.tourneyName,
      round: match.round,
    });
    router.push(`/analysis?${params.toString()}`);
  }

  return (
    <button
      onClick={handleClick}
      className={`w-full text-left rounded-xl border border-l-4 border-l-primary transition-colors p-4 space-y-3 ${
        featured
          ? 'bg-primary/5 hover:bg-primary/10'
          : 'bg-card hover:bg-accent/50'
      }`}
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

      {/* Tip text for featured cards */}
      {featured && preview?.tip && (
        <p className="text-xs text-muted-foreground leading-relaxed italic border-l-2 border-primary/40 pl-2">
          {preview.tip}
        </p>
      )}

      {/* Separator */}
      <div className="border-t border-border/50" />

      {/* Bottom row: tourney info + badges */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0 flex-wrap">
          <SurfaceBadge surface={match.surface} small />
          <span className="truncate">{match.tourneyName}</span>
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
          {preview && (
            <div className={`flex items-center gap-1 text-xs font-medium ${ConfidenceColor(preview.confidence)}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
              {preview.suggestion.split(' ')[0]} · {Math.round(preview.confidence * 100)}%
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
