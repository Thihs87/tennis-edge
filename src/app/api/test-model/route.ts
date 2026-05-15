import { NextResponse } from 'next/server';
import { fetchTMLData } from '@/services/tml';
import { analyzeMatch } from '@/services/model';
import type { Market } from '@/services/model';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const p1 = searchParams.get('p1') ?? 'Jannik Sinner';
  const p2 = searchParams.get('p2') ?? 'Alexander Zverev';
  const surface = searchParams.get('surface') ?? 'Clay';
  const market = (searchParams.get('market') ?? 'moneyline') as Market;

  try {
    const data = await fetchTMLData();
    const result = await analyzeMatch(p1, p2, surface, market, data);

    return NextResponse.json({
      query: { p1, p2, surface, market },
      result: {
        suggestion: result.suggestion,
        confidence: `${(result.confidence * 100).toFixed(1)}%`,
        modelProbability: `${(result.modelProbability * 100).toFixed(1)}%`,
        impliedProbability: result.impliedProbability
          ? `${(result.impliedProbability * 100).toFixed(1)}%`
          : null,
        oddValue: result.oddValue,
        bookmaker: result.bookmaker,
        edge: result.edge,
        warnings: result.warnings,
        support: {
          player1: {
            name: result.support.player1Stats.playerName,
            rank: result.support.player1Stats.rank,
            matches: result.support.player1Stats.matchCount,
            winRate: `${(result.support.player1Stats.winRate * 100).toFixed(1)}%`,
            avgGames: result.support.player1Stats.avgGamesPerMatch.toFixed(1),
            avgAces: result.support.player1Stats.avgAcesPerMatch.toFixed(1),
            hasEnoughData: result.support.player1Stats.hasEnoughData,
            fallback: result.support.player1Stats.fallbackToAllSurfaces,
          },
          player2: {
            name: result.support.player2Stats.playerName,
            rank: result.support.player2Stats.rank,
            matches: result.support.player2Stats.matchCount,
            winRate: `${(result.support.player2Stats.winRate * 100).toFixed(1)}%`,
            avgGames: result.support.player2Stats.avgGamesPerMatch.toFixed(1),
            avgAces: result.support.player2Stats.avgAcesPerMatch.toFixed(1),
            hasEnoughData: result.support.player2Stats.hasEnoughData,
            fallback: result.support.player2Stats.fallbackToAllSurfaces,
          },
          h2h: {
            total: result.support.h2h.totalMatches,
            p1Wins: result.support.h2h.player1Wins,
            p2Wins: result.support.h2h.player2Wins,
            avgGames: result.support.h2h.avgGamesPerMatch.toFixed(1),
          },
          details: result.support.details,
        },
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
