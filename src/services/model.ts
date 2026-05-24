import { getPlayerStats, getH2H } from '@/services/tml';
import { fetchOdds, getImpliedProbability } from '@/services/odds';
import type { MatchRecord, PlayerStats, H2HRecord } from '@/types/tennis';

// ─── Tipos de resultado ──────────────────────────────────────────────────────

export type Market =
  | 'moneyline'
  | 'total_games'
  | 'total_aces'
  | 'first_set'       // Vencedor do 1º set
  | 'total_sets'      // Total de sets (Over/Under 2.5 em BO3)
  | 'total_dfs';      // Total de duplas faltas

export type OddEdge = 'value' | 'fair' | 'no_value' | 'unavailable';

export interface AnalyzeOptions {
  userLine?: number;          // linha informada pelo usuário para O/U
  userOdd?: number;           // odd da casa informada pelo usuário
  bestOf?: 3 | 5;             // BO3 ou BO5 (padrão BO3)
  context?: string;           // contexto extra para o Claude (lesão, etc.)
  skipExternalOdds?: boolean; // não buscar odds de API externa (modo simulador)
  // Quando o usuário quer avaliar UMA aposta específica (em vez de ver a melhor sugestão do modelo):
  forceDirection?: 'over' | 'under'; // força Over/Under em games/sets/aces/DFs
  forcePlayer?: 'p1' | 'p2';          // força p1/p2 em moneyline/first_set/aces/DFs
}

export interface ModelResult {
  market: Market;
  player1: string;
  player2: string;
  surface: string;

  // Sugestão principal
  suggestion: string;         // ex: "Jannik Sinner vence" ou "Over 21.5 games"
  reasoning: string;          // frase curta com dados — ex: "70% no modelo · H2H 3-1 · 78% no saibro"
  confidence: number;         // 0-1 (probabilidade do modelo para a sugestão)

  // Comparação com a casa
  modelProbability: number;   // 0-1
  impliedProbability: number | null;
  oddValue: number | null;    // odd decimal da casa
  bookmaker: string | null;
  edge: OddEdge;

  // Dados de suporte para exibição e para o Claude
  support: {
    player1Stats: PlayerStats;
    player2Stats: PlayerStats;
    h2h: H2HRecord;
    details: Record<string, unknown>;
  };

  // Avisos para o usuário
  warnings: string[];
}

// ─── Utilitários internos ────────────────────────────────────────────────────

export function classifyEdge(modelProb: number, impliedProb: number | null): OddEdge {
  if (impliedProb === null) return 'unavailable';
  const diff = modelProb - impliedProb;
  if (diff > 0.05) return 'value';
  if (diff < -0.05) return 'no_value';
  return 'fair';
}

// ─── MERCADO 1 — Moneyline ───────────────────────────────────────────────────

/**
 * Probabilidade do jogador A vencer baseada SOMENTE no ranking.
 * Usa logística sobre o log da razão de rankings, calibrada empiricamente
 * para se aproximar de probabilidades de mercado em apostas esportivas.
 *
 * Exemplos:
 *   #1 vs #100  → 0.90 (cap)
 *   #23 vs #87  → 0.78
 *   #50 vs #100 → 0.66
 *   #50 vs #55  → 0.52
 */
function rankingBasedProb(rankA: number, rankB: number): number {
  if (rankA <= 0 || rankB <= 0) return 0.5;
  const logRatio = Math.log(rankB / rankA); // positivo = A é melhor
  const prob = 1 / (1 + Math.exp(-logRatio * 0.95));
  return Math.max(0.10, Math.min(0.90, prob));
}

function calcMoneyline(
  stats1: PlayerStats,
  stats2: PlayerStats,
  h2h: H2HRecord
): { prob1: number; prob2: number; details: Record<string, unknown> } {
  // 1. Ranking: sinal primário. Captura implicitamente a qualidade
  //    da oposição que cada jogador costuma enfrentar.
  const rankProb = rankingBasedProb(stats1.rank, stats2.rank);

  // 2. Win rate na superfície: ajuste secundário (tiebreaker quando rankings são próximos)
  const wr1 = stats1.winRate || 0.5;
  const wr2 = stats2.winRate || 0.5;
  let wrProb = 0.5;
  if (stats1.hasEnoughData && stats2.hasEnoughData) {
    wrProb = wr1 / (wr1 + wr2);
  } else if (stats1.hasEnoughData) {
    wrProb = 0.5 + (wr1 - 0.5) * 0.3;
  } else if (stats2.hasEnoughData) {
    wrProb = 0.5 - (wr2 - 0.5) * 0.3;
  }

  // 3. H2H: ajuste terciário, só quando há histórico suficiente
  // Usa probabilidade já ponderada por recência (definida em getH2H)
  let h2hProb = 0.5;
  let h2hWeight = 0;
  if (h2h.totalMatches >= 3) {
    h2hProb = h2h.weightedWinProb;
    h2hWeight = 0.15;
  }

  // Pesos: ranking domina; sem H2H, redistribui o peso para o ranking
  const rankWeight = h2hWeight > 0 ? 0.60 : 0.75;
  const wrWeight   = 1 - rankWeight - h2hWeight;

  const rawProb1 = rankProb * rankWeight + wrProb * wrWeight + h2hProb * h2hWeight;
  const prob1 = Math.max(0.05, Math.min(0.95, rawProb1));

  return {
    prob1,
    prob2: 1 - prob1,
    details: {
      rankProb:   rankProb.toFixed(3),
      wrProb:     wrProb.toFixed(3),
      h2hProb:    h2hProb.toFixed(3),
      weights:    { rank: rankWeight, wr: wrWeight, h2h: h2hWeight },
      rankings:   { [stats1.playerName]: stats1.rank, [stats2.playerName]: stats2.rank },
      surfaceWR:  { [stats1.playerName]: wr1.toFixed(3), [stats2.playerName]: wr2.toFixed(3) },
      h2hMatches: h2h.totalMatches,
    },
  };
}

