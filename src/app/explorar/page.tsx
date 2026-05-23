'use client';

import { useEffect, useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { FilterBar, buildFilters, type Filters } from '@/components/FilterBar';
import { MatchCard } from '@/components/MatchCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { OngoingMatch } from '@/types/tennis';
import type { MatchPreview } from '@/services/model';

const AUTO_REFRESH_MS = 60 * 60 * 1000;

function parseDate(scheduledTime?: string): string | null {
  if (!scheduledTime) return null;
  const parts = scheduledTime.split(' ');
  if (parts[0] === 'Hoje') return 'Hoje';
  if (parts[0] === 'Amanhã') return 'Amanhã';
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

function applyFilters(matches: OngoingMatch[], filters: Filters, search: string): OngoingMatch[] {
  let result = matches;
  if (filters.date !== 'all') result = result.filter(m => parseDate(m.scheduledTime) === filters.date);
  if (filters.tourney !== 'all') result = result.filter(m => m.tourneyName === filters.tourney);
  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter(m => m.player1.toLowerCase().includes(q) || m.player2.toLowerCase().includes(q));
  }
  return result;
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

export default function ExplorarPage() {
  const [matches, setMatches]       = useState<OngoingMatch[]>([]);
  const [previews, setPreviews]     = useState<Map<string, MatchPreview>>(new Map());
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

      const loaded: OngoingMatch[] = json.matches ?? [];
      setMatches(loaded);
      setLastUpdate(formatTime(json.fetchedAt));

      if (loaded.length > 0) {
        fetch('/api/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(loaded.map(m => ({ player1: m.player1, player2: m.player2, surface: m.surface }))),
        })
          .then(r => r.json())
          .then((data: MatchPreview[]) => {
            const map = new Map<string, MatchPreview>();
            data.forEach(p => map.set(`${p.player1}|${p.player2}`, p));
            setPreviews(map);
          })
          .catch(() => {});
      }
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
          <h1 className="text-2xl font-bold tracking-tight">Partidas disponíveis</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ATP e WTA · Próximos 7 dias · Odds via Betano BR
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

        {/* Destaques do modelo */}
        {!loading && previews.size > 0 && (() => {
          const featured = matches
            .map(m => ({ match: m, preview: previews.get(`${m.player1}|${m.player2}`) }))
            .filter(({ preview }) => preview && preview.confidence >= 0.65)
            .slice(0, 3);

          if (featured.length === 0) return null;

          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Destaques do modelo</span>
                <span className="text-xs text-muted-foreground">· confiança ≥ 65% · sem verificação de odd</span>
              </div>
              <div className="space-y-2">
                {featured.map(({ match, preview }) => (
                  <MatchCard key={`featured-${match.id}`} match={match} preview={preview} featured />
                ))}
              </div>
            </div>
          );
        })()}

        {/* Filtros dinâmicos */}
        {!loading && matches.length > 0 && (
          <FilterBar filters={filters} onChange={setFilters} dates={dates} tourneys={tourneys} />
        )}

        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[100px] w-full rounded-xl" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="rounded-xl border bg-card p-8 text-center space-y-2">
            <p className="text-2xl">🎾</p>
            <p className="font-medium">Nenhuma partida encontrada</p>
            <p className="text-sm text-muted-foreground">
              {search.trim()
                ? `Nenhuma partida com "${search}". Tente outro nome.`
                : matches.length === 0
                  ? 'A Betano BR ainda não abriu odds para os próximos dias. Tente atualizar.'
                  : 'Nenhuma partida corresponde aos filtros selecionados.'}
            </p>
          </div>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="space-y-3">
            {visible.map(match => (
              <MatchCard
                key={match.id}
                match={match}
                preview={previews.get(`${match.player1}|${match.player2}`)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
