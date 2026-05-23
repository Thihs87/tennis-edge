'use client';

import type { OngoingMatch } from '@/types/tennis';

export interface Filters {
  date: string;       // 'all' | 'YYYY-MM-DD'
  tourney: string;    // 'all' | tournament name
}

function parseDate(scheduledTime?: string): string | null {
  if (!scheduledTime) return null;
  // scheduledTime examples: "Hoje 19:00", "Amanhã 12:00", "sáb. 17/05 14:00"
  // We store the raw label prefix as the date key
  const parts = scheduledTime.split(' ');
  if (parts[0] === 'Hoje') return 'Hoje';
  if (parts[0] === 'Amanhã') return 'Amanhã';
  // "sáb. 17/05 14:00" → "sáb. 17/05"
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

export function buildFilters(matches: OngoingMatch[]) {
  const dates = new Set<string>();
  const tourneys = new Set<string>();

  for (const m of matches) {
    const d = parseDate(m.scheduledTime);
    if (d) dates.add(d);
    if (m.tourneyName) tourneys.add(m.tourneyName);
  }

  // Sort dates: Hoje → Amanhã → rest
  const dateOrder = ['Hoje', 'Amanhã'];
  const sortedDates = [
    ...dateOrder.filter(d => dates.has(d)),
    ...Array.from(dates).filter(d => !dateOrder.includes(d)).sort(),
  ];

  return {
    dates: sortedDates,
    tourneys: Array.from(tourneys).sort(),
  };
}

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  dates: string[];
  tourneys: string[];
}

function Pill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-accent'
      }`}
    >
      {label}
    </button>
  );
}

export function FilterBar({ filters, onChange, dates, tourneys }: Props) {
  if (dates.length === 0 && tourneys.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Datas */}
      {dates.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <Pill
            label="Todas as datas"
            active={filters.date === 'all'}
            onClick={() => onChange({ ...filters, date: 'all' })}
          />
          {dates.map(d => (
            <Pill
              key={d}
              label={d}
              active={filters.date === d}
              onClick={() => onChange({ ...filters, date: d })}
            />
          ))}
        </div>
      )}

      {/* Torneios */}
      {tourneys.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <Pill
            label="Todos os torneios"
            active={filters.tourney === 'all'}
            onClick={() => onChange({ ...filters, tourney: 'all' })}
          />
          {tourneys.map(t => (
            <Pill
              key={t}
              label={t}
              active={filters.tourney === t}
              onClick={() => onChange({ ...filters, tourney: t })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
