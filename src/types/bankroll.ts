/**
 * Tipos do sistema de gestão de banca.
 *
 * Desenhados pra mapear direto pra tabelas Supabase quando migrarmos:
 * - BankrollConfig → tabela bankroll_configs (1 por user_id)
 * - BetRecord     → tabela bet_records      (n por user_id)
 */

export interface BankrollConfig {
  username?: string;
  bankroll: number;        // em R$
  unitPercent: number;     // % da banca por unidade (ex: 0.01 = 1%)
  maxUnits: number;        // teto de unidades por aposta
  /** Mapeamento confiança → unidades. Ordenado por minConfidence asc. */
  confidenceMap: Array<{ minConfidence: number; units: number }>;
  updatedAt: string;       // ISO
}

export type BetStatus = 'pending' | 'won' | 'lost' | 'void';

export interface BetRecord {
  id: string;
  username?: string;
  recordedAt: string;      // ISO
  // Partida
  player1: string;
  player2: string;
  surface?: string;
  tourneyName?: string;
  // Aposta
  market: string;          // descrição humana: "Over 22.5 games", "Alcaraz vence", etc.
  odd: number;
  stakeUnits: number;
  stakeAmount: number;     // R$ no momento da aposta (snapshot da banca)
  modelConfidence?: number;
  // Resultado
  status: BetStatus;
  settledAt?: string;      // ISO quando foi marcado W/L
}

/** Resultado do cálculo de stake sugerido para uma aposta. */
export interface StakeSuggestion {
  units: number;           // 0 = não recomenda
  amount: number;          // R$
  reason: 'positive_edge' | 'no_odd' | 'negative_edge' | 'low_confidence' | 'no_config';
  message: string;         // texto explicativo pra UI
}

/** Estatísticas agregadas do histórico (calculadas em memória). */
export interface BetStats {
  total: number;
  pending: number;
  won: number;
  lost: number;
  void: number;
  winRate: number;         // 0-1 (sobre resolvidas)
  profit: number;          // R$ (lucro líquido)
  staked: number;          // R$ (total apostado em resolvidas)
  roi: number;             // 0-1
}