// ─── Helper: nº esperado de sets ─────────────────────────────────────────────
// Usado por vários mercados (total de games, aces, DFs) para escalar
// estatísticas per-set ao formato do match (BO3 ou BO5).

function expectedSetsForMatch(bestOf: 3 | 5, matchProb: number): number {
  const favoriteProb = Math.max(matchProb, 1 - matchProb);
  const imbalance    = Math.max(0, favoriteProb - 0.5); // 0 a 0.5
  return bestOf === 5
    ? 3.7 - imbalance * 1.4   // BO5: 3.7 (equilibrado) → 3.0 (dominante)
    : 2.4 - imbalance * 0.8;  // BO3: 2.4 (equilibrado) → 2.0 (dominante)
}

// ─── MERCADO 2 — Total de games ──────────────────────────────────────────────

const GAME_LINES_BO3 = [19.5, 21.5, 23.5];
const GAME_LINES_BO5 = [35.5, 38.5, 41.5];

function calcTotalGames(
  stats1: PlayerStats,
  stats2: PlayerStats,
  h2h: H2HRecord,
  userLine?: number,
  bestOf: 3 | 5 = 3,
  matchProb: number = 0.5, // probabilidade do favorito vencer (para estimar nº de sets)
): { line: number; overProb: number; underProb: number; avgGames: number; details: Record<string, unknown> } {
  // ✅ FIX: Em vez de usar avgGamesPerMatch (que é dominado por BO3 no histórico),
  // calculamos games-por-set (invariante BO3/BO5) e multiplicamos pelo nº esperado
  // de sets do tipo de jogo atual (BO3 ou BO5).

  // 1. Games por set individuais (média dos 2 jogadores na superfície)
  const gpsP1 = stats1.avgGamesPerSet || 9.5;
  const gpsP2 = stats2.avgGamesPerSet || 9.5;
  const gpsIndividual = (gpsP1 + gpsP2) / 2;

  // 2. Games por set no H2H (se houver dados suficientes)
  const hasH2HGps = h2h.totalMatches >= 3 && h2h.avgGamesPerSet > 0;
  const gpsH2H = hasH2HGps ? h2h.avgGamesPerSet : gpsIndividual;

  // 3. Ajuste por hold rate dos sacadores (proxy: bpConversionRate)
  // Saque forte → games costumam ir mais a deuce/tiebreak → mais games por set
  const bpAvg = (stats1.bpConversionRate + stats2.bpConversionRate) / 2;
  const bpAdjust = (bpAvg - 0.5) * 1.0; // até ±0.5 games/set

  // Combinação ponderada (mesmos pesos da versão antiga)
  const expectedGamesPerSet =
    gpsIndividual * 0.40 +
    gpsH2H       * 0.35 +
    (gpsIndividual + bpAdjust) * 0.25;

  // 4. Estimativa do nº de sets para este match (depende do BO e do desequilíbrio)
  const expectedSets = expectedSetsForMatch(bestOf, matchProb);

  const weightedAvg = expectedGamesPerSet * expectedSets;

  // Seleciona a linha mais próxima da média
  const sigma = bestOf === 5 ? 5.0 : 3.0;
  const lines = bestOf === 5 ? GAME_LINES_BO5 : GAME_LINES_BO3;

  let bestLine = lines[1];
  let minDist = Infinity;
  for (const line of lines) {
    const dist = Math.abs(weightedAvg - line);
    if (dist < minDist) { minDist = dist; bestLine = line; }
  }

  const finalLine = userLine ?? bestLine;

  // Probabilidade via logística em torno da expectativa
  const z = (weightedAvg - finalLine) / sigma;
  const overProb = 1 / (1 + Math.exp(-z * 1.7));
  const underProb = 1 - overProb;

  return {
    line: finalLine,
    overProb,
    underProb,
    avgGames: weightedAvg,
    details: {
      gamesPerSetIndividual: gpsIndividual.toFixed(2),
      gamesPerSetH2H:        gpsH2H.toFixed(2),
      bpAdjust:              bpAdjust.toFixed(2),
      expectedSets:          expectedSets.toFixed(2),
      expectedGames:         weightedAvg.toFixed(1),
      bestLine,
      bestOf,
    },
  };
}

// ─── MERCADO 3 — Total de aces ───────────────────────────────────────────────

