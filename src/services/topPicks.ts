/**
 * Geração das 3 melhores apostas do dia.
 *
 * Pega partidas de hoje + amanhã que AINDA NÃO COMEÇARAM,
 * roda o modelo nos 6 mercados pra cada partida, e retorna
 * as 3 com maior confiança absoluta.
 *
 * Cache em memória, chaveado pelo dia atual (YYYYMMDD).
 * Quando o dia vira, a próxima request gera lista nova.
 */

import { fetchUpcomingMatches, dateToYYYYMMDD } from './odds';
import { fetchTMLData } from './tml';
import { analyzeMatch } from './model';
import type { ModelResult, Market } from './model';
import type { OngoingMatch } from '@/types/tennis';

const ALL_MARKETS: Market[] = [
  'moneyline',
  'first_set',
  'total_sets',
  'total_games',
  'total_aces',
  'total_dfs',
];

const TOP_N = 3;
const TTL_MS = 24 * 60 * 60 * 1000;

export interface TopPick {
  match: {
    player1: string;
    player2: string;
    surface: string;
    tourneyName: string;
    tourney_date?: string;
    scheduledTime?: string;
    startTime?: string;
  };
  result: ModelResult;
}

export interface TopPicksResult {
  picks: TopPick[];
  generatedAt: string;       // ISO
  expiresAt: string;         // ISO (próxima meia-noite local)
  sourceMatchCount: number;
  cacheKey: string;          // YYYYMMDD do dia
}

interface InternalCache {
  result: TopPicksResult;
  fetchedAt: number;
}

let cache: InternalCache | null = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayYYYYMMDD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function tomorrowYYYYMMDD(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function nextMidnightISO(): string {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}

function isGrandSlam(tourneyName: string): boolean {
  const t = (tourneyName || '').toLowerCase();
  return /(australian open|roland garros|wimbledon|us open|roland-garros)/.test(t);
}

// ─── Função principal ───────────────────────────────────────────────────────

export async function getTopPicks(force = false): Promise<TopPicksResult> {
  const today    = todayYYYYMMDD();
  const tomorrow = tomorrowYYYYMMDD();

  // Cache hit? (mesmo dia e dentro do TTL)
  if (
    !force &&
    cache &&
    cache.result.cacheKey === today &&
    Date.now() - cache.fetchedAt < TTL_MS
  ) {
    return cache.result;
  }

  // 1. Busca partidas (já cacheado por 2h em odds.ts)
  const allMatches = await fetchUpcomingMatches();

  // 2. Filtra: hoje OU amanhã + ainda não começou
  const validDates = new Set([today, tomorrow]);
  const now = Date.now();

  const eligible = allMatches.filter(m => {
    // Filtro 1: data tem que ser hoje ou amanhã (timezone local)
    const dateKey = m.tourney_date ?? (m.startTime ? dateToYYYYMMDD(m.startTime) : undefined);
    if (!dateKey || !validDates.has(dateKey)) return false;

    // Filtro 2: partida ainda não começou
    if (m.startTime) {
      const startTs = new Date(m.startTime).getTime();
      if (!isNaN(startTs) && startTs <= now) return false;
    }
    return true;
  });

  // 3. Carrega base histórica (cacheada por 6h)
  const tmlData = await fetchTMLData();

  // 4. Pra cada partida, roda os 6 mercados em paralelo
  const allPicksNested = await Promise.all(
    eligible.map(async (match) => {
      const bestOf = isGrandSlam(match.tourneyName) ? 5 : 3;
      const marketResults = await Promise.all(
        ALL_MARKETS.map(market =>
          analyzeMatch(match.player1, match.player2, match.surface, market, tmlData, { bestOf })
            .catch(() => null)
        )
      );

      return marketResults
        .filter((r): r is ModelResult => r !== null && r.confidence >= 0.55)
        .map(result => ({
          match: pickMatchInfo(match),
          result,
        }));
    })
  );

  // 5. Achata e ordena por confidence desc
  const allPicks: TopPick[] = allPicksNested.flat()
    .sort((a, b) => b.result.confidence - a.result.confidence);

  // 6. Top N (ou menos se não houver suficientes)
  const top = allPicks.slice(0, TOP_N);

  const result: TopPicksResult = {
    picks: top,
    generatedAt: new Date().toISOString(),
    expiresAt: nextMidnightISO(),
    sourceMatchCount: eligible.length,
    cacheKey: today,
  };

  cache = { result, fetchedAt: Date.now() };
  return result;
}

function pickMatchInfo(m: OngoingMatch): TopPick['match'] {
  return {
    player1: m.player1,
    player2: m.player2,
    surface: m.surface,
    tourneyName: m.tourneyName,
    tourney_date: m.tourney_date,
    scheduledTime: m.scheduledTime,
    startTime: m.startTime,
  };
}

export function clearTopPicksCache(): void {
  cache = null;
}
