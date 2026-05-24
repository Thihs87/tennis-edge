'use client';

import { useState } from 'react';
import { formatBRL } from '@/services/bankroll';
import { addBet } from '@/lib/bankroll-storage';
import type { BankrollConfig } from '@/types/bankroll';

interface Props {
  config: BankrollConfig;
  onRegistered: () => void;
}

export function RegisterTab({ config, onRegistered }: Props) {
  const [player1, setPlayer1]       = useState('');
  const [player2, setPlayer2]       = useState('');
  const [tourney, setTourney]       = useState('');
  const [market, setMarket]         = useState('');
  const [odd, setOdd]               = useState('');
  const [stakeUnits, setStakeUnits] = useState('1');
  const [savedMsg, setSavedMsg]     = useState('');

  const stakeUnitsNum = parseFloat(stakeUnits) || 0;
  const oddNum        = parseFloat(odd) || 0;
  const stakeAmount   = Math.round(stakeUnitsNum * config.bankroll * config.unitPercent * 100) / 100;
  const isValid       = !!player1.trim() && !!player2.trim() && !!market.trim() && oddNum > 1 && stakeUnitsNum > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    addBet({
      username: config.username || undefined,
      player1: player1.trim(),
      player2: player2.trim(),
      tourneyName: tourney.trim() || undefined,
      market: market.trim(),
      odd: oddNum,
      stakeUnits: stakeUnitsNum,
      stakeAmount,
      status: 'pending',
    });
    setSavedMsg('Aposta registrada no histórico.');
    setTimeout(() => setSavedMsg(''), 2500);
    // Limpa só os campos da aposta, mantém jogadores se quiser registrar outra na mesma partida
    setMarket('');
    setOdd('');
    setStakeUnits('1');
    onRegistered();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-2xl border bg-card p-5 space-y-3 shadow-elevated">
        <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Partida</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Jogador 1</label>
            <input
              type="text" value={player1} onChange={e => setPlayer1(e.target.value)}
              placeholder="Ex: Carlos Alcaraz"
              className="w-full px-4 py-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Jogador 2</label>
            <input
              type="text" value={player2} onChange={e => setPlayer2(e.target.value)}
              placeholder="Ex: Jannik Sinner"
              className="w-full px-4 py-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Torneio <span className="font-normal opacity-60">(opcional)</span>
          </label>
          <input
            type="text" value={tourney} onChange={e => setTourney(e.target.value)}
            placeholder="Ex: Roland Garros"
            className="w-full px-4 py-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-5 space-y-3 shadow-elevated">
        <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Aposta</p>

        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Descrição da aposta <span className="font-normal opacity-60">(texto livre)</span>
          </label>
          <input
            type="text" value={market} onChange={e => setMarket(e.target.value)}
            placeholder="Ex: Alcaraz vence · Over 22.5 games · Sinner Over 8.5 aces"
            className="w-full px-4 py-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Odd</label>
            <input
              type="number" inputMode="decimal" step="0.01" min="1.01"
              value={odd} onChange={e => setOdd(e.target.value)}
              placeholder="ex: 1.85"
              className="w-full px-4 py-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Stake (unidades)</label>
            <input
              type="number" inputMode="decimal" step="0.5" min="0.5"
              value={stakeUnits} onChange={e => setStakeUnits(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        {stakeAmount > 0 && (
          <p className="text-xs text-muted-foreground">
            Valor da aposta: <span className="font-mono font-bold text-foreground">{formatBRL(stakeAmount)}</span>
            {' '}({stakeUnitsNum}u × {formatBRL(config.bankroll * config.unitPercent)})
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={!isValid}
        className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] enabled:glow-primary"
      >
        Registrar aposta
      </button>

      {savedMsg && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 text-center">{savedMsg}</p>
      )}
    </form>
  );
}