function calcAcesForPlayer(
  player: PlayerStats,
  opponent: PlayerStats,
  userLine?: number,
  bestOf: 3 | 5 = 3,
  matchProb: number = 0.5,
): { line: number; overProb: number; underProb: number; avgAces: number } {
  // ✅ FIX: aces escalam com o nº de sets. Usar avgAcesPerSet (invariante)
  // e multiplicar pelo nº esperado de sets do match.
  const acesPerSet = player.avgAcesPerSet || 0;
  const expectedSets = expectedSetsForMatch(bestOf, matchProb);
  const baseAces = acesPerSet * expectedSets;

  // Return points won % do adversário: quanto maior, mais difícil sacar (peso 40%)
  // returnPointsWonPct alto = adversário devolve bem = menos aces
  const returnPressure = opponent.returnPointsWonPct;
  const returnAdjust = (0.5 - returnPressure) * baseAces * 0.8;

  const avgAces = Math.max(0, baseAces * 0.60 + (baseAces + returnAdjust) * 0.40);

  // Linha mais próxima da média (arredonda para .5) — ou linha do usuário
  const line = userLine ?? Math.round(avgAces * 2) / 2;

  // Probabilidade over/under
  const sigma = 2.0;
  const z = (avgAces - line) / sigma;
  const overProb = 1 / (1 + Math.exp(-z * 1.7));

  return { line, overProb, underProb: 1 - overProb, avgAces };
}

// ─── Preview rápido (sem odds, sem Claude) ───────────────────────────────────

export interface MatchPreview {
  player1: string;
  player2: string;
  surface: string;
  suggestion: string;    // "X vence"
  confidence: number;    // 0-1
  hasEnoughData: boolean;
  tip?: string;          // frase explicativa gerada por template
}

function surfaceLabel(s: string): string {
  return s === 'Clay' ? 'saibro' : s === 'Grass' ? 'grama' : 'piso duro';
}

function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

// ─── Builders de "reasoning" — frase curta com dados que explicam a sugestão ──

function strengthLabel(prob: number): string {
  if (prob >= 0.70) return 'Vantagem clara';
  if (prob >= 0.58) return 'Leve vantagem';
  if (prob >= 0.52) return 'Vantagem pequena';
  return 'Praticamente equilibrado';
}

function buildMoneylineReasoning(
  winnerProb: number,
  winnerStats: PlayerStats,
  loserStats: PlayerStats,
  h2h: H2HRecord,
  surface: string,
): string {
  const surf = surfaceLabel(surface);
  const wLast = lastName(winnerStats.playerName);
  const lLast = lastName(loserStats.playerName);
  const evidence: string[] = [];

  if (winnerStats.hasEnoughData && loserStats.hasEnoughData) {
    evidence.push(`no ${surf}, ${wLast} vence ${Math.round(winnerStats.winRate * 100)}% das partidas e ${lLast} ${Math.round(loserStats.winRate * 100)}%`);
  } else if (winnerStats.hasEnoughData) {
    evidence.push(`${wLast} vence ${Math.round(winnerStats.winRate * 100)}% no ${surf}`);
  }

  const wWins = winnerStats.playerName === h2h.player1 ? h2h.player1Wins : h2h.player2Wins;
  const lWins = h2h.totalMatches - wWins;
  if (h2h.totalMatches >= 3) {
    const where = h2h.surfaceFiltered ? ` no ${surf}` : '';
    evidence.push(`${wWins} vitórias contra ${lWins} no confronto direto${where} a favor de ${wWins >= lWins ? wLast : lLast}`);
  }
  if (winnerStats.rank > 0 && loserStats.rank > 0 && Math.abs(winnerStats.rank - loserStats.rank) > 5) {
    evidence.push(`ranking ${wLast} #${winnerStats.rank} vs ${lLast} #${loserStats.rank}`);
  }

  const evidenceText = evidence.length > 0 ? evidence.join('; ') : 'dados limitados';
  return `${strengthLabel(winnerProb)}. ${evidenceText.charAt(0).toUpperCase() + evidenceText.slice(1)}.`;
}

function buildTotalGamesReasoning(
  confidence: number,
  avgGames: number,
  h2h: H2HRecord,
  surface: string,
  stats1: PlayerStats,
  stats2: PlayerStats,
  bestOf: 3 | 5,
): string {
  void confidence;
  const surf = surfaceLabel(surface);
  const gps = ((stats1.avgGamesPerSet || 9.5) + (stats2.avgGamesPerSet || 9.5)) / 2;
  const parts: string[] = [
    `total esperado de ${avgGames.toFixed(1)} games (jogo de ${bestOf === 5 ? 'até 5' : 'até 3'} sets, ~${gps.toFixed(1)} games por set no ${surf})`,
  ];
  if (h2h.totalMatches >= 3 && h2h.avgGamesPerSet > 0) {
    const where = h2h.surfaceFiltered ? ` no ${surf}` : '';
    parts.push(`${h2h.avgGamesPerSet.toFixed(1)} games por set quando jogam entre si${where}`);
  }
  return parts.join(' · ');
}

function buildTotalAcesReasoning(
  confidence: number,
  playerName: string,
  avgAces: number,
  opponentReturn: number,
  surface: string,
  acesPerSet: number,
  bestOf: 3 | 5,
): string {
  void confidence;
  const surf = surfaceLabel(surface);
  const parts: string[] = [
    `${lastName(playerName)} faz ~${acesPerSet.toFixed(1)} aces por set no ${surf} (estimativa de ${avgAces.toFixed(1)} no total para jogo de até ${bestOf} sets)`,
  ];
  if (opponentReturn > 0) {
    parts.push(`adversário retorna ${Math.round(opponentReturn * 100)}% dos pontos`);
  }
  return parts.join(' · ');
}

// ─── Tip curto para cards de destaque na home ─────────────────────────────────

