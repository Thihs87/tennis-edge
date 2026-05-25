'use client';

import { useState } from 'react';
import { formatBRL } from '@/services/bankroll';
import { addBet } from '@/lib/bankroll-storage';
import type { BankrollConfig, BetLeg } from '@/types/bankroll';

interface Props {
  config: BankrollConfig;
  onRegistered: () => void;
}

type Mode = 'single' | 'multi';

export function RegisterTab({ config, onRegistered }: Props) {
  const [mode, setMode] = useState<Mode>('single');
  // Campos comuns
  const [stakeUnits, setStakeUnits] = useState('1');
  const [savedMsg, setSavedMsg]     = useState('');
  // Simples
  const [player1, setPlayer1]       = useState('');
  const [player2, setPlayer2]       = useState('');
  const [tourney, setTourney]       = useState('');
  const [market, setMarket]         = useState('');
  const [odd, setOdd]               = useState('');
  // Múltipla
  const [legs, setLegs] = useState<Array<{ description: string; odd: string }>>([
    { description: '', odd: '' },
    { description: '', odd: '' },
  ]);

  const stakeUnitsNum = parseFloat(stakeUnits) || 0;
  const oddNum        = parseFloat(odd) || 0;
  const stakeAmount   = Math.round(stakeUnitsNum * config.bankroll * config.unitPercent * 100) / 100;
  const unitV         = config.bankroll * config.unitPercent;

  // Validação por modo
  const isValidSingle =
    !!player1.trim() && !!player2.trim() && !!market.trim() && oddNum > 1 && stakeUnitsNum > 0;

  const validLegs = legs
    .map(l => ({ description: l.description.trim(), odd: parseFloat(l.odd) || 0 }))
    .filter(l => l.description.length > 0 && l.odd > 1);

  const combinedOdd = validLegs.reduce((acc, l) => acc * l.odd, 1);
  const potentialReturn = combinedOdd > 1 ? stakeAmount * combinedOdd : 0;
  const isValidMulti  = validLegs.length >= 2 && stakeUnitsNum > 0;

  const isValid = mode === 'single' ? isValidSingle : isValidMulti;

  function addLeg() {
    setLegs(prev => [...prev, { description: '', odd: '' }]);
  }
  function removeLeg(idx: number) {
    setLegs(prev => prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev);
  }
  function updateLeg(idx: number, field: 'description' | 'odd', value: string) {
    setLegs(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    if (mode === 'single') {
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
    } else {
      const cleanedLegs: BetLeg[] = validLegs.map(l => ({
        description: l.description,
        odd: l.odd,
      }));
      addBet({
        username: config.username || undefined,
        player1: `Múltipla`,
        player2: `${cleanedLegs.length} seleções`,
        market: `Aposta múltipla (${cleanedLegs.length} pernas)`,
        odd: combinedOdd,
        stakeUnits: stakeUnitsNum,
        stakeAmount,
        legs: cleanedLegs,
        status: 'pending',
      });
    }

    setSavedMsg('Aposta registrada no histórico.');
    setTimeout(() => setSavedMsg(''), 2500);

    // Limpa campos da aposta (mantém modo e dados estruturais)
    if (mode === 'single') {
      setMarket('');
      setOdd('');
    } else {
      setLegs([{ description: '', odd: '' }, { description: '', odd: '' }]);
    }
    setStakeUnits('1');
    onRegistered();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Toggle Simples / Múltipla */}
      <div className="rounded-2xl border bg-card p-1.5 flex gap-1 shadow-elevated">
        {([
          { value: 'single', label: 'Simples',  sub: 'Uma única seleção' },
          { value: 'multi',  label: 'Múltipla', sub: '2+ seleções combinadas' },
        ] as { value: Mode; label: string; sub: string }[]).map(m => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-semibold transition-all text-left ${
              mode === m.value
                ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                : 'text-muted-foreground hover:bg-accent active:scale-[0.98]'
            }`}
          >
            <div>{m.label}</div>
            <div className={`text-[11px] font-normal mt-0.5 leading-tight ${mode === m.value ? 'opacity-80' : 'opacity-60'}`}>
              {m.sub}
            </div>
          </button>
        ))}
      </div>

      {/* MODO SIMPLES */}
      {mode === 'single' && (
        <>
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
                {' '}({stakeUnitsNum}u × {formatBRL(unitV)})
              </p>
            )}
          </div>
        </>
      )}

      {/* MODO MÚLTIPLA */}
      {mode === 'multi' && (
        <>
          <div className="rounded-2xl border bg-card p-5 space-y-3 shadow-elevated">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Seleções</p>
              <button
                type="button" onClick={addLeg}
                className="text-xs font-semibold text-primary hover:underline"
              >
                + Adicionar perna
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Cada perna é uma aposta. Na múltipla, você precisa acertar TODAS para ganhar. As odds se multiplicam.
            </p>

            <div className="space-y-3">
              {legs.map((leg, idx) => (
                <div key={idx} className="rounded-xl border bg-background/50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground">Perna {idx + 1}</p>
                    {legs.length > 2 && (
                      <button
                        type="button" onClick={() => removeLeg(idx)}
                        className="text-xs text-muted-foreground hover:text-destructive"
                        aria-label={`Remover perna ${idx + 1}`}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                  <input
                    type="text" value={leg.description}
                    onChange={e => updateLeg(idx, 'description', e.target.value)}
                    placeholder="Ex: Alcaraz vence vs Sinner (Roland Garros)"
                    className="w-full px-3 py-2.5 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground shrink-0">Odd:</label>
                    <input
                      type="number" inputMode="decimal" step="0.01" min="1.01"
                      value={leg.odd} onChange={e => updateLeg(idx, 'odd', e.target.value)}
                      placeholder="1.85"
                      className="flex-1 px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-w-[120px]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-5 space-y-3 shadow-elevated">
            <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Stake</p>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Unidades</label>
              <input
                type="number" inputMode="decimal" step="0.5" min="0.5"
                value={stakeUnits} onChange={e => setStakeUnits(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            {validLegs.length >= 2 && stakeAmount > 0 && (
              <div className="space-y-1 pt-1 text-xs">
                <p className="text-muted-foreground">
                  Odd combinada: <span className="font-mono font-bold text-foreground tabular-nums">{combinedOdd.toFixed(2)}</span>
                  {' '}({validLegs.map(l => l.odd.toFixed(2)).join(' × ')})
                </p>
                <p className="text-muted-foreground">
                  Valor apostado: <span className="font-mono font-bold text-foreground">{formatBRL(stakeAmount)}</span>
                  {' '}({stakeUnitsNum}u)
                </p>
                <p className="text-emerald-600 dark:text-emerald-400">
                  Retorno potencial: <span className="font-mono font-bold">{formatBRL(potentialReturn)}</span>
                  {' '}(lucro {formatBRL(potentialReturn - stakeAmount)})
                </p>
              </div>
            )}
            {validLegs.length < 2 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠️ Múltipla precisa de pelo menos 2 seleções válidas (descrição + odd &gt; 1.01).
              </p>
            )}
          </div>
        </>
      )}

      <button
        type="submit"
        disabled={!isValid}
        className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] enabled:glow-primary"
      >
        Registrar {mode === 'multi' ? 'múltipla' : 'aposta'}
      </button>

      {savedMsg && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 text-center">{savedMsg}</p>
      )}
    </form>
  );
}
