'use client';

import { useEffect, useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { FilterBar, buildFilters, type Filters } from '@/components/FilterBar';
import { MatchCard } from '@/components/MatchCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { OngoingMatch } from '@/types/tennis';

const AUTO_REFRESH_MS = 60 * 60 * 1000;

function parseDate(scheduledTime?: string): string | null {
  if (!scheduledTime) return null;
  const parts = scheduledTime.split(' ');
  if (parts[0] === 'Hoje')   return 'Hoje';
  if (parts[0] === 'Amanhã') return 'Amanhã';
  if (parts.length >= 2)     return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

function applyFilters(matches: OngoingMatch[], filters: Filters, search: string): OngoingMatch[] {
  let result = matches;
  if (filters.date    !== 'all') result = result.filter(m => parseDate(m.scheduledTime) === filters.date);
  if (filters.tourney !== 'all') result = result.filter(m => m.tourneyName === filters.tourney);
  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter(m =>
      m.player1.toLowerCase().includes(q) ||
      m.player2.toLowerCase().includes(q)
    );
  }
  return result;
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

export default function ExplorarPage() {
  const [matches, setMatches]       = useState<OngoingMatch[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState('');
  const [filters, setFilters]       = useState<Filters>({ date: 'all', tourney: 'all' });
  const [search, setSearch]         = useState('');
  const [error, setError]           = useState('');

  const loadMatches = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res  = await fetch(force ? '/api/matches?force=true' : '/api/matches');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro desconhecido');

      setMatches(json.matches ?? []);
      setLastUpdate(formatTime(json.fetchedAt));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar partidas');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadMatches();
    const id = setInterval(() => loadMatches(true), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadMatches]);

  const { dates, tourneys } = buildFilters(matches);
  const visible = applyFilters(matches, filters, search);

  return (
    <div className="min-h-screen">
      <Header
        lastUpdate={lastUpdate}
        onRefresh={() => loadMatches(true)}
        refreshing={refreshing}
      />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Partidas em cartaz</h1>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            ATP e WTA dos próximos dias. Toque numa partida para analisar.
          </p>
        </div>

        {/* Busca */}
        <div className="relative">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            type="text"
            placeholder="Buscar jogador..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>

        {/* Filtros */}
        {!loading && matches.length > 0 && (
          <FilterBar filters={filters} onChange={setFilters} dates={dates} tourneys={tourneys} />
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[110px] w-full rounded-2xl" />
            ))}
          </div>
        )}

        {/* Erro */}
        {!loading && error && (
          <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Lista vazia */}
        {!loading && !error && visible.length === 0 && (
          <div className="rounded-2xl border bg-card p-8 text-center space-y-2">
            <p className="text-2xl">🎾</p>
            <p className="font-medium">Nenhuma partida encontrada</p>
            <p className="text-sm text-muted-foreground">
              {search.trim()
                ? `Nenhuma partida com "${search}". Tente outro nome.`
                : matches.length === 0
                  ? 'Ainda não tem partidas dos próximos dias no calendário. Tente atualizar.'
                  : 'Nenhuma partida corresponde aos filtros selecionados.'}
            </p>
          </div>
        )}

        {/* Lista de partidas */}
        {!loading && !error && visible.length > 0 && (
          <div className="space-y-3">
            {visible.map(match => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