function buildTip(
  winnerStats: PlayerStats,
  loserStats: PlayerStats,
  h2h: H2HRecord,
  surface: string
): string {
  const surfaceName = surfaceLabel(surface);
  const firstName = winnerStats.playerName.split(' ')[0];
  const parts: string[] = [];

  // H2H dominance
  const wWins = winnerStats.playerName === h2h.player1 ? h2h.player1Wins : h2h.player2Wins;
  const lWins = h2h.totalMatches - wWins;
  if (h2h.totalMatches >= 3 && wWins > lWins) {
    parts.push(`leva o confronto direto (${wWins}-${lWins})`);
  }

  // Surface win rate
  if (winnerStats.winRate >= 0.65 && winnerStats.hasEnoughData) {
    parts.push(`${Math.round(winnerStats.winRate * 100)}% de aproveitamento no ${surfaceName}`);
  }

  // Ranking advantage
  if (winnerStats.rank > 0 && loserStats.rank > 0 && winnerStats.rank < loserStats.rank) {
    parts.push(`melhor ranking (#${winnerStats.rank} vs #${loserStats.rank})`);
  }

  if (parts.length === 0) {
    return `${firstName} com leve vantagem no desempenho recente em ${surfaceName}`;
  }

  return `${firstName} ${parts.join(' e ')}`;
}

// ─── MERCADO 4 — Vencedor do 1º set ─────────────────────────────────────────

function calcFirstSet(
  stats1: PlayerStats,
  stats2: PlayerStats,
  matchProb1: number,
): { prob1: number; prob2: number } {
  const hasFS1 = stats1.firstSetMatches >= 8;
  const hasFS2 = stats2.firstSetMatches >= 8;

  if (hasFS1 && hasFS2) {
    // Ambos têm dados reais de 1º set — combina com o modelo de partida
    // Peso 60% dados reais, 40% probabilidade de partida amortecida
    const damp = 0.70;
    const matchBased = 0.5 + (matchProb1 - 0.5) * damp;
    const dataBased  = stats1.firstSetWinRate / (stats1.firstSetWinRate + stats2.firstSetWinRate);
    const prob1 = dataBased * 0.60 + matchBased * 0.40;
    return { prob1: Math.max(0.30, Math.min(0.70, prob1)), prob2: 1 - prob1 };
  }

  if (hasFS1 || hasFS2) {
    // Apenas um tem dados — usa 50/50 dos dados + matchProb amortecida
    const damp = 0.70;
    const matchBased = 0.5 + (matchProb1 - 0.5) * damp;
    const fsRate = hasFS1 ? stats1.firstSetWinRate : (1 - stats2.firstSetWinRate);
    const prob1 = fsRate * 0.40 + matchBased * 0.60;
    return { prob1: Math.max(0.30, Math.min(0.70, prob1)), prob2: 1 - prob1 };
  }

  // Sem dados reais de 1º set — fallback: amortece probabilidade de partida
  const damp = 0.70;
  const prob1 = 0.5 + (matchProb1 - 0.5) * damp;
  return { prob1, prob2: 1 - prob1 };
}

function buildFirstSetReasoning(
  winnerProb: number,
  winnerStats: PlayerStats,
  loserStats: PlayerStats,
  h2h: H2HRecord,
  surface: string,
): string {
  const surf = surfaceLabel(surface);
  const wLast = lastName(winnerStats.playerName);
  const lLast = lastName(loserStats.playerName);
  const evidence: string[] = [];

  if (winnerStats.firstSetMatches >= 8 && loserStats.firstSetMatches >= 8) {
    evidence.push(`no ${surf}, ${wLast} ganha o 1º set em ${Math.round(winnerStats.firstSetWinRate * 100)}% das partidas e ${lLast} em ${Math.round(loserStats.firstSetWinRate * 100)}%`);
  } else if (winnerStats.firstSetMatches >= 8) {
    evidence.push(`${wLast} ganha o 1º set em ${Math.round(winnerStats.firstSetWinRate * 100)}% no ${surf}`);
  } else if (winnerStats.hasEnoughData && winnerStats.winRate >= 0.6) {
    evidence.push(`${wLast} vence ${Math.round(winnerStats.winRate * 100)}% das partidas no ${surf}`);
  }

  if (winnerStats.rank > 0 && loserStats.rank > 0 && Math.abs(winnerStats.rank - loserStats.rank) > 5) {
    evidence.push(`ranking ${wLast} #${winnerStats.rank} vs ${lLast} #${loserStats.rank}`);
  }
  const wWins = winnerStats.playerName === h2h.player1 ? h2h.player1Wins : h2h.player2Wins;
  const lWins = h2h.totalMatches - wWins;
  if (h2h.totalMatches >= 3) {
    const where = h2h.surfaceFiltered ? ` no ${surf}` : '';
    evidence.push(`${wWins} a ${lWins} no confronto direto${where}`);
  }
  const evidenceText = evidence.length > 0 ? evidence.join('; ') : 'dados limitados';
  return `${strengthLabel(winnerProb)}. ${evidenceText.charAt(0).toUpperCase() + evidenceText.slice(1)}.`;
}

// ─── MERCADO 5 — Total de sets ───────────────────────────────────────────────

