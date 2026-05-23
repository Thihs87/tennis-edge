interface Props {
  surface: string;
  small?: boolean;
}

const CONFIG: Record<string, { label: string; className: string; dot: string }> = {
  Clay:   { label: 'Saibro',  className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',  dot: 'bg-amber-500'  },
  Hard:   { label: 'Duro',    className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20',          dot: 'bg-sky-500'    },
  Grass:  { label: 'Grama',   className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-500' },
  Carpet: { label: 'Carpete', className: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20', dot: 'bg-purple-500' },
};

export function SurfaceBadge({ surface, small }: Props) {
  const cfg = CONFIG[surface] ?? { label: surface, className: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium border ${small ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1'} ${cfg.className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
