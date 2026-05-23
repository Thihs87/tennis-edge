import type { OddEdge } from '@/services/model';

interface Props {
  edge: OddEdge;
  compact?: boolean;
}

export const EDGE_CONFIG: Record<OddEdge, {
  emoji: string;
  label: string;
  sublabel: string;
  cardClass: string;
  textClass: string;
  dotClass: string;
}> = {
  value: {
    emoji: '🟢',
    label: 'APOSTAR',
    sublabel: 'A odd está acima do que o modelo espera. Pode valer a pena.',
    cardClass: 'bg-gradient-to-br from-emerald-500/15 via-emerald-500/10 to-transparent border-emerald-500/40',
    textClass: 'text-emerald-600 dark:text-emerald-400',
    dotClass: 'bg-emerald-500',
  },
  fair: {
    emoji: '🟡',
    label: 'AVALIAR',
    sublabel: 'A odd está alinhada com o modelo. Sem grande vantagem.',
    cardClass: 'bg-gradient-to-br from-amber-500/15 via-amber-500/10 to-transparent border-amber-500/40',
    textClass: 'text-amber-600 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  no_value: {
    emoji: '🔴',
    label: 'EVITAR',
    sublabel: 'A casa está mais confiante que o modelo. Não compensa apostar.',
    cardClass: 'bg-gradient-to-br from-rose-500/15 via-rose-500/10 to-transparent border-rose-500/40',
    textClass: 'text-rose-600 dark:text-rose-400',
    dotClass: 'bg-rose-500',
  },
  unavailable: {
    emoji: '📊',
    label: 'SEM ODD',
    sublabel: 'Sugestão baseada só em dados históricos, sem comparação com a casa.',
    cardClass: 'bg-muted/40 border-border',
    textClass: 'text-muted-foreground',
    dotClass: 'bg-muted-foreground',
  },
};

export function EdgeBadge({ edge, compact }: Props) {
  const cfg = EDGE_CONFIG[edge];

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full text-xs font-semibold px-2.5 py-1 border ${cfg.cardClass} ${cfg.textClass}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
        {cfg.label}
      </span>
    );
  }

  return (
    <div className={`rounded-2xl border px-4 py-3.5 flex items-center gap-3.5 ${cfg.cardClass}`}>
      <span className="text-2xl shrink-0">{cfg.emoji}</span>
      <div className="min-w-0">
        <p className={`font-bold text-sm tracking-wider ${cfg.textClass}`}>{cfg.label}</p>
        <p className="text-xs text-muted-foreground leading-snug mt-0.5">{cfg.sublabel}</p>
      </div>
    </div>
  );
}