function calcTotalSets(
  stats1: PlayerStats,
  stats2: PlayerStats,
  h2h: H2HRecord,
  matchProb: number, // probabilidade do favorito vencer
  bestOf: 3 | 5,
  userLine?: number,
): { line: number; overProb: number; underProb: number; expectedSets: number; details: Record<string, unknown> } {
  const defaultLine = bestOf === 5 ? 3.5 : 2.5;
  const line = userLine ?? defaultLine;

  // ✅ FIX: usar setCompletionRate (invariante BO3/BO5) em vez de avgSetsPerMatch.
  // Um jogador que faz 80% de completion (vai a 2.4/3 sets em BO3) faz ~4/5 em BO5.

  const maxSetsForMatch = bestOf;

  // 1. Sinal principal: completion rate dos dois jogadores escalado pro formato atual
  const hasIndividualData = stats1.setsMatches >= 8 && stats2.setsMatches >= 8;
  const avgCompletion = (stats1.setCompletionRate + stats2.setCompletionRate) / 2;
  const avgIndividual = hasIndividualData
    ? avgCompletion * maxSetsForMatch
    : (bestOf === 5 ? 3.7 : 2.4); // default razoável

  // 2. Sinal secundário: H2H avgSetsPerMatch (mix de BO3/BO5)
  // Filtrado por superfície quando possível; convertemos relativizando ao formato atual.
  // Aproximação simples: se H2H média foi 2.4 e máximo era em média 3 (assumindo BO3),
  // a completion rate seria 0.8, que em BO5 dá 4.0 sets.
  // Como não sabemos a mistura exata do H2H, assumimos BO3 (default da maioria) como aproximação.
  let avgH2H = avgIndividual;
  const hasH2HData = h2h.totalMatches >= 4 && h2h.avgSetsPerMatch > 0;
  if (hasH2HData) {
    const h2hCompletion = h2h.avgSetsPerMatch / 3; // assume BO3 como base (mais comum)
    avgH2H = h2hCompletion * maxSetsForMatch;
  }

  // 3. Ajuste de desequilíbrio: partida muito desequilibrada → tende a menos sets
  // gap=0 (equilibrado) → 0; gap=0.5 (dominante) → reduz ~0.3 sets
  const gap = Math.abs(matchProb - 0.5);
  const imbalancePenalty = gap * 0.6; // reduz até 0.3 sets para BO3

  // 4. Combinação ponderada
  const expectedSets =
    avgIndividual * 0.50 +
    avgH2H * 0.30 +
    (avgIndividual - imbalancePenalty) * 0.20;

  // 5. P(over line) via logística em torno da expectativa
  // Para BO3: sigma=0.45 (variabilidade observada empírica)
  // Para BO5: sigma=0.75
  const sigma = bestOf === 5 ? 0.75 : 0.45;
  const z = (expectedSets - line) / sigma;
  const pOver = 1 / (1 + Math.exp(-z * 1.6));

  return {
    line,
    overProb: Math.max(0.10, Math.min(0.90, pOver)),
    underProb: 1 - Math.max(0.10, Math.min(0.90, pOver)),
    expectedSets,
    details: {
      avgIndividual: avgIndividual.toFixed(2),
      avgH2H: avgH2H.toFixed(2),
      imbalancePenalty: imbalancePenalty.toFixed(2),
      expectedSets: expectedSets.toFixed(2),
      hasIndividualData,
      hasH2HData,
    },
  };
}

function buildTotalSetsReasoning(
  confidence: number,
  direction: string,
  expectedSets: number,
  stats1: PlayerStats,
  stats2: PlayerStats,
  h2h: H2HRecord,
  surface: string,
): string {
  void confidence; void direction;
  const surf = surfaceLabel(surface);
  const parts: string[] = [`média estimada ${expectedSets.toFixed(1)} sets na partida`];

  if (stats1.setsMatches >= 8 && stats2.setsMatches >= 8) {
    parts.push(`${lastName(stats1.playerName)} faz ${stats1.avgSetsPerMatch.toFixed(1)} / ${lastName(stats2.playerName)} faz ${stats2.avgSetsPerMatch.toFixed(1)} sets/jogo no ${surf}`);
  }
  if (h2h.totalMatches >= 4 && h2h.avgSetsPerMatch > 0) {
    const where = h2h.surfaceFiltered ? ` no ${surf}` : '';
    parts.push(`média de ${h2h.avgSetsPerMatch.toFixed(1)} sets quando jogam entre si${where}`);
  }
  return parts.join(' · ');
}

// ─── MERCADO 6 — Duplas faltas ───────────────────────────────────────────────

function calcDFsForPlayer(
  player: PlayerStats,
  userLine?: number,
  bestOf: 3 | 5 = 3,
  matchProb: number = 0.5,
): { line: number; overProb: number; underProb: number; avgDFs: number } {
  // ✅ FIX: DFs escalam com nº de sets (mais service games = mais oportunidade de DF)
  const dfsPerSet = player.avgDFsPerSet || 0;
  const expectedSets = expectedSetsForMatch(bestOf, matchProb);
  const avgDFs = Math.max(0, dfsPerSet * expectedSets);

  const line   = userLine ?? Math.max(1, Math.round(avgDFs * 2) / 2);
  const sigma  = bestOf === 5 ? 2.2 : 1.5;
  const z      = (avgDFs - line) / sigma;
  const overProb = 1 / (1 + Math.exp(-z * 1.7));

  return { line, overProb, underProb: 1 - overProb, avgDFs };
}

function buildDFsReasoning(
  confidence: number,
  playerName: string,
  avgDFs: number,
  surface: string,
  dfsPerSet: number,
  bestOf: 3 | 5,
): string {
  void confidence;
  const surf = surfaceLabel(surface);
  return `${lastName(playerName)} comete ~${dfsPerSet.toFixed(1)} duplas faltas por set no ${surf} (estimativa de ${avgDFs.toFixed(1)} no total para jogo de até ${bestOf} sets)`;
}

