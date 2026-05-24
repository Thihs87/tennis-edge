import { NextResponse } from 'next/server';
import { fetchOngoingMatches, refreshOngoingMatches } from '@/services/tml';
import type { OngoingMatch } from '@/types/tennis';

// Prestige é só pra ordenar a lista (torneios maiores primeiro)
const PRESTIGE: Array<[RegExp, number]> = [
  [/australian.open|roland.garros|wimbledon|us.open/i, 1000],
  [/rome|paris|madrid|monte.carlo|indian.wells|miami|canada|montreal|toronto|cincinnati|shanghai|beijing/i, 500],
  [/hamburg|washington|vienna|basel|rotterdam|dubai|acapulco|eastbourne/i, 300],
  [/strasbourg|rabat|bad.homburg|berlin|birmingham|hertogenbosch|nottingham/i, 200],
  [/geneva|lyon|munich|estoril|marrakech|bucharest|houston|bogota|buenos.aires|rio/i, 100],
];

function tournamentPrestige(tourneyName: string): number {
  for (const [pattern, score] of PRESTIGE) {
    if (pattern.test(tourneyName)) return score;
  }
  return 50;
}

function rankingScore(rank1: number, rank2: number): number {
  const r1 = rank1 > 0 ? rank1 : 500;
  const r2 = rank2 > 0 ? rank2 : 500;
  return Math.round(2000 / (r1 + r2));
}

function relevanceScore(m: OngoingMatch): number {
  let score = 0;
  if (m.status === 'live') score += 1000;
  if (m.scheduledTime?.startsWith('Hoje')) score += 200;
  score += tournamentPrestige(m.tourneyName);
  score += rankingScore(m.player1Rank, m.player2Rank);
  return score;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === 'true';

  try {
    if (force) {
      await refreshOngoingMatches();
    }

    const matches = await fetchOngoingMatches();

    // Ordena por relevância (torneios maiores e jogadores melhor ranqueados primeiro)
    const sorted = [...matches].sort(
      (a, b) => relevanceScore(b) - relevanceScore(a)
    );

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
