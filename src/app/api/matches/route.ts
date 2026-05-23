import { NextResponse } from 'next/server';
import { fetchOngoingMatches, refreshOngoingMatches, fetchTMLData } from '@/services/tml';
import { fetchEventsAsMatches, refreshEventsCache } from '@/services/odds';
import { previewMatch } from '@/services/model';
import type { OngoingMatch } from '@/types/tennis';

function surname(name: string): string {
  const parts = name.toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);
  return parts[parts.length - 1];
}

const PRESTIGE: Array<[RegExp, number]> = [
  [/rome|paris|madrid|monte.carlo|indian.wells|miami|canada|montreal|toronto|cincinnati|shanghai|beijing/i, 500],
  [/hamburg|washington|vienna|basel|rotterdam|dubai|acapulco|eastbourne/i, 300],
  [/geneva|lyon|munich|estoril|marrakech|bucharest|houston|bogota|buenos.aires|rio/i, 100],
  [/strasbourg|rabat|bad.homburg|berlin|birmingham|hertogenbosch|nottingham|eastbourne/i, 200],
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

function relevanceScore(m: OngoingMatch, confidence = 0.5): number {
  let score = 0;
  if (m.status === 'live') score += 1000;
  if (m.scheduledTime?.startsWith('Hoje')) score += 200;
  score += tournamentPrestige(m.tourneyName);
  score += rankingScore(m.player1Rank, m.player2Rank);
  // Confiança como desempate: 0–100 pontos (menos que prestige, mais que ranking)
  score += Math.round(confidence * 100);
  return score;
}

function matchKey(m: OngoingMatch): string {
  return [surname(m.player1), surname(m.player2)].sort().join('|');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === 'true';

  try {
    if (force) {
      refreshEventsCache();
      await refreshOngoingMatches();
    }

    const [oddsMatches, tmlMatches] = await Promise.all([
      fetchEventsAsMatches(),
      fetchOngoingMatches(),
    ]);

    let matches: OngoingMatch[];

    if (oddsMatches.length > 0) {
      // Odds API disponível — usa como fonte primária (ATP + WTA + próximos 7 dias)
      // Enriquece com rankings/round do TML onde os jogadores batem
      const tmlByKey = new Map(tmlMatches.map(m => [matchKey(m), m]));
      matches = oddsMatches.map(m => {
        const tml = tmlByKey.get(matchKey(m));
        return tml
          ? { ...m, player1Rank: tml.player1Rank || 0, player2Rank: tml.player2Rank || 0, round: tml.round || m.round }
          : m;
      });
    } else {
      // Odds API indisponível (quota esgotada) — fallback para TML
      // Marca as partidas como sem odds para o usuário saber
      matches = tmlMatches.map(m => ({ ...m, hasOdds: false }));
    }

    const tmlData = await fetchTMLData();
    const scored = matches.map(m => ({
      m,
      score: relevanceScore(m, previewMatch(m.player1, m.player2, m.surface, tmlData).confidence),
    }));
    scored.sort((a, b) => b.score - a.score);
    matches = scored.map(s => s.m);

    return NextResponse.json({
      matches,
      count: matches.length,
      source: oddsMatches.length > 0 ? 'odds-api' : 'tml-fallback',
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