// ────────────────────────────────────────────────────────────────────────────

export function previewMatch(
  player1: string,
  player2: string,
  surface: string,
  data: MatchRecord[]
): MatchPreview {
  const stats1 = getPlayerStats(player1, surface, data);
  const stats2 = getPlayerStats(player2, surface, data);
  const h2h    = getH2H(player1, player2, data, surface);

  const { prob1, prob2 } = calcMoneyline(stats1, stats2, h2h);
  const isP1Winner = prob1 >= prob2;
  const winner      = isP1Winner ? player1 : player2;
  const confidence  = Math.max(prob1, prob2);

  const winnerStats = isP1Winner ? stats1 : stats2;
  const loserStats  = isP1Winner ? stats2 : stats1;

  return {
    player1,
    player2,
    surface,
    suggestion: `${winner} vence`,
    confidence,
    hasEnoughData: stats1.hasEnoughData && stats2.hasEnoughData,
    tip: buildTip(winnerStats, loserStats, h2h, surface),
  };
}

// ─── Função principal ────────────────────────────────────────────────────────

export async function analyzeMatch(
  player1: string,
  player2: string,
  surface: string,
  market: Market,
  data: MatchRecord[],
  options: AnalyzeOptions = {},
): Promise<ModelResult> {
  const warnings: string[] = [];

  // Estatísticas dos jogadores
  const stats1 = getPlayerStats(player1, surface, data);
  const stats2 = getPlayerStats(player2, surface, data);
  const h2h = getH2H(player1, player2, data, surface);

  if (stats1.fallbackToAllSurfaces) {
    warnings.push(`Dados insuficientes de ${player1} em ${surface}. Usando todas as superfícies.`);
  }
  if (stats2.fallbackToAllSurfaces) {
    warnings.push(`Dados insuficientes de ${player2} em ${surface}. Usando todas as superfícies.`);
  }
  if (!stats1.hasEnoughData) {
    warnings.push(`Poucos dados históricos para ${player1} (${stats1.matchCount} partidas).`);
  }
  if (!stats2.hasEnoughData) {
    warnings.push(`Poucos dados históricos para ${player2} (${stats2.matchCount} partidas).`);
  }
  if (h2h.totalMatches < 3) {
    warnings.push(`Poucas partidas entre os dois jogadores no histórico (${h2h.totalMatches}). Peso do confronto direto reduzido.`);
  }

  const { userLine, userOdd, bestOf = 3, skipExternalOdds = false, forceDirection, forcePlayer } = options;

  // Odds externas só buscadas no fluxo de análise da home (não no simulador)
  const odds = skipExternalOdds
    ? { player1Odd: null, player2Odd: null, overOdd: null, underOdd: null, bookmaker: null }
    : await fetchOdds(player1, player2);

  // ── Moneyline ──
  if (market === 'moneyline') {
    const { prob1, prob2, details } = calcMoneyline(stats1, stats2, h2h);
    const modelPrefersP1 = prob1 >= prob2;
    // Se o usuário forçou um jogador, usa ele; senão, usa o preferido do modelo
    const isP1Winner = forcePlayer === 'p1' ? true : forcePlayer === 'p2' ? false : modelPrefersP1;
    const winner = isP1Winner ? player1 : player2;
    const winnerProb = isP1Winner ? prob1 : prob2;
    const winnerStats = isP1Winner ? stats1 : stats2;
    const loserStats  = isP1Winner ? stats2 : stats1;

    if (forcePlayer && (forcePlayer === 'p1') !== modelPrefersP1) {
      warnings.unshift(`Atenção: você está apostando em ${winner}, mas o modelo recomenda ${isP1Winner ? player2 : player1}. A confiança mostrada é a chance da SUA escolha.`);
    }

    const oddForWinner = userOdd ?? (isP1Winner ? odds.player1Odd : odds.player2Odd);
    const impliedProb = getImpliedProbability(oddForWinner);
    const edge = classifyEdge(winnerProb, impliedProb);

    return {
      market,
      player1,
      player2,
      surface,
      suggestion: `${winner} vence`,
      reasoning: buildMoneylineReasoning(winnerProb, winnerStats, loserStats, h2h, surface),
      confidence: winnerProb,
      modelProbability: winnerProb,
      impliedProbability: impliedProb,
      oddValue: oddForWinner,
      bookmaker: odds.bookmaker,
      edge,
      support: { player1Stats: stats1, player2Stats: stats2, h2h, details },
      warnings,
    };
  }

  // ── Total de games ──
  if (market === 'total_games') {
    // Probabilidade do match para estimar nº de sets (afeta total de games)
    const { prob1: mlProb } = calcMoneyline(stats1, stats2, h2h);
    const { line, overProb, underProb, avgGames, details } = calcTotalGames(stats1, stats2, h2h, userLine, bestOf, mlProb);
    const modelPrefersOver = overProb >= underProb;
    const suggestOver = forceDirection === 'over' ? true : forceDirection === 'under' ? false : modelPrefersOver;
    const suggestion = suggestOver ? `Over ${line} games` : `Under ${line} games`;
    const confidence = suggestOver ? overProb : underProb;

    if (forceDirection && (forceDirection === 'over') !== modelPrefersOver) {
      warnings.unshift(`Atenção: você está apostando ${forceDirection === 'over' ? 'Over' : 'Under'} ${line}, mas o modelo recomenda ${modelPrefersOver ? 'Over' : 'Under'}. A confiança mostrada é a chance da SUA escolha.`);
    }

    // Odds de totals — usa odd do usuário se informada
    const relevantOdd = userOdd ?? (suggestOver ? odds.overOdd : odds.underOdd);
    const impliedProb = getImpliedProbability(relevantOdd);
    const edge = classifyEdge(confidence, impliedProb);

    if (!relevantOdd) {
      warnings.push('Sem odd de Over/Under disponível. Informe a odd da casa para comparar.');
    }

    return {
      market,
      player1,
      player2,
      surface,
      suggestion,
      reasoning: buildTotalGamesReasoning(confidence, avgGames, h2h, surface, stats1, stats2, bestOf),
      confidence,
      modelProbability: confidence,
      impliedProbability: impliedProb,
      oddValue: relevantOdd,
      bookmaker: odds.bookmaker,
      edge,
      support: {
        player1Stats: stats1,
        player2Stats: stats2,
        h2h,
        details: { ...details, avgGames: avgGames.toFixed(1) },
      },
      warnings,
    };
  }

  // ── Vencedor do 1º set ──
  if (market === 'first_set') {
    const { prob1, prob2 } = calcMoneyline(stats1, stats2, h2h);
    void prob2;
    const { prob1: fs1, prob2: fs2 } = calcFirstSet(stats1, stats2, prob1);
    const modelPrefersP1 = fs1 >= fs2;
    const isP1Winner = forcePlayer === 'p1' ? true : forcePlayer === 'p2' ? false : modelPrefersP1;
    const winner = isP1Winner ? player1 : player2;
    const winnerProb = isP1Winner ? fs1 : fs2;
    const winnerStats = isP1Winner ? stats1 : stats2;
    const loserStats  = isP1Winner ? stats2 : stats1;

    if (forcePlayer && (forcePlayer === 'p1') !== modelPrefersP1) {
      warnings.unshift(`Atenção: você está apostando em ${winner}, mas o modelo recomenda ${isP1Winner ? player2 : player1}. A confiança mostrada é a chance da SUA escolha.`);
    }

    const oddForWinner = userOdd ?? (isP1Winner ? odds.player1Odd : odds.player2Odd);
    const impliedProb  = getImpliedProbability(oddForWinner);
    const edge = classifyEdge(winnerProb, impliedProb);

    return {
      market, player1, player2, surface,
      suggestion: `${winner} vence o 1º set`,
      reasoning: buildFirstSetReasoning(winnerProb, winnerStats, loserStats, h2h, surface),
      confidence: winnerProb,
      modelProbability: winnerProb,
      impliedProbability: impliedProb,
      oddValue: oddForWinner,
      bookmaker: userOdd ? 'informada' : odds.bookmaker,
      edge,
      support: { player1Stats: stats1, player2Stats: stats2, h2h, details: { fs1: fs1.toFixed(3), fs2: fs2.toFixed(3), matchProb1: prob1.toFixed(3) } },
      warnings,
    };
  }

  // ── Total de sets ──
  if (market === 'total_sets') {
    const { prob1 } = calcMoneyline(stats1, stats2, h2h);
    const favoriteProb = Math.max(prob1, 1 - prob1);
    const { line, overProb, underProb, expectedSets, details } = calcTotalSets(
      stats1, stats2, h2h, favoriteProb, bestOf, userLine
    );
    const modelPrefersOver = overProb >= underProb;
    const suggestOver = forceDirection === 'over' ? true : forceDirection === 'under' ? false : modelPrefersOver;
    const confidence  = suggestOver ? overProb : underProb;
    const direction   = suggestOver ? 'Over' : 'Under';
    const suggestion  = `${direction} ${line} sets`;

    if (forceDirection && (forceDirection === 'over') !== modelPrefersOver) {
      warnings.unshift(`Atenção: você está apostando ${direction} ${line} sets, mas o modelo recomenda ${modelPrefersOver ? 'Over' : 'Under'}. A confiança mostrada é a chance da SUA escolha.`);
    }

    const relevantOdd = userOdd ?? null;
    const impliedProb = getImpliedProbability(relevantOdd);
    const edge = classifyEdge(confidence, impliedProb);

    if (!relevantOdd && !skipExternalOdds) {
      warnings.push('Sem odd de Over/Under disponível. Informe a odd da casa para comparar.');
    }
    if (stats1.setsMatches < 8 || stats2.setsMatches < 8) {
      warnings.push('Poucas partidas com placar válido para estimar o número de sets. Confiança reduzida.');
    }

    return {
      market, player1, player2, surface,
      suggestion,
      reasoning: buildTotalSetsReasoning(confidence, direction, expectedSets, stats1, stats2, h2h, surface),
      confidence,
      modelProbability: confidence,
      impliedProbability: impliedProb,
      oddValue: relevantOdd,
      bookmaker: userOdd ? 'informada' : null,
      edge,
      support: { player1Stats: stats1, player2Stats: stats2, h2h, details },
      warnings,
    };
  }

  // ── Duplas faltas ──
  if (market === 'total_dfs') {
    const { prob1: mlProbDFs } = calcMoneyline(stats1, stats2, h2h);
    const dfsP1 = calcDFsForPlayer(stats1, userLine, bestOf, mlProbDFs);
    const dfsP2 = calcDFsForPlayer(stats2, userLine, bestOf, mlProbDFs);

    // Escolhe o jogador: forçado pelo usuário, ou o de maior edge
    const edgeP1 = Math.abs(dfsP1.overProb - 0.5);
    const edgeP2 = Math.abs(dfsP2.overProb - 0.5);
    const modelPrefersP1 = edgeP1 >= edgeP2;
    const useP1 = forcePlayer === 'p1' ? true : forcePlayer === 'p2' ? false : modelPrefersP1;
    const mainPlayer = useP1 ? player1 : player2;
    const mainDFs    = useP1 ? dfsP1 : dfsP2;

    // Direção: forçada pelo usuário, ou o lado de maior probabilidade
    const modelPrefersOver = mainDFs.overProb >= 0.5;
    const suggestOver = forceDirection === 'over' ? true : forceDirection === 'under' ? false : modelPrefersOver;
    const confidence  = suggestOver ? mainDFs.overProb : mainDFs.underProb;
    const suggestion  = `${lastName(mainPlayer)} · ${suggestOver ? 'Over' : 'Under'} ${mainDFs.line} duplas faltas`;

    if (forceDirection && (forceDirection === 'over') !== modelPrefersOver) {
      warnings.unshift(`Atenção: você está apostando ${suggestOver ? 'Over' : 'Under'} para ${lastName(mainPlayer)}, mas o modelo recomenda o oposto. A confiança mostrada é a chance da SUA escolha.`);
    }

    const dfsImpliedProb = userOdd ? getImpliedProbability(userOdd) : null;
    const dfsEdge = classifyEdge(confidence, dfsImpliedProb);

    return {
      market, player1, player2, surface,
      suggestion,
      reasoning: buildDFsReasoning(
        confidence,
        mainPlayer,
        mainDFs.avgDFs,
        surface,
        (useP1 ? stats1.avgDFsPerSet : stats2.avgDFsPerSet) || 0,
        bestOf,
      ),
      confidence,
      modelProbability: confidence,
      impliedProbability: dfsImpliedProb,
      oddValue: userOdd ?? null,
      bookmaker: userOdd ? 'informada' : null,
      edge: dfsEdge,
      support: {
        player1Stats: stats1,
        player2Stats: stats2,
        h2h,
        details: {
          [player1]: { avgDFs: dfsP1.avgDFs.toFixed(1), line: dfsP1.line, overProb: dfsP1.overProb.toFixed(3) },
          [player2]: { avgDFs: dfsP2.avgDFs.toFixed(1), line: dfsP2.line, overProb: dfsP2.overProb.toFixed(3) },
        },
      },
      warnings,
    };
  }

  // ── Total de aces ──
  // Aces escalam com nº de sets, então passamos bestOf + matchProb pro modelo
  const { prob1: mlProbAces } = calcMoneyline(stats1, stats2, h2h);
  const acesP1 = calcAcesForPlayer(stats1, stats2, userLine, bestOf, mlProbAces);
  const acesP2 = calcAcesForPlayer(stats2, stats1, userLine, bestOf, mlProbAces);

  // Escolhe o jogador: forçado pelo usuário, ou o de maior edge
  const edgeP1 = Math.abs(acesP1.overProb - 0.5);
  const edgeP2 = Math.abs(acesP2.overProb - 0.5);
  const modelPrefersP1Aces = edgeP1 >= edgeP2;
  const useP1Aces = forcePlayer === 'p1' ? true : forcePlayer === 'p2' ? false : modelPrefersP1Aces;
  const mainPlayer = useP1Aces ? player1 : player2;
  const mainAces   = useP1Aces ? acesP1 : acesP2;

  // Direção: forçada pelo usuário, ou o lado de maior probabilidade
  const modelPrefersOverAces = mainAces.overProb >= 0.5;
  const suggestOver = forceDirection === 'over' ? true : forceDirection === 'under' ? false : modelPrefersOverAces;
  const suggestion = `${lastName(mainPlayer)} · ${suggestOver ? 'Over' : 'Under'} ${mainAces.line} aces`;
  const confidence = suggestOver ? mainAces.overProb : mainAces.underProb;

  if (forceDirection && (forceDirection === 'over') !== modelPrefersOverAces) {
    warnings.unshift(`Atenção: você está apostando ${suggestOver ? 'Over' : 'Under'} para ${lastName(mainPlayer)}, mas o modelo recomenda o oposto. A confiança mostrada é a chance da SUA escolha.`);
  }

  const opponentStats = mainPlayer === player1 ? stats2 : stats1;

  const acesImpliedProb = userOdd ? getImpliedProbability(userOdd) : null;
  const acesEdge = classifyEdge(confidence, acesImpliedProb);

  return {
    market,
    player1,
    player2,
    surface,
    suggestion,
    reasoning: buildTotalAcesReasoning(
      confidence,
      mainPlayer,
      mainAces.avgAces,
      opponentStats.returnPointsWonPct,
      surface,
      (useP1Aces ? stats1.avgAcesPerSet : stats2.avgAcesPerSet) || 0,
      bestOf,
    ),
    confidence,
    modelProbability: confidence,
    impliedProbability: acesImpliedProb,
    oddValue: userOdd ?? null,
    bookmaker: userOdd ? 'informada' : null,
    edge: acesEdge,
    support: {
      player1Stats: stats1,
      player2Stats: stats2,
      h2h,
      details: {
        [player1]: { avgAces: acesP1.avgAces.toFixed(1), line: acesP1.line, overProb: acesP1.overProb.toFixed(3) },
        [player2]: { avgAces: acesP2.avgAces.toFixed(1), line: acesP2.line, overProb: acesP2.overProb.toFixed(3) },
      },
    },
    warnings,
  };
}
