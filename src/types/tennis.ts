// Linha de uma partida histórica dos CSVs do TML
export interface MatchRecord {
  winner_name: string;
  loser_name: string;
  winner_rank: number;
  loser_rank: number;
  surface: string;
  tourney_name: string;
  tourney_date: string; // formato YYYYMMDD
  round: string;
  score: string;
  minutes: number;
  w_ace: number;
  l_ace: number;
  w_df: number;
  l_df: number;
  w_svpt: number;
  w_1stIn: number;
  w_1stWon: number;
  w_2ndWon: number;
  w_bpSaved: number;
  w_bpFaced: number;
  l_svpt: number;
  l_1stIn: number;
  l_1stWon: number;
  l_2ndWon: number;
  l_bpSaved: number;
  l_bpFaced: number;
  tourney_level: string;
  best_of: number;
  // campos calculados no parse
  temporalWeight: number; // 1, 2 ou 3 conforme idade da partida
  totalGames: number;     // soma de todos os games do placar
}

// Partida disponível hoje (ongoing_tourneys.csv)
export interface OngoingMatch {
  id: string;
  player1: string;
  player2: string;
  player1Rank: number;
  player2Rank: number;
  tourneyName: string;
  surface: 'Clay' | 'Hard' | 'Grass' | 'Carpet' | string;
  round: string;
  status: 'live' | 'scheduled';
  hasOdds?: boolean;
  scheduledTime?: string;
  tourney_level?: string;
  best_of?: number;
}

// Estatísticas de um jogador numa superfície
export interface PlayerStats {
  playerName: string;
  surface: string;
  matchCount: number;
  winRate: number;               // 0-1
  avgGamesPerMatch: number;
  avgAcesPerMatch: number;
  avgDFsPerMatch: number;
  bpConversionRate: number;      // bpSaved/bpFaced — quanto maior, mais games dura
  returnPointsWonPct: number;    // (l_1stWon + l_2ndWon) / l_svpt — proxy de pressão no serviço
  rank: number;
  firstSetWinRate: number;       // % de vezes que ganhou o 1º set (calculado do placar)
  firstSetMatches: number;       // partidas com placar válido para cálculo do 1º set
  avgSetsPerMatch: number;       // média de sets jogados por partida (do placar)
  setsMatches: number;           // partidas com placar válido para cálculo de sets
  avgGamesPerSet: number;        // média de games por set (invariante a BO3/BO5)
  hasEnoughData: boolean;        // true se >= 10 partidas
  fallbackToAllSurfaces: boolean;
}

// Histórico de confronto direto
export interface H2HRecord {
  player1: string;
  player2: string;
  player1Wins: number;
  player2Wins: number;
  totalMatches: number;
  avgGamesPerMatch: number;       // ponderado por recência
  avgSetsPerMatch: number;        // ponderado por recência
  avgGamesPerSet: number;         // games por set quando jogam entre si (invariante BO3/BO5)
  surfaceFiltered: boolean;       // true se o H2H está filtrado pela superfície da partida
  weightedWinProb: number;        // probabilidade do P1 vencer, ponderada por recência (≤12m × 3, ≤36m × 2)
  recentMatches: Array<{
    winner: string;
    loser: string;
    score: string;
    surface: string;
    tourney_name: string;
    tourney_date: string;
  }>;
}

// Resultado do cache interno
export interface CacheEntry<T> {
  data: T;
  fetchedAt: number; // timestamp ms
}
