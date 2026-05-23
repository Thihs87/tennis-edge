interface Props {
  value: number; // 0-1
  label?: string;
}

function getTone(pct: number) {
  if (pct >= 70) return {
    text: 'text-emerald-500 dark:text-emerald-400',
    bar:  'from-emerald-500 to-emerald-400',
  };
  if (pct >= 55) return {
    text: 'text-amber-500 dark:text-amber-400',
    bar:  'from-amber-500 to-amber-400',
  };
  return {
    text: 'text-rose-500 dark:text-rose-400',
    bar:  'from-rose-500 to-rose-400',
  };
}

export function ConfidenceBar({ value, label = 'Confiança' }: Props) {
  const pct  = Math.round(value * 100);
  const tone = getTone(pct);

  return (
    <div className="w-full">
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className={`text-2xl font-bold tabular-nums ${tone.text}`}>{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tone.bar} transition-all duration-700 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
