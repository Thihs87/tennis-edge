import axios from 'axios';
import Papa from 'papaparse';
import type { MatchRecord, OngoingMatch, PlayerStats, H2HRecord, CacheEntry } from '@/types/tennis';

const TML_BASE = 'https://stats.tennismylife.org/data';
const WTA_BASE = 'https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master';
const HISTORICAL_TTL = 6 * 60 * 60 * 1000; // 6 horas
const ONGOING_TTL = 60 * 60 * 1000;          // 60 minutos

// Cache em memória — sobrevive entre requisições no mesmo processo Node
let historicalCache: CacheEntry<MatchRecord[]> | null = null;
let ongoingCache: CacheEntry<OngoingMatch[]> | null = null;

// ─── Utilitários ────────────────────────────────────────────────────────────

/**
 * Peso de recência para H2H (mais agressivo que o getTemporalWeight de player stats):
 * confrontos diretos são raros, então damos mais peso aos recentes.
 * ≤ 12 meses: peso 3
 * ≤ 36 meses: peso 2
 * mais antigos: peso 1
 */
function h2hRecencyWeight(tourney_date: string): number {
  if (!tourney_date || tourney_date.length < 8) return 1;
  const year   = parseInt(tourney_date.substring(0, 4), 10);
  const month  = parseInt(tourney_date.substring(4, 6), 10) - 1;
  const day    = parseInt(tourney_date.substring(6, 8), 10);
  const date   = new Date(year, month, day);
  const months = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (months <= 12) return 3;
  if (months <= 36) return 2;
  return 1;
}

function getTemporalWeight(tourney_date: string): number {
  if (!tourney_date || tourney_date.length < 8) return 1;
  const year = parseInt(tourney_date.substring(0, 4), 10);
  const month = parseInt(tourney_date.substring(4, 6), 10) - 1;
  const day = parseInt(tourney_date.substring(6, 8), 10);
  const matchDate = new Date(year, month, day);
  const diffMs = Date.now() - matchDate.getTime();
  const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30);
  if (diffMonths <= 3) return 3;
  if (diffMonths <= 12) return 2;
  return 1;
}

function calculateTotalGames(score: string): number {
  if (!score) return 0;
  // Formato: "6-3 7-5" ou "6-3 7-6(4) 6-2" — ignora tiebreak entre parênteses
  const sets = score.split(' ');
  let total = 0;
  for (const set of sets) {
    const clean = set.replace(/\([^)]*\)/g, '');
    const parts = clean.split('-');
    if (parts.length === 2) {
      total += (parseInt(parts[0], 10) || 0) + (parseInt(parts[1], 10) || 0);
    }
  }
  return total;
}

/**
 * Conta o número de sets jogados em uma partida.
 * Retorna 0 se o placar não for parseável (W/O, RET ou vazio).
 */
function countSetsInScore(score: string): number {
  if (!score || score.includes('W/O') || score.includes('RET')) return 0;
  const sets = score.trim().split(' ').filter(s => /^\d/.test(s));
  return sets.length;
}

/**
 * Retorna true se o vencedor da partida também venceu o 1º set.
 * Retorna null se o placar não for parseável.
 */
function winnerWonFirstSet(score: string): boolean | null {
  if (!score || score.includes('W/O') || score.includes('RET')) return null;
  const firstSet = score.trim().split(' ')[0];
  if (!firstSet) return null;
  const clean = firstSet.replace(/\([^)]*\)/g, ''); // remove tiebreak (N)
  const [wGames, lGames] = clean.split('-').map(Number);
  if (isNaN(wGames) || isNaN(lGames)) return null;
  if (wGames === lGames) return null; // não deveria acontecer
  return wGames > lGames; // true = winner ganhou o 1º set
}

