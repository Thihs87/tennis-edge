import { NextResponse } from 'next/server';
import { fetchOngoingMatches, refreshOngoingMatches } from '@/services/tml';
import { fetchUpcomingMatches, refreshUpcomingMatchesCache } from '@/services/odds';
import type { OngoingMatch } from '@/types/tennis';

function bestRank(m: OngoingMatch): number {
  const r1 = m.player1Rank > 0 ? m.player1Rank : 9999;
  const r2 = m.player2Rank > 0 ? m.player2Rank : 9999;
  return Math.min(r1, r2);
}

function surname(name: string): string {
  const parts = name.toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);
  return parts[parts.length - 1];
}

function matchKey(m: { player1: string; player2: string }): string {
  return [surname(m.player1), surname(m.player2)].sort().join('|');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === 'true';

  try {
    if (force) {
      refreshUpcomingMatchesCache();
      await refreshOngoingMatches();
    }

    // Fonte primária: odds-api (lista de partidas dos próximos 7 dias)
    // Fonte de enriquecimento: TML (rankings do ATP)
    const [upcoming, tmlMatches] = await Promise.all([
      fetchUpcomingMatches(),
      fetchOngoingMatches(),
    ]);

    // Enriquece com rankings do TML quando os jogadores batem
    const tmlByKey = new Map(tmlMatches.map(m => [matchKey(m), m]));
    const enriched = upcoming.map(m => {
      const tml = tmlByKey.get(matchKey(m));
      if (!tml) return m;
      return {
        ...m,
        player1Rank: tml.player1Rank || 0,
        player2Rank: tml.player2Rank || 0,
        round:       tml.round || m.round,
      };
    });

    // Ordena:
    //   1º) Data (mais próximas primeiro — quero ver as de hoje, depois amanhã, etc.)
    //   2º) Live antes de scheduled
    //   3º) Melhor ranking (top do mundo primeiro)
    const sorted = enriched.sort((a, b) => {
      const dateA = a.tourney_date ?? '99999999';
      const dateB = b.tourney_date ?? '99999999';
      if (dateA !== dateB) return dateA.localeCompare(dateB);

      const liveA = a.status === 'live' ? 1 : 0;
      const liveB = b.status === 'live' ? 1 : 0;
      if (liveA !== liveB) return liveB - liveA;

      return bestRank(a) - bestRank(b);
    });

    return NextResponse.json({
      matches: sorted,
      count: sorted.length,
      source: upcoming.length > 0 ? 'odds-api' : 'tml-fallback',
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
