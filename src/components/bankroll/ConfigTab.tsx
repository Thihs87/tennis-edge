'use client';

import { useState } from 'react';
import { formatBRL, DEFAULT_CONFIDENCE_MAP } from '@/services/bankroll';
import { saveConfig } from '@/lib/bankroll-storage';
import type { BankrollConfig } from '@/types/bankroll';

interface Props {
  config: BankrollConfig;
  onSaved: (next: BankrollConfig) => void;
}

export function ConfigTab({ config, onSaved }: Props) {
  const [username, setUsername]       = useState(config.username ?? '');
  const [bankroll, setBankroll]       = useState(String(config.bankroll));
  const [unitPercent, setUnitPercent] = useState(String(config.unitPercent * 100));
  const [maxUnits, setMaxUnits]       = useState(String(config.maxUnits));
  const [confidenceMap, setConfidenceMap] = useState(config.confidenceMap);
  const [savedMsg, setSavedMsg]       = useState('');

  const bankrollNum = parseFloat(bankroll) || 0;
  const unitPctNum  = (parseFloat(unitPercent) || 0) / 100;
  const maxUnitsNum = Math.max(1, parseInt(maxUnits, 10) || 0);
  const unitVal     = bankrollNum * unitPctNum;
  const isValid     = bankrollNum > 0 && unitPctNum > 0 && unitPctNum <= 0.10 && maxUnitsNum >= 1;

  function handleMapChange(idx: number, field: 'minConfidence' | 'units', raw: string) {
    const num = parseFloat(raw);
    if (isNaN(num)) return;
    setConfidenceMap(map =>
      map.map((tier, i) =>
        i === idx
          ? { ...tier, [field]: field === 'minConfidence' ? num / 100 : num }
          : tier
      )
    );
  }

  function handleResetMap() {
    setConfidenceMap(DEFAULT_CONFIDENCE_MAP);
  }

  function handleSave() {
    if (!isValid) return;
    const next: BankrollConfig = {
      username: username.trim() || undefined,
      bankroll: bankrollNum,
      unitPercent: unitPctNum,
      maxUnits: maxUnitsNum,
      confidenceMap: [...confidenceMap].sort((a, b) => a.minConfidence - b.minConfidence),
      updatedAt: new Date().toISOString(),
    };
    saveConfig(next);
    onSaved(next);
    setSavedMsg('Configurações salvas.');
    setTimeout(() => setSavedMsg(''), 2500);
  }

  return (
    <div className="space-y-5">
      {/* Identificação */}
      <div className="rounded-2xl border bg-card p-5 space-y-3 shadow-elevated">
        <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Identificação</p>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Nome do usuário <span className="font-normal opacity-60">(opcional, ajuda a separar histórico quando alguém compartilha)</span>
          </label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Ex: Thiago"
            className="w-full px-4 py-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      {/* Banca */}
      <div className="rounded-2xl border bg-card p-5 space-y-3 shadow-elevated">
        <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Sua banca</p>

        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Banca atual (R$)</label>
          <input
            type="number" inputMode="decimal" step="50" min="0"
            value={bankroll}
            onChange={e => setBankroll(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">% por unidade</label>
            <div className="relative">
              <input
                type="number" inputMode="decimal" step="0.25" min="0.25" max="10"
                value={unitPercent}
                onChange={e => setUnitPercent(e.target.value)}
                className="w-full px-4 py-3 pr-8 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Cap (máx. unidades)</label>
            <input
              type="number" inputMode="numeric" step="1" min="1" max="20"
              value={maxUnits}
              onChange={e => setMaxUnits(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3">
          <p className="text-xs text-muted-foreground">Sua unidade vale</p>
          <p className="text-2xl font-bold tabular-nums text-primary">{formatBRL(unitVal)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Cap de {maxUnitsNum}u = {formatBRL(unitVal * maxUnitsNum)} por aposta no máximo.
          </p>
        </div>
      </div>

      {/* Tabela de confiança → unidades */}
      <div className="rounded-2xl border bg-card p-5 space-y-3 shadow-elevated">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Mapa de confiança → unidades</p>
            <p className="text-xs text-muted-foreground mt-1">Quantas unidades apostar baseado na confiança do modelo.</p>
          </div>
          <button
            type="button"
            onClick={handleResetMap}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ↻ Padrão
          </button>
        </div>

        <div className="space-y-2">
          {confidenceMap.map((tier, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">se confiança ≥</span>
              <input
                type="number" inputMode="decimal" step="1" min="50" max="100"
                value={Math.round(tier.minConfidence * 100)}
                onChange={e => handleMapChange(i, 'minConfidence', e.target.value)}
                className="w-16 px-2 py-1.5 rounded-lg border bg-background text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <span className="text-muted-foreground">% →</span>
              <input
                type="number" inputMode="numeric" step="0.5" min="0.5" max="20"
                value={tier.units}
                onChange={e => handleMapChange(i, 'units', e.target.value)}
                className="w-16 px-2 py-1.5 rounded-lg border bg-background text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <span className="text-muted-foreground">unidades</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground italic">
          Confiança abaixo do menor valor da tabela = não recomenda apostar.
        </p>
      </div>

      {/* Botão salvar */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!isValid}
          className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] enabled:glow-primary"
        >
          Salvar configurações
        </button>
        {!isValid && (
          <p className="text-xs text-rose-600 dark:text-rose-400 text-center">
            Banca deve ser maior que zero e % unidade entre 0,25% e 10%.
          </p>
        )}
        {savedMsg && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 text-center">{savedMsg}</p>
        )}
      </div>
    </div>
  );
}