function parseFloat2(val: unknown): number {
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

// ─── Parse dos CSVs históricos ───────────────────────────────────────────────

function parseHistoricalCSV(csvText: string): MatchRecord[] {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  return result.data
    .filter(row => row.winner_name && row.loser_name && row.tourney_date)
    .map(row => {
      const tourney_date = (row.tourney_date ?? '').trim();
      const score = (row.score ?? '').trim();
      return {
        winner_name: (row.winner_name ?? '').trim(),
        loser_name: (row.loser_name ?? '').trim(),
        winner_rank: parseFloat2(row.winner_rank),
        loser_rank: parseFloat2(row.loser_rank),
        surface: (row.surface ?? '').trim(),
        tourney_name: (row.tourney_name ?? '').trim(),
        tourney_date,
        round: (row.round ?? '').trim(),
        score,
        minutes: parseFloat2(row.minutes),
        w_ace: parseFloat2(row.w_ace),
        l_ace: parseFloat2(row.l_ace),
        w_df: parseFloat2(row.w_df),
        l_df: parseFloat2(row.l_df),
        w_svpt: parseFloat2(row.w_svpt),
        w_1stIn: parseFloat2(row.w_1stIn),
        w_1stWon: parseFloat2(row.w_1stWon),
        w_2ndWon: parseFloat2(row.w_2ndWon),
        w_bpSaved: parseFloat2(row.w_bpSaved),
        w_bpFaced: parseFloat2(row.w_bpFaced),
        l_svpt: parseFloat2(row.l_svpt),
        l_1stIn: parseFloat2(row.l_1stIn),
        l_1stWon: parseFloat2(row.l_1stWon),
        l_2ndWon: parseFloat2(row.l_2ndWon),
        l_bpSaved: parseFloat2(row.l_bpSaved),
        l_bpFaced: parseFloat2(row.l_bpFaced),
        tourney_level: (row.tourney_level ?? '').trim(),
        best_of: parseFloat2(row.best_of) || 3,
        temporalWeight: getTemporalWeight(tourney_date),
        totalGames: calculateTotalGames(score),
      };
    });
}

// ─── Parse das partidas ao vivo / do dia ────────────────────────────────────

function parseOngoingCSV(csvText: string): OngoingMatch[] {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  return result.data
    .filter(row => {
      // Aceita tanto colunas "winner/loser" (partida concluída no torneio) quanto "player1/player2"
      const hasPlayers =
        (row.winner_name && row.loser_name) ||
        (row.player1_name && row.player2_name) ||
        (row.player1 && row.player2);
      return !!hasPlayers;
    })
    .map((row, idx) => {
      // Normaliza nomes independente do esquema do CSV
      const player1 = (row.player1_name ?? row.player1 ?? row.winner_name ?? '').trim();
      const player2 = (row.player2_name ?? row.player2 ?? row.loser_name ?? '').trim();
      const surface = (row.surface ?? '').trim();
      const id = `${player1}-${player2}-${idx}`.replace(/\s+/g, '_').toLowerCase();

      return {
        id,
        player1,
        player2,
        player1Rank: parseFloat2(row.player1_rank ?? row.winner_rank ?? row.rank1),
        player2Rank: parseFloat2(row.player2_rank ?? row.loser_rank ?? row.rank2),
        tourneyName: (row.tourney_name ?? '').trim(),
        surface,
        round: (row.round ?? '').trim(),
        status: (row.status ?? '').toLowerCase().includes('live') ? 'live' : 'scheduled',
        scheduledTime: row.scheduled_time ?? row.match_time ?? undefined,
        tourney_date: (row.tourney_date ?? '').trim() || undefined,
        tourney_level: (row.tourney_level ?? '').trim(),
        best_of: parseFloat2(row.best_of) || 3,
      } as OngoingMatch;
    })
    .filter(m => m.player1 && m.player2);
}

// ─── Busca de CSVs ───────────────────────────────────────────────────────────

async function fetchRaw(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    responseType: 'text',
    timeout: 30_000,
    headers: { 'Cache-Control': 'no-cache' },
  });
  return res.data;
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Baixa 2024, 2025 e 2026 em paralelo e retorna base histórica unificada.
 * Cache de 24 horas — renova automaticamente quando expirar.
 */
