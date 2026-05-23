'use client';

import { useState } from 'react';
import type { PlayerStats, H2HRecord } from '@/types/tennis';

interface Props {
  stats1: PlayerStats;
  stats2: PlayerStats;
  h2h: H2HRecord;
}

function Row({ label, v1, v2 }: { label: string; v1: string; v2: string }) {
  const b1 = v1 > v2 ? 'font-bold text-foreground' : 'text-muted-foreground';
  const b2 = v2 > v1 ? 'font-bold text-foreground' : 'text-muted-foreground';
  return (
    <tr className="border-b last:border-0">
      <td className={`py-2 pr-2 text-right text-sm ${b1}`}>{v1}</td>
      <td className="py-2 px-2 text-center text-xs text-muted-foreground whitespace-nowrap">{label}</td>
      <td className={`py-2 pl-2 text-left text-sm ${b2}`}>{v2}</td>
    </tr>
  );
}

export function PlayerStatsSection({ stats1, stats2, h2h }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-accent/50 transition-colors"
      >
        <span>Estatísticas detalhadas</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* Comparison table */}
          <div>
            <div className="grid grid-cols-3 text-center text-xs font-semibold text-muted-foreground mb-2 px-1">
              <span className="text-left truncate">{stats1.playerName.split(' ').pop()}</span>
              <span></span>
              <span className="text-right truncate">{stats2.playerName.split(' ').pop()}</span>
            </div>
            <table className="w-full">
              <tbody>
                <Row
                  label="Win rate"
                  v1={`${(stats1.winRate * 100).toFixed(0)}%`}
                  v2={`${(stats2.winRate * 100).toFixed(0)}%`}
                />
                <Row
                  label="Ranking"
                  v1={stats1.rank > 0 ? `#${stats1.rank}` : '—'}
                  v2={stats2.rank > 0 ? `#${stats2.rank}` : '—'}
                />
                <Row
                  label="Média games"
                  v1={stats1.avgGamesPerMatch.toFixed(1)}
                  v2={stats2.avgGamesPerMatch.toFixed(1)}
                />
                <Row
                  label="Média aces"
                  v1={stats1.avgAcesPerMatch.toFixed(1)}
                  v2={stats2.avgAcesPerMatch.toFixed(1)}
                />
                <Row
                  label="Partidas"
                  v1={String(stats1.matchCount)}
                  v2={String(stats2.matchCount)}
                />
              </tbody>
            </table>
            {(stats1.fallbackToAllSurfaces || stats2.fallbackToAllSurfaces) && (
              <p className="text-xs text-muted-foreground mt-2">
                * Dados insuficientes na superfície, usando todas as superfícies.
              </p>
            )}
          </div>

          {/* Confronto direto (H2H) */}
          {h2h.totalMatches > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                Confronto direto: {h2h.totalMatches} partida{h2h.totalMatches !== 1 ? 's' : ''}
              </p>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-bold">{h2h.player1Wins}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  {h2h.totalMatches > 0 && (
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${(h2h.player1Wins / h2h.totalMatches) * 100}%` }}
                    />
                  )}
                </div>
                <span className="text-sm font-bold">{h2h.player2Wins}</span>
              </div>
              <div className="space-y-1.5">
                {h2h.recentMatches.slice(0, 5).map((m, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground truncate max-w-[120px]">{m.winner}</span>
                    <span className="font-mono">{m.score}</span>
                    <span className="truncate max-w-[80px] text-right">{m.tourney_name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
