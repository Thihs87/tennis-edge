'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { calcStakeSuggestion, formatBRL } from '@/services/bankroll';
import { loadConfig, addBet } from '@/lib/bankroll-storage';
import type { BankrollConfig } from '@/types/bankroll';

interface Props {
  // Dados da análise atual
  confidence: number;
  impliedProbability: number | null;
  odd: number | null;
  modelProbability: number;
  // Pra registrar no histórico
  player1: string;
  player2: string;
  surface?: string;
  tourneyName?: string;
  market: string;          // texto amigável tipo "Over 22.5 games"
}

export function StakeSuggestion({
  confidence,
  impliedProbability,
  odd,
  modelProbability,
  player1,
  player2,
  surface,
  tourneyName,
  market,
}: Props) {
  const [config, setConfig] = useState<BankrollConfig | null>(null);
  const [registered, setRegistered] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [stakeOverride, setStakeOverride] = useState<string>('');

  // Carrega a config do localStorage no mount
  useEffect(() => {
    setConfig(loadConfig());
  }, []);

  if (!config) return null; // ainda hidratando

  const suggestion = calcStakeSuggestion(confidence, impliedProbability, config);
  const hasConfig  = config.bankroll > 0 && config.updatedAt !== new Date(0).toISOString();

  // Cor do bloco baseado na razão
  const toneClass =
    suggestion.reason === 'positive_edge' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400' :
    suggestion.reason === 'negative_edge' ? 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400' :
    suggestion.reason === 'no_odd'        ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400' :
    'border-border bg-muted/30 text-muted-foreground';

  // Caso: sem config — mostra CTA pra configurar
  if (!hasConfig) {
    return (
      <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground flex items-center justify-between gap-3">
        <span>💰 Configure sua banca para ver a aposta sugerida.</span>
        <Link href="/banca" className="text-primary font-semibold hover:underline shrink-0">
          Configurar →
        </Link>
      </div>
    );
  }

  // Caso: tem config, mas suggestion é 0 unidades (low_confidence ou negative_edge)
  if (suggestion.units === 0) {
    return (
      <div className={`rounded-xl border p-3 text-xs leading-relaxed ${toneClass}`}>
        <div className="flex items-start gap-2">
          <span className="shrink-0">{suggestion.reason === 'negative_edge' ? '⚠️' : '💤'}</span>
          <span>{suggestion.message}</span>
        </div>
      </div>
    );
  }

  // Caso: registrada
  if (registered) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs flex items-center justify-between gap-3">
        <span className="text-emerald-700 dark:text-emerald-400">✓ Aposta registrada no histórico.</span>
        <Link href="/banca" className="text-primary font-semibold hover:underline shrink-0">
          Ver histórico →
        </Link>
      </div>
    );
  }

  // Caso normal: sugestão + botão registrar
  function handleRegisterClick() {
    setStakeOverride(suggestion.units.toString());
    setShowConfirm(true);
  }

  function handleConfirm() {
    if (!odd || !config) return;
    const finalUnits = parseFloat(stakeOverride) || suggestion.units;
    const finalAmount = Math.round(finalUnits * config.bankroll * config.unitPercent * 100) / 100;

    addBet({
      username: config.username || undefined,
      player1,
      player2,
      surface,
      tourneyName,
      market,
      odd,
      stakeUnits: finalUnits,
      stakeAmount: finalAmount,
      modelConfidence: modelProbability,
      status: 'pending',
    });

    setRegistered(true);
    setShowConfirm(false);
  }

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-[11px] uppercase tracking-widest font-semibold opacity-80">💰 Aposta sugerida</p>
          <p className="text-xl font-bold tabular-nums">
            {suggestion.units}u <span className="text-base font-normal opacity-80">({formatBRL(suggestion.amount)})</span>
          </p>
        </div>
        {!showConfirm && odd && (
          <button
            type="button"
            onClick={handleRegisterClick}
            className="shrink-0 self-center px-3 py-2 rounded-lg border border-current text-xs font-semibold hover:bg-current/10 active:scale-[0.98] transition-all"
          >
            Registrar
          </button>
        )}
      </div>

      {showConfirm && odd && (
        <div className="space-y-2 pt-2 border-t border-current/20">
          <p className="text-xs opacity-80">Confirma o stake (em unidades)?</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.5"
              min="0.5"
              inputMode="decimal"
              value={stakeOverride}
              onChange={e => setStakeOverride(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <span className="text-xs opacity-80 tabular-nums">
              = {formatBRL((parseFloat(stakeOverride) || 0) * config.bankroll * config.unitPercent)}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="flex-1 py-2 rounded-lg border border-current text-xs font-semibold opacity-70 hover:opacity-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110 active:scale-[0.98]"
            >
              Confirmar registro
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