export async function fetchTMLData(): Promise<MatchRecord[]> {
  const now = Date.now();
  if (historicalCache && now - historicalCache.fetchedAt < HISTORICAL_TTL) {
    return historicalCache.data;
  }

  const years = ['2024', '2025', '2026'];

  // ATP — via TML
  const atpPromises = years.map(y =>
    fetchRaw(`${TML_BASE}/${y}.csv`)
      .then(parseHistoricalCSV)
      .catch(err => {
        console.warn(`[TML] Falha ao baixar ATP ${y}.csv:`, err.message);
        return [] as MatchRecord[];
      })
  );

  // WTA — via Jeff Sackmann no GitHub (mesma fonte do TML, mesmo formato)
  const wtaPromises = years.map(y =>
    fetchRaw(`${WTA_BASE}/wta_matches_${y}.csv`)
      .then(parseHistoricalCSV)
      .catch(err => {
        console.warn(`[TML] Falha ao baixar WTA ${y}.csv:`, err.message);
        return [] as MatchRecord[];
      })
  );

  const results = await Promise.all([...atpPromises, ...wtaPromises]);
  const combined = results.flat();
  historicalCache = { data: combined, fetchedAt: now };
  console.log(`[TML] Base histórica carregada: ${combined.length} partidas (ATP + WTA)`);
  return combined;
}

/**
 * Força recarga da base histórica ignorando o cache.
 */
export async function refreshTMLData(): Promise<MatchRecord[]> {
  historicalCache = null;
  return fetchTMLData();
}

/**
 * Baixa ongoing_tourneys.csv e retorna partidas do dia.
 * Cache de 60 minutos — renova automaticamente quando expirar.
 */
export async function fetchOngoingMatches(): Promise<OngoingMatch[]> {
  const now = Date.now();
  if (ongoingCache && now - ongoingCache.fetchedAt < ONGOING_TTL) {
    return ongoingCache.data;
  }

  try {
    const csv = await fetchRaw(`${TML_BASE}/ongoing_tourneys.csv`);
    const matches = parseOngoingCSV(csv);
    ongoingCache = { data: matches, fetchedAt: now };
    console.log(`[TML] Partidas ao vivo/hoje: ${matches.length}`);
    return matches;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[TML] Falha ao baixar ongoing_tourneys.csv:', msg);
    return ongoingCache?.data ?? [];
  }
}

/**
 * Força recarga das partidas do dia ignorando o cache.
 */
export async function refreshOngoingMatches(): Promise<OngoingMatch[]> {
  ongoingCache = null;
  return fetchOngoingMatches();
}

/**
 * Retorna timestamps de quando cada cache foi carregado pela última vez.
 */
export function getCacheStatus() {
  return {
    historical: historicalCache
      ? { fetchedAt: historicalCache.fetchedAt, count: historicalCache.data.length }
      : null,
    ongoing: ongoingCache
      ? { fetchedAt: ongoingCache.fetchedAt, count: ongoingCache.data.length }
      : null,
  };
}

// ─── Estatísticas por jogador ─────────────────────────────────────────────────

/**
 * Calcula estatísticas de um jogador numa superfície específica.
 * Se houver menos de 10 partidas na superfície, usa todas as superfícies com aviso.
 */
