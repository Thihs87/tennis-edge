import { NextResponse } from 'next/server';
import { fetchOngoingMatches, refreshOngoingMatches } from '@/services/tml';
import type { OngoingMatch } from '@/types/tennis';

// Melhor ranking dos dois jogadores (rank menor = melhor jogador).
// Sem ranking conhecido vira 9999 (vai pro fim).
function bestRank(m: OngoingMatch): number {
  const r1 = m.player1Rank > 0 ? m.player1Rank : 9999;
  const r2 = m.player2Rank > 0 ? m.player2Rank : 9999;
  return Math.min(r1, r2);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === 'true';

  try {
    if (force) {
      await refreshOngoingMatches();
    }

    const matches = await fetchOngoingMatches();

    // Ordenação:
    //   1º) Data mais recente primeiro (tourney_date desc)
    //   2º) Melhor ranking primeiro (menor número = mais alto no ranking)
    //   3º) Status live tem prioridade dentro do mesmo dia
    const sorted = [...matches].sort((a, b) => {
      // Data: a maior (mais recente) primeiro
      const dateA = a.tourney_date ?? '00000000';
      const dateB = b.tourney_date ?? '00000000';
      if (dateA !== dateB) return dateB.localeCompare(dateA);

      // Live antes de scheduled (dentro da mesma data)
      const liveA = a.status === 'live' ? 1 : 0;
      const liveB = b.status === 'live' ? 1 : 0;
      if (liveA !== liveB) return liveB - liveA;

      // Ranking: o menor (top do mundo) primeiro
      return bestRank(a) - bestRank(b);
    });

    return NextResponse.json({
      matches: sorted,
      count: sorted.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
