/**
 * Geração das melhores apostas do DIA SEGUINTE.
 *
 * Pega partidas de amanhã (timezone local) que ainda não começaram,
 * roda o modelo nos 6 mercados pra cada partida, e retorna 2 blocos:
 *
 *   1. `topPicks`     — Top 3 absolutas por confiança (qualquer faixa)
 *   2. `mediumPicks`  — Até 5 outras apostas com confidence ∈ [0.70, 0.80)
 *                       pra quem quer se arriscar mais (mais ousadas,
 *                       odds tendem a ser mais altas que apostas "certas")
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

const TOP_N             = 3;            // qtd no bloco "top"
const MEDIUM_MAX        = 5;            // qtd máxima no bloco "intermediário"
const MEDIUM_MIN_CONF   = 0.70;         // confidence mínima para entrar no intermediário
const MEDIUM_MAX_CONF   = 0.80;         // confidence máxima do intermediário (exclusivo)
const POOL_MIN_CONF     = 0.55;         // confidence mínima pra entrar em qualquer pool

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
  topPicks: TopPick[];        // até 3, as melhores absolutas
  mediumPicks: TopPick[];     // até 5, com confidence ∈ [0.70, 0.80)
  generatedAt: string;
  expiresAt: string;
  sourceMatchCount: number;
  cacheKey: string;
  targetDate: string;         // YYYYMMDD do dia analisado
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

// Chave única pra evitar duplicatas entre topPicks e mediumPicks
function pickKey(p: TopPick): string {
  return `${p.match.player1}|${p.match.player2}|${p.result.market}|${p.result.suggestion}`;
}

// ─── Função principal ───────────────────────────────────────────────────────

export async function getTopPicks(force = false): Promise<TopPicksResult> {
  const today    = todayYYYYMMDD();
  const tomorrow = tomorrowYYYYMMDD();

  // Cache hit?
  if (
    !force &&
    cache &&
    cache.result.cacheKey === today &&
    Date.now() - cache.fetchedAt < TTL_MS
  ) {
    return cache.result;
  }

  // 1. Busca partidas (cache 2h em odds.ts)
  const allMatches = await fetchUpcomingMatches();

  // 2. Filtra: só amanhã + ainda não começou
  const now = Date.now();
  const eligible = allMatches.filter(m => {
    const dateKey = m.tourney_date ?? (m.startTime ? dateToYYYYMMDD(m.startTime) : undefined);
    if (dateKey !== tomorrow) return false;

    // Partida ainda não começou
    if (m.startTime) {
      const startTs = new Date(m.startTime).getTime();
      if (!isNaN(startTs) && startTs <= now) return false;
    }
    return true;
  });

  // 3. Base histórica (cache 6h)
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
        .filter((r): r is ModelResult => r !== null && r.confidence >= POOL_MIN_CONF)
        .map(result => ({
          match: pickMatchInfo(match),
          result,
        }));
    })
  );

  // 5. Achata e ordena por confidence desc
  const allPicks: TopPick[] = allPicksNested.flat()
    .sort((a, b) => b.result.confidence - a.result.confidence);

  // 6. Bloco "top": top 3 absolutas
  const topPicks = allPicks.slice(0, TOP_N);
  const topKeys  = new Set(topPicks.map(pickKey));

  // 7. Bloco "intermediário": até 5 apostas em [0.70, 0.80) que não estejam no top
  const mediumPicks = allPicks
    .filter(p =>
      !topKeys.has(pickKey(p)) &&
      p.result.confidence >= MEDIUM_MIN_CONF &&
      p.result.confidence <  MEDIUM_MAX_CONF
    )
    .slice(0, MEDIUM_MAX);

  const result: TopPicksResult = {
    topPicks,
    mediumPicks,
    generatedAt: new Date().toISOString(),
    expiresAt: nextMidnightISO(),
    sourceMatchCount: eligible.length,
    cacheKey: today,
    targetDate: tomorrow,
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