export function getPlayerStats(
  playerName: string,
  surface: string,
  data: MatchRecord[]
): PlayerStats {
  const nameNorm = playerName.trim().toLowerCase();

  // Filtra partidas do jogador (como vencedor ou perdedor)
  const allMatches = data.filter(
    m =>
      m.winner_name.toLowerCase() === nameNorm ||
      m.loser_name.toLowerCase() === nameNorm
  );

  // Tenta filtrar pela superfície
  let matches = allMatches.filter(
    m => m.surface.toLowerCase() === surface.toLowerCase()
  );

  const fallbackToAllSurfaces = matches.length < 10;
  if (fallbackToAllSurfaces) {
    matches = allMatches;
  }

  const hasEnoughData = matches.length >= 10;
  if (matches.length === 0) {
    return {
      playerName,
      surface,
      matchCount: 0,
      winRate: 0,
      avgGamesPerMatch: 0,
      avgAcesPerMatch: 0,
      avgDFsPerMatch: 0,
      bpConversionRate: 0,
      returnPointsWonPct: 0,
      rank: 0,
      firstSetWinRate: 0.5,
      firstSetMatches: 0,
      avgSetsPerMatch: 0,
      setsMatches: 0,
      avgGamesPerSet: 9.5, // média típica de games por set no tour
      avgAcesPerSet:  0,
      avgDFsPerSet:   0,
      setCompletionRate: 0.75,
      hasEnoughData: false,
      fallbackToAllSurfaces,
    };
  }

  // Acumuladores ponderados temporalmente
  let totalWeight = 0;        // soma de pesos de TODAS as partidas (para winRate)
  let validWeight = 0;        // soma de pesos APENAS de partidas com placar real (sem W/O ou RET)
  let wins = 0;
  let sumGames = 0;
  let sumAces = 0;
  let sumDFs = 0;
  let sumBpSaved = 0;
  let sumBpFaced = 0;
  let sumReturnWon = 0;
  let sumSvpt = 0;
  let lastRank = 0;
  let firstSetWins = 0;
  let firstSetTotal = 0;
  let sumSets = 0;
  let setsCount = 0;
  // Para avgGamesPerSet (invariante BO3/BO5): só conta partidas com placar válido
  let gamesForSetsValid = 0;
  let setsValidWeighted = 0;
  // Para avgAcesPerSet e avgDFsPerSet (invariantes BO3/BO5)
  let acesValidWeighted = 0;
  let dfsValidWeighted = 0;
  // Para setCompletionRate (razão sets jogados / máximo possível)
  let completionSum = 0;       // soma de (nSets / bestOf) ponderada
  let completionWeight = 0;    // soma dos pesos

  for (const m of matches) {
    const w = m.temporalWeight;
    totalWeight += w;
    const isWinner = m.winner_name.toLowerCase() === nameNorm;

    // winRate inclui TODAS as partidas (W/O é uma vitória válida)
    if (isWinner) {
      wins += w;
      if (m.winner_rank > 0) lastRank = m.winner_rank;
    } else {
      if (m.loser_rank > 0) lastRank = m.loser_rank;
    }

    // 1º set: parse do placar real (já exclui W/O e RET via winnerWonFirstSet)
    const wonFirst = winnerWonFirstSet(m.score);
    if (wonFirst !== null) {
      firstSetTotal++;
      const playerWonFirst = isWinner ? wonFirst : !wonFirst;
      if (playerWonFirst) firstSetWins++;
    }

    // ✅ FIX: estatísticas que dependem de placar (games, aces, DFs, bp, return)
    // só contam partidas com placar real — W/O e RET ficam de fora porque distorcem.
    const nSets = countSetsInScore(m.score);
    if (nSets > 0 && m.totalGames > 0) {
      validWeight += w;
      sumGames += m.totalGames * w;
      setsValidWeighted += nSets * w;
      gamesForSetsValid += m.totalGames * w;
      sumSets += nSets;
      setsCount++;

      const playerAces = isWinner ? m.w_ace : m.l_ace;
      const playerDFs  = isWinner ? m.w_df  : m.l_df;
      sumAces += playerAces * w;
      sumDFs  += playerDFs  * w;
      acesValidWeighted += playerAces * w;
      dfsValidWeighted  += playerDFs  * w;

      // BP e return: stats do oponente quando ele saca
      const oppSvpt    = isWinner ? m.l_svpt    : m.w_svpt;
      const opp1stWon  = isWinner ? m.l_1stWon  : m.w_1stWon;
      const opp2ndWon  = isWinner ? m.l_2ndWon  : m.w_2ndWon;
      const playerBpS  = isWinner ? m.w_bpSaved : m.l_bpSaved;
      const playerBpF  = isWinner ? m.w_bpFaced : m.l_bpFaced;

      sumBpSaved   += playerBpS * w;
      sumBpFaced   += playerBpF * w;
      sumReturnWon += (oppSvpt - opp1stWon - opp2ndWon) * w;
      sumSvpt      += oppSvpt * w;

      // Completion rate: razão de sets jogados / máximo possível pelo formato
      const maxSets = m.best_of === 5 ? 5 : 3;
      completionSum    += (nSets / maxSets) * w;
      completionWeight += w;
    }
  }

  return {
    playerName,
    surface: fallbackToAllSurfaces ? 'All' : surface,
    matchCount: matches.length,
    winRate: totalWeight > 0 ? wins / totalWeight : 0,
    // ✅ Médias per-match agora usam validWeight (exclui W/O e RET)
    avgGamesPerMatch: validWeight > 0 ? sumGames / validWeight : 0,
    avgAcesPerMatch:  validWeight > 0 ? sumAces  / validWeight : 0,
    avgDFsPerMatch:   validWeight > 0 ? sumDFs   / validWeight : 0,
    // ✅ bpConversionRate: 0.65 (média do tour) quando sem dados, em vez de 0
    bpConversionRate:   sumBpFaced >= 5 ? sumBpSaved / sumBpFaced : 0.65,
    // ✅ returnPointsWonPct agora calculado corretamente: ~0.35 é média do tour
    returnPointsWonPct: sumSvpt > 0 ? sumReturnWon / sumSvpt : 0.35,
    rank: lastRank,
    firstSetWinRate: firstSetTotal >= 5 ? firstSetWins / firstSetTotal : 0.5,
    firstSetMatches: firstSetTotal,
    avgSetsPerMatch: setsCount > 0 ? sumSets / setsCount : 0,
    setsMatches: setsCount,
    avgGamesPerSet: setsValidWeighted > 0 ? gamesForSetsValid / setsValidWeighted : 9.5,
    avgAcesPerSet:  setsValidWeighted > 0 ? acesValidWeighted / setsValidWeighted : 0,
    avgDFsPerSet:   setsValidWeighted > 0 ? dfsValidWeighted / setsValidWeighted : 0,
    setCompletionRate: completionWeight > 0 ? completionSum / completionWeight : 0.75,
    hasEnoughData,
    fallbackToAllSurfaces,
  };
}

