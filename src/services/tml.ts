import axios from 'axios';
import Papa from 'papaparse';
import type { MatchRecord, OngoingMatch, PlayerStats, H2HRecord, CacheEntry } from '@/types/tennis';

const TML_BASE = 'https://stats.tennismylife.org/data';
const HISTORICAL_TTL = 24 * 60 * 60 * 1000; // 24 horas
const ONGOING_TTL = 60 * 60 * 1000;          // 60 minutos

// Cache em memória — sobrevive entre requisições no mesmo processo Node
let historicalCache: CacheEntry<MatchRecord[]> | null = null;
let ongoingCache: CacheEntry<OngoingMatch[]> | null = null;

// ─── Utilitários ────────────────────────────────────────────────────────────

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
  const results = await Promise.all(
    years.map(y =>
      fetchRaw(`${TML_BASE}/${y}.csv`)
        .then(parseHistoricalCSV)
        .catch(err => {
          console.warn(`[TML] Falha ao baixar ${y}.csv:`, err.message);
          return [] as MatchRecord[];
        })
    )
  );

  const combined = results.flat();
  historicalCache = { data: combined, fetchedAt: now };
  console.log(`[TML] Base histórica carregada: ${combined.length} partidas`);
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
      hasEnoughData: false,
      fallbackToAllSurfaces,
    };
  }

  // Acumuladores ponderados temporalmente
  let totalWeight = 0;
  let wins = 0;
  let sumGames = 0;
  let sumAces = 0;
  let sumDFs = 0;
  let sumBpSaved = 0;
  let sumBpFaced = 0;
  let sumReturnWon = 0;
  let sumSvpt = 0;
  let lastRank = 0;

  for (const m of matches) {
    const w = m.temporalWeight;
    totalWeight += w;
    const isWinner = m.winner_name.toLowerCase() === nameNorm;

    if (isWinner) {
      wins += w;
      sumAces += m.w_ace * w;
      sumDFs += m.w_df * w;
      sumBpSaved += m.w_bpSaved * w;
      sumBpFaced += m.w_bpFaced * w;
      // Como vencedor, "return" é o desempenho do adversário no serviço dele
      sumReturnWon += (m.l_1stWon + m.l_2ndWon) * w;
      sumSvpt += m.l_svpt * w;
      if (m.winner_rank > 0) lastRank = m.winner_rank;
    } else {
      sumAces += m.l_ace * w;
      sumDFs += m.l_df * w;
      // Como perdedor, break points são os que ele enfrentou no próprio serviço
      sumBpSaved += m.l_bpSaved * w;
      sumBpFaced += m.l_bpFaced * w;
      sumReturnWon += (m.w_1stWon + m.w_2ndWon) * w;
      sumSvpt += m.w_svpt * w;
      if (m.loser_rank > 0) lastRank = m.loser_rank;
    }

    sumGames += m.totalGames * w;
  }

  return {
    playerName,
    surface: fallbackToAllSurfaces ? 'All' : surface,
    matchCount: matches.length,
    winRate: totalWeight > 0 ? wins / totalWeight : 0,
    avgGamesPerMatch: totalWeight > 0 ? sumGames / totalWeight : 0,
    avgAcesPerMatch: totalWeight > 0 ? sumAces / totalWeight : 0,
    avgDFsPerMatch: totalWeight > 0 ? sumDFs / totalWeight : 0,
    bpConversionRate: sumBpFaced > 0 ? sumBpSaved / sumBpFaced : 0,
    returnPointsWonPct: sumSvpt > 0 ? sumReturnWon / sumSvpt : 0,
    rank: lastRank,
    hasEnoughData,
    fallbackToAllSurfaces,
  };
}

// ─── Histórico de confronto direto ───────────────────────────────────────────

/**
 * Retorna o H2H completo entre dois jogadores, ordenado do mais recente ao mais antigo.
 */
export function getH2H(
  player1: string,
  player2: string,
  data: MatchRecord[]
): H2HRecord {
  const p1 = player1.trim().toLowerCase();
  const p2 = player2.trim().toLowerCase();

  const matches = data
    .filter(m => {
      const w = m.winner_name.toLowerCase();
      const l = m.loser_name.toLowerCase();
      return (w === p1 && l === p2) || (w === p2 && l === p1);
    })
    .sort((a, b) => b.tourney_date.localeCompare(a.tourney_date));

  let p1Wins = 0;
  let p2Wins = 0;
  let sumGames = 0;

  for (const m of matches) {
    if (m.winner_name.toLowerCase() === p1) p1Wins++;
    else p2Wins++;
    sumGames += m.totalGames;
  }

  return {
    player1,
    player2,
    player1Wins: p1Wins,
    player2Wins: p2Wins,
    totalMatches: matches.length,
    avgGamesPerMatch: matches.length > 0 ? sumGames / matches.length : 0,
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
