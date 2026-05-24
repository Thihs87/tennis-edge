/**
 * Lógica de gestão de banca (tipster style).
 *
 * Toda regra de negócio fica aqui — sem dependência de storage.
 * Assim, quando migrarmos pra Supabase, este arquivo continua igual.
 */

import type {
  BankrollConfig,
  BetRecord,
  BetStats,
  StakeSuggestion,
} from '@/types/bankroll';

// ─── Config padrão ──────────────────────────────────────────────────────────

export const DEFAULT_CONFIDENCE_MAP: BankrollConfig['confidenceMap'] = [
  { minConfidence: 0.55, units: 1 },
  { minConfidence: 0.60, units: 2 },
  { minConfidence: 0.65, units: 3 },
  { minConfidence: 0.70, units: 4 },
  { minConfidence: 0.75, units: 5 },
];

export const DEFAULT_CONFIG: BankrollConfig = {
  username: '',
  bankroll: 1000,
  unitPercent: 0.01,
  maxUnits: 5,
  confidenceMap: DEFAULT_CONFIDENCE_MAP,
  updatedAt: new Date(0).toISOString(),
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Valor de 1 unidade em R$, dado a banca e o % por unidade. */
export function unitValue(config: BankrollConfig): number {
  return config.bankroll * config.unitPercent;
}

/** Converte unidades em R$ usando a config atual. */
export function unitsToAmount(units: number, config: BankrollConfig): number {
  return Math.round(units * unitValue(config) * 100) / 100;
}

/**
 * Retorna a quantidade de unidades pra uma dada confiança, baseado no mapa.
 * Aplica o cap de maxUnits.
 */
function unitsForConfidence(confidence: number, config: BankrollConfig): number {
  // Ordena por minConfidence desc pra pegar o primeiro que bate
  const sorted = [...config.confidenceMap].sort(
    (a, b) => b.minConfidence - a.minConfidence
  );
  for (const tier of sorted) {
    if (confidence >= tier.minConfidence) {
      return Math.min(tier.units, config.maxUnits);
    }
  }
  return 0;
}

// ─── Cálculo de stake ───────────────────────────────────────────────────────

/**
 * Calcula a aposta sugerida em unidades + R$.
 *
 * Regras:
 *  - Sem config válida (banca <= 0) → não sugere
 *  - Edge negativo (modelo < casa) → 0 unidades + aviso vermelho
 *  - Confiança abaixo do menor tier → 0 unidades
 *  - Caso contrário → unidades pelo mapa, R$ pela conversão
 */
export function calcStakeSuggestion(
  confidence: number,
  impliedProbability: number | null | undefined,
  config: BankrollConfig | null,
): StakeSuggestion {
  if (!config || config.bankroll <= 0) {
    return {
      units: 0,
      amount: 0,
      reason: 'no_config',
      message: 'Configure sua banca em "Banca" para ver a sugestão de aposta.',
    };
  }

  // Edge negativo bloqueia sugestão
  if (impliedProbability != null && confidence < impliedProbability) {
    return {
      units: 0,
      amount: 0,
      reason: 'negative_edge',
      message: 'A casa está mais confiante que o modelo. Não recomendado apostar.',
    };
  }

  const units = unitsForConfidence(confidence, config);

  if (units === 0) {
    return {
      units: 0,
      amount: 0,
      reason: 'low_confidence',
      message: `Confiança abaixo do mínimo para apostar (${Math.round(confidence * 100)}%).`,
    };
  }

  const amount = unitsToAmount(units, config);
  const valueText = formatBRL(amount);

  if (impliedProbability == null) {
    return {
      units,
      amount,
      reason: 'no_odd',
      message: `Sugestão de ${units}u (${valueText}) baseada só na confiança. Informe a odd da casa para confirmar valor.`,
    };
  }

  return {
    units,
    amount,
    reason: 'positive_edge',
    message: `Aposta sugerida: ${units}u (${valueText})`,
  };
}

// ─── Estatísticas do histórico ──────────────────────────────────────────────

/**
 * Calcula stats agregadas de uma lista de apostas registradas.
 * Apostas 'void' não entram em winRate/ROI mas contam no total.
 */
export function calcBetStats(bets: BetRecord[]): BetStats {
  const total   = bets.length;
  const pending = bets.filter(b => b.status === 'pending').length;
  const won     = bets.filter(b => b.status === 'won').length;
  const lost    = bets.filter(b => b.status === 'lost').length;
  const voidCt  = bets.filter(b => b.status === 'void').length;

  const resolved = bets.filter(b => b.status === 'won' || b.status === 'lost');
  const winRate  = resolved.length > 0 ? won / resolved.length : 0;

  let profit = 0;
  let staked = 0;
  for (const b of resolved) {
    staked += b.stakeAmount;
    if (b.status === 'won') {
      // Lucro líquido = (odd - 1) × stake
      profit += (b.odd - 1) * b.stakeAmount;
    } else {
      profit -= b.stakeAmount;
    }
  }
  const roi = staked > 0 ? profit / staked : 0;

  return { total, pending, won, lost, void: voidCt, winRate, profit, staked, roi };
}

// ─── Formatação ─────────────────────────────────────────────────────────────

export function formatBRL(amount: number): string {
  return amount.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}
