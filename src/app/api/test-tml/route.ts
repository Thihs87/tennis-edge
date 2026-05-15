import { NextResponse } from 'next/server';
import { fetchTMLData, fetchOngoingMatches, getPlayerStats, getH2H, getCacheStatus } from '@/services/tml';

export async function GET() {
  try {
    // 1. Carrega base histórica e partidas do dia em paralelo
    const [data, ongoing] = await Promise.all([
      fetchTMLData(),
      fetchOngoingMatches(),
    ]);

    // 2. Pega dois jogadores reais dos dados para testar as funções
    const sampleMatch = data[data.length - 1]; // partida mais recente
    const p1 = sampleMatch?.winner_name ?? 'Carlos Alcaraz';
    const p2 = sampleMatch?.loser_name ?? 'Novak Djokovic';
    const surface = sampleMatch?.surface ?? 'Clay';

    // 3. Testa getPlayerStats para cada jogador
    const stats1 = getPlayerStats(p1, surface, data);
    const stats2 = getPlayerStats(p2, surface, data);

    // 4. Testa getH2H
    const h2h = getH2H(p1, p2, data);

    // 5. Amostra de distribuição temporal
    const weights = { w1: 0, w2: 0, w3: 0 };
    for (const m of data) {
      if (m.temporalWeight === 1) weights.w1++;
      else if (m.temporalWeight === 2) weights.w2++;
      else weights.w3++;
    }

    return NextResponse.json({
      status: 'ok',
      cache: getCacheStatus(),
      summary: {
        totalHistoricalMatches: data.length,
        ongoingMatchesToday: ongoing.length,
        temporalWeights: weights,
        surfacesFound: Array.from(new Set(data.map(m => m.surface))).filter(Boolean),
      },
      sampleMatch: {
        player1: p1,
        player2: p2,
        surface,
      },
      playerStats: {
        [p1]: stats1,
        [p2]: stats2,
      },
      h2h,
      ongoingSample: ongoing.slice(0, 3),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'error', message: msg }, { status: 500 });
  }
}
