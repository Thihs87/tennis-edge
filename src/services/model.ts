import { getPlayerStats, getH2H } from '@/services/tml';
import { fetchOdds, getImpliedProbability } from '@/services/odds';
import type { MatchRecord, PlayerStats, H2HRecord } from '@/types/tennis';

// ─── Tipos de resultado ──────────────────────────────────────────────────────

export type Market = 'moneyline' | 'total_games' | 'total_aces';

export type OddEdge = 'value' | 'fair' | 'no_value' | 'unavailable';

export interface ModelResult {
  market: Market;
  player1: string;
  player2: string;
  surface: string;

  // Sugestão principal
  suggestion: string;         // ex: "Jannik Sinner vence" ou "Over 21.5 games"
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

function classifyEdge(modelProb: number, impliedProb: number | null): OddEdge {
  if (impliedProb === null) return 'unavailable';
  const diff = modelProb - impliedProb;
  if (diff > 0.05) return 'value';
  if (diff < -0.05) return 'no_value';
  return 'fair';
}

// Peso de ranking: diferença de posições ATP → fator multiplicativo
function rankingFactor(rankA: number, rankB: number): number {
  if (rankA <= 0 || rankB <= 0) return 1; // ranking desconhecido → neutro
  const diff = Math.abs(rankA - rankB);
  if (diff <= 10) return 1.0;
  if (diff <= 50) return rankA < rankB ? 1.08 : 0.92;
  return rankA < rankB ? 1.18 : 0.82;
}

// Normaliza dois valores para somarem 1
function normalize(a: number, b: number): [number, number] {
  const sum = a + b;
  if (sum === 0) return [0.5, 0.5];
  return [a / sum, b / sum];
}

// ─── MERCADO 1 — Moneyline ───────────────────────────────────────────────────

function calcMoneyline(
  stats1: PlayerStats,
  stats2: PlayerStats,
  h2h: H2HRecord
): { prob1: number; prob2: number; details: Record<string, unknown> } {
  // Win rate na superfície (peso 50%)
  const wr1 = stats1.winRate || 0.5;
  const wr2 = stats2.winRate || 0.5;

  // H2H (peso 30%)
  let h2hProb1 = 0.5;
  let h2hProb2 = 0.5;
  if (h2h.totalMatches >= 3) {
    h2hProb1 = h2h.player1Wins / h2h.totalMatches;
    h2hProb2 = h2h.player2Wins / h2h.totalMatches;
  }

  // Delta de ranking (peso 20%) aplicado como fator sobre win rate
  const rf = rankingFactor(stats1.rank, stats2.rank);
  const wr1Adj = wr1 * (stats1.rank > 0 && stats1.rank < stats2.rank ? rf : 1);
  const wr2Adj = wr2 * (stats2.rank > 0 && stats2.rank < stats1.rank ? rf : 1);
  const [normWr1, normWr2] = normalize(wr1Adj, wr2Adj);

  // Combinação ponderada
  const raw1 = normWr1 * 0.50 + h2hProb1 * 0.30 + (stats1.rank > 0 && stats1.rank <= stats2.rank ? 0.55 : 0.45) * 0.20;
  const raw2 = normWr2 * 0.50 + h2hProb2 * 0.30 + (stats2.rank > 0 && stats2.rank <= stats1.rank ? 0.55 : 0.45) * 0.20;
  const [prob1, prob2] = normalize(raw1, raw2);

  return {
    prob1,
    prob2,
    details: {
      winRate: { [stats1.playerName]: wr1.toFixed(3), [stats2.playerName]: wr2.toFixed(3) },
      h2h: { [stats1.playerName]: h2hProb1.toFixed(3), [stats2.playerName]: h2hProb2.toFixed(3), matches: h2h.totalMatches },
      ranking: { [stats1.playerName]: stats1.rank, [stats2.playerName]: stats2.rank, factor: rf.toFixed(2) },
    },
  };
}

// ─── MERCADO 2 — Total de games ──────────────────────────────────────────────

const GAME_LINES = [19.5, 21.5, 23.5];

function calcTotalGames(
  stats1: PlayerStats,
  stats2: PlayerStats,
  h2h: H2HRecord
): { line: number; overProb: number; underProb: number; avgGames: number; details: Record<string, unknown> } {
  // Média de games por partida na superfície (peso 40%)
  const avgSurface = (stats1.avgGamesPerMatch + stats2.avgGamesPerMatch) / 2;

  // Média H2H (peso 35%)
  const avgH2H = h2h.totalMatches >= 3 ? h2h.avgGamesPerMatch : avgSurface;

  // Break point conversion rate → quanto maior, mais longa a partida (peso 25%)
  // bp alto = mais games; convertemos para uma média ajustada +/- 2 games
  const bpAvg = (stats1.bpConversionRate + stats2.bpConversionRate) / 2;
  const bpAdjust = (bpAvg - 0.5) * 4; // centro em 0.5, ajuste de até ±2 games

  const weightedAvg =
    avgSurface * 0.40 +
    avgH2H * 0.35 +
    (avgSurface + bpAdjust) * 0.25;

  // Seleciona a linha mais próxima da média — cria maior incerteza e potencial edge
  // (linhas triviais como 19.5 quando média é 23.5 não geram valor de aposta)
  const sigma = 3.0;
  let bestLine = GAME_LINES[1]; // default 21.5
  let minDist = Infinity;

  for (const line of GAME_LINES) {
    const dist = Math.abs(weightedAvg - line);
    if (dist < minDist) {
      minDist = dist;
      bestLine = line;
    }
  }

  // Probabilidade: usa aproximação logística em torno da média estimada
  const z = (weightedAvg - bestLine) / sigma;
  const overProb = 1 / (1 + Math.exp(-z * 1.7)); // sigmoid calibrada para tênis
  const underProb = 1 - overProb;

  return {
    line: bestLine,
    overProb,
    underProb,
    avgGames: weightedAvg,
    details: {
      avgGamesSurface: avgSurface.toFixed(1),
      avgGamesH2H: avgH2H.toFixed(1),
      bpAdjust: bpAdjust.toFixed(2),
      weightedAvg: weightedAvg.toFixed(1),
      bestLine,
    },
  };
}

// ─── MERCADO 3 — Total de aces ───────────────────────────────────────────────

function calcAcesForPlayer(
  player: PlayerStats,
  opponent: PlayerStats
): { line: number; overProb: number; underProb: number; avgAces: number } {
  // Média de aces na superfície (peso 60%)
  const baseAces = player.avgAcesPerMatch;

  // Return points won % do adversário: quanto maior, mais difícil sacar (peso 40%)
  // returnPointsWonPct alto = adversário devolve bem = menos aces
  const returnPressure = opponent.returnPointsWonPct;
  const returnAdjust = (0.5 - returnPressure) * baseAces * 0.8; // ajuste proporcional

  const avgAces = Math.max(0, baseAces * 0.60 + (baseAces + returnAdjust) * 0.40);

  // Linha mais próxima da média (arredonda para .5)
  const line = Math.round(avgAces * 2) / 2;

  // Probabilidade over/under
  const sigma = 2.0;
  const z = (avgAces - line) / sigma;
  const overProb = 1 / (1 + Math.exp(-z * 1.7));

  return { line, overProb, underProb: 1 - overProb, avgAces };
}

// ─── Função principal ────────────────────────────────────────────────────────

export async function analyzeMatch(
  player1: string,
  player2: string,
  surface: string,
  market: Market,
  data: MatchRecord[]
): Promise<ModelResult> {
  const warnings: string[] = [];

  // Estatísticas dos jogadores
  const stats1 = getPlayerStats(player1, surface, data);
  const stats2 = getPlayerStats(player2, surface, data);
  const h2h = getH2H(player1, player2, data);

  if (stats1.fallbackToAllSurfaces) {
    warnings.push(`Dados insuficientes de ${player1} em ${surface} — usando todas as superfícies.`);
  }
  if (stats2.fallbackToAllSurfaces) {
    warnings.push(`Dados insuficientes de ${player2} em ${surface} — usando todas as superfícies.`);
  }
  if (!stats1.hasEnoughData) {
    warnings.push(`Poucos dados históricos para ${player1} (${stats1.matchCount} partidas).`);
  }
  if (!stats2.hasEnoughData) {
    warnings.push(`Poucos dados históricos para ${player2} (${stats2.matchCount} partidas).`);
  }
  if (h2h.totalMatches < 3) {
    warnings.push(`H2H com poucas partidas (${h2h.totalMatches}) — peso do confronto direto reduzido.`);
  }

  // Odds em tempo real (sempre fresh)
  const odds = await fetchOdds(player1, player2);

  // ── Moneyline ──
  if (market === 'moneyline') {
    const { prob1, prob2, details } = calcMoneyline(stats1, stats2, h2h);
    const winner = prob1 >= prob2 ? player1 : player2;
    const winnerProb = prob1 >= prob2 ? prob1 : prob2;

    const oddForWinner = prob1 >= prob2 ? odds.player1Odd : odds.player2Odd;
    const impliedProb = getImpliedProbability(oddForWinner);
    const edge = classifyEdge(winnerProb, impliedProb);

    return {
      market,
      player1,
      player2,
      surface,
      suggestion: `${winner} vence`,
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
    const { line, overProb, underProb, avgGames, details } = calcTotalGames(stats1, stats2, h2h);
    const suggestOver = overProb >= underProb;
    const suggestion = suggestOver ? `Over ${line} games` : `Under ${line} games`;
    const confidence = suggestOver ? overProb : underProb;

    // Odds de totals indisponíveis no plano atual — sem comparação com casa
    const impliedProb = suggestOver
      ? getImpliedProbability(odds.overOdd)
      : getImpliedProbability(odds.underOdd);
    const edge = classifyEdge(confidence, impliedProb);

    if (!odds.overOdd) {
      warnings.push('Odds de totals não disponíveis — comparação com a casa indisponível para este mercado.');
    }

    return {
      market,
      player1,
      player2,
      surface,
      suggestion,
      confidence,
      modelProbability: confidence,
      impliedProbability: impliedProb,
      oddValue: suggestOver ? odds.overOdd : odds.underOdd,
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

  // ── Total de aces ──
  const acesP1 = calcAcesForPlayer(stats1, stats2);
  const acesP2 = calcAcesForPlayer(stats2, stats1);

  // Sugere o jogador com maior edge (maior diferença prob/0.5)
  const edgeP1 = Math.abs(acesP1.overProb - 0.5);
  const edgeP2 = Math.abs(acesP2.overProb - 0.5);
  const mainPlayer = edgeP1 >= edgeP2 ? player1 : player2;
  const mainAces = edgeP1 >= edgeP2 ? acesP1 : acesP2;

  const suggestOver = mainAces.overProb >= 0.5;
  const suggestion = `${suggestOver ? 'Over' : 'Under'} ${mainAces.line} aces — ${mainPlayer}`;
  const confidence = suggestOver ? mainAces.overProb : mainAces.underProb;

  return {
    market,
    player1,
    player2,
    surface,
    suggestion,
    confidence,
    modelProbability: confidence,
    impliedProbability: null,   // mercado de aces raramente coberto por APIs
    oddValue: null,
    bookmaker: null,
    edge: 'unavailable',
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
