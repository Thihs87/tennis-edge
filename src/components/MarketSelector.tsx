'use client';

import type { Market } from '@/services/model';

const MARKETS: { value: Market; label: string; desc: string; icon: string }[] = [
  { value: 'moneyline',   label: 'Resultado',      desc: 'Quem vence a partida',     icon: '🏆' },
  { value: 'total_games', label: 'Total de games', desc: 'Over/Under de games',       icon: '🎯' },
  { value: 'total_aces',  label: 'Total de aces',  desc: 'Over/Under de aces',        icon: '⚡' },
];

interface Props {
  selected: Market;
  onChange: (m: Market) => void;
  loading?: boolean;
}

export function MarketSelector({ selected, onChange, loading }: Props) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {MARKETS.map(m => (
        <button
          key={m.value}
          onClick={() => onChange(m.value)}
          disabled={loading}
          className={`rounded-xl border p-3 text-left transition-all disabled:opacity-50 ${
            selected === m.value
              ? 'border-primary bg-primary/10 ring-1 ring-primary'
              : 'border-border bg-card hover:bg-accent/50'
          }`}
        >
          <div className="text-lg mb-1">{m.icon}</div>
          <div className="text-xs font-semibold">{m.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5 hidden sm:block">{m.desc}</div>
        </button>
      ))}
    </div>
  );
}
