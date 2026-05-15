import { NextResponse } from 'next/server';
import { fetchOdds, extractImpliedProbabilities } from '@/services/odds';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const p1 = searchParams.get('p1') ?? 'Jannik Sinner';
  const p2 = searchParams.get('p2') ?? 'Alexander Zverev';

  const odds = await fetchOdds(p1, p2);
  const implied = extractImpliedProbabilities(odds);

  return NextResponse.json({
    query: { player1: p1, player2: p2 },
    odds,
    impliedProbabilities: implied,
    fetchedAt: new Date(odds.fetchedAt).toLocaleString('pt-BR'),
    apiKeysConfigured: {
      primary: !!process.env.ODDS_API_KEY,
      fallback: !!process.env.ODDS_API_KEY_ALT,
    },
  });
}