// ─── Histórico de confronto direto ───────────────────────────────────────────

/**
 * Retorna o H2H entre dois jogadores. Se `surface` for fornecida, tenta primeiro
 * filtrar pelas partidas na mesma superfície (com fallback a todas as superfícies
 * se houver menos de 3 partidas no piso atual). Todas as métricas agregadas são
 * ponderadas por recência (≤12 meses peso 3, ≤36 meses peso 2, mais antigos peso 1).
 */
export function getH2H(
  player1: string,
  player2: string,
  data: MatchRecord[],
  surface?: string,
): H2HRecord {
  const p1 = player1.trim().toLowerCase();
  const p2 = player2.trim().toLowerCase();

  const allMatches = data
    .filter(m => {
      const w = m.winner_name.toLowerCase();
      const l = m.loser_name.toLowerCase();
      return (w === p1 && l === p2) || (w === p2 && l === p1);
    })
    .sort((a, b) => b.tourney_date.localeCompare(a.tourney_date));

  // Tenta filtrar por superfície primeiro
  let matches = allMatches;
  let surfaceFiltered = false;
  if (surface) {
    const surfaceMatches = allMatches.filter(
      m => m.surface.toLowerCase() === surface.toLowerCase()
    );
    if (surfaceMatches.length >= 3) {
      matches = surfaceMatches;
      surfaceFiltered = true;
    }
  }

  let p1Wins = 0;
  let p2Wins = 0;
  let weightedP1Wins = 0;
  let weightedTotal = 0;
  let weightedGamesSum = 0;
  let weightedSetsSum = 0;
  let weightedSetsCount = 0;
  // Para avgGamesPerSet do H2H
  let weightedGamesValid = 0;
  let weightedSetsValid = 0;

  for (const m of matches) {
    const w = h2hRecencyWeight(m.tourney_date);
    const isP1Winner = m.winner_name.toLowerCase() === p1;
    if (isP1Winner) {
      p1Wins++;
      weightedP1Wins += w;
    } else {
      p2Wins++;
    }
    weightedTotal += w;
    weightedGamesSum += m.totalGames * w;
    const nSets = countSetsInScore(m.score);
    if (nSets > 0) {
      weightedSetsSum += nSets * w;
      weightedSetsCount += w;
      if (m.totalGames > 0) {
        weightedGamesValid += m.totalGames * w;
        weightedSetsValid  += nSets * w;
      }
    }
  }

  return {
    player1,
    player2,
    player1Wins: p1Wins,
    player2Wins: p2Wins,
    totalMatches: matches.length,
    avgGamesPerMatch: weightedTotal > 0 ? weightedGamesSum / weightedTotal : 0,
    avgSetsPerMatch: weightedSetsCount > 0 ? weightedSetsSum / weightedSetsCount : 0,
    avgGamesPerSet: weightedSetsValid > 0 ? weightedGamesValid / weightedSetsValid : 0,
    surfaceFiltered,
    weightedWinProb: weightedTotal > 0 ? weightedP1Wins / weightedTotal : 0.5,
    recentMatches: matches.slice(0, 10).map(m => ({
      winner: m.winner_name,
      loser: m.loser_name,
      score: m.score,
      surface: m.surface,
      tourney_name: m.tourney_name,
      tourney_date: m.tourney_date,
    })),
  };
}
