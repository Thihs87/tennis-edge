'use client';

import { Suspense, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { PlayerInput } from '@/components/PlayerInput';
import { SurfaceBadge } from '@/components/SurfaceBadge';
import { EdgeBadge } from '@/components/EdgeBadge';
import { ConfidenceBar } from '@/components/ConfidenceBar';
import { PlayerStatsSection } from '@/components/PlayerStatsSection';
import { PlayerContextCard } from '@/components/PlayerContextCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { Market, ModelResult } from '@/services/model';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface SimResult {
  result: ModelResult;
  justification: string;
  fetchedAt: string;
}

interface BestBetsResult {
  results: ModelResult[];
  total: number;
  shown: number;
  fetchedAt: string;
}

type Mode = 'best' | 'specific';

const MARKET_NAMES: Record<Market, string> = {
  moneyline:   'Vencedor da partida',
  first_set:   'Vencedor do 1º set',
  total_sets:  'Total de sets',
  total_games: 'Total de games',
  total_aces:  'Total de aces',
  total_dfs:   'Duplas faltas',
};

// ─── Constantes UI ───────────────────────────────────────────────────────────

const SURFACES: { value: string; label: string }[] = [
  { value: 'Hard', label: 'Duro' },
  { value: 'Clay', label: 'Saibro' },
  { value: 'Grass', label: 'Grama' },
];

const MARKETS: { value: Market; label: string; description: string }[] = [
  { value: 'moneyline',   label: 'Vencedor da partida',   description: 'Qual jogador vai ganhar?' },
  { value: 'first_set',   label: 'Vencedor do 1º set',    description: 'Quem vai ganhar o primeiro set?' },
  { value: 'total_sets',  label: 'Total de sets',          description: 'A partida vai ter mais ou menos sets do que a linha?' },
  { value: 'total_games', label: 'Total de games',         description: 'A partida terá mais ou menos games do que a linha?' },
  { value: 'total_aces',  label: 'Total de aces',          description: 'Um jogador fará mais ou menos aces do que a linha?' },
  { value: 'total_dfs',   label: 'Duplas faltas',          description: 'Um jogador cometerá mais ou menos duplas faltas?' },
];

const ROUNDS = ['', '1ª rodada', '2ª rodada', '3ª rodada', 'Oitavas', 'Quartas', 'Semifinal', 'Final'];

const GRAND_SLAMS = ['australian open', 'roland garros', 'wimbledon', 'us open', 'roland-garros'];

function detectBestOf(tourney: string): 3 | 5 {
  const lower = tourney.toLowerCase();
  return GRAND_SLAMS.some(gs => lower.includes(gs)) ? 5 : 3;
}

// ─── Componente principal ────────────────────────────────────────────────────

function SimulatorContent() {
  // Lê query params da URL (vindos do /explorar quando o usuário clica num card)
  const searchParams = useSearchParams();
  const initialP1      = searchParams.get('p1') ?? '';
  const initialP2      = searchParams.get('p2') ?? '';
  const initialSurface = searchParams.get('surface') ?? 'Hard';
  const initialTourney = searchParams.get('tourney') ?? '';
  const initialRound   = searchParams.get('round') ?? '';

  // Modo: melhores apostas (padrão) ou análise específica de um mercado
  const [mode, setMode] = useState<Mode>('best');

  // Formulário (com valores iniciais vindos da URL, se houver)
  const [p1, setP1]             = useState(initialP1);
  const [p2, setP2]             = useState(initialP2);
  const [surface, setSurface]   = useState(initialSurface);
  const [tourney, setTourney]   = useState(initialTourney);
  const [round, setRound]       = useState(initialRound);
  const [market, setMarket]     = useState<Market>('moneyline');
  const [line, setLine]         = useState('');
  const [odd, setOdd]           = useState('');
  const [context, setContext]   = useState('');

  // Estado
  // Contexto da odd
  const [oddPlayer, setOddPlayer]     = useState<'p1' | 'p2'>('p1');       // moneyline
  const [oddDir, setOddDir]           = useState<'over' | 'under'>('over'); // games / aces
  const [acesPlayer, setAcesPlayer]   = useState<'p1' | 'p2'>('p1');       // aces

  // Estado
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [result, setResult]     = useState<SimResult | null>(null);
  const [bestBets, setBestBets] = useState<BestBetsResult | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);

  const needsLine = market === 'total_games' || market === 'total_aces' || market === 'total_sets' || market === 'total_dfs';
  const needsPlayer = market === 'total_aces' || market === 'total_dfs';
  const isMoneylineType = market === 'moneyline' || market === 'first_set'; // odd é para um jogador
  const bestOf = detectBestOf(tourney);

  // Rótulos dos jogadores (usa último nome se disponível)
  const p1Label = p1.trim() ? p1.trim().split(' ').pop()! : 'Jogador 1';
  const p2Label = p2.trim() ? p2.trim().split(' ').pop()! : 'Jogador 2';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!p1.trim() || !p2.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);
    setBestBets(null);

    try {
      if (mode === 'best') {
        // Modo melhores apostas: roda todos os mercados
        const body = {
          p1: p1.trim(),
          p2: p2.trim(),
          surface,
          bestOf,
          context: context.trim() || undefined,
        };
        const res  = await fetch('/api/best-bets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Erro desconhecido');
        setBestBets(json);
      } else {
        // Modo análise específica: roda um mercado só com odd opcional
        const body = {
          p1: p1.trim(),
          p2: p2.trim(),
          surface,
          market,
          bestOf,
          line:       line ? parseFloat(line) : undefined,
          odd:        odd  ? parseFloat(odd)  : undefined,
          oddPlayer:  (market === 'moneyline' || market === 'first_set') ? oddPlayer  : undefined,
          oddDir:     (market !== 'moneyline' && market !== 'first_set') ? oddDir : undefined,
          acesPlayer: (market === 'total_aces' || market === 'total_dfs') ? acesPlayer : undefined,
          context:    context.trim() || undefined,
        };
        const res  = await fetch('/api/simulator', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Erro desconhecido');
        setResult(json);
      }

      // Scroll para os resultados no mobile
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Falha na análise');
    } finally {
      setLoading(false);
    }
  }

  // Permite que, ao clicar em "Analisar com odd" num card de melhor aposta,
  // o modo mude para "específico" com o mercado pré-selecionado
  function analyzeWithOdd(r: ModelResult) {
    setMode('specific');
    setMarket(r.market);
    setResult(null);
    setBestBets(null);
    // Pré-seleciona o jogador certo para aces/DFs com base no que o modelo sugeriu
    if (r.market === 'total_aces' || r.market === 'total_dfs') {
      // Detecta qual jogador foi sugerido olhando a sugestão
      const isP1 = r.suggestion.startsWith(p1.trim().split(' ').pop()!);
      setAcesPlayer(isP1 ? 'p1' : 'p2');
    }
    // Pré-seleciona direção Over/Under
    if (r.suggestion.toLowerCase().includes('under')) setOddDir('under');
    else setOddDir('over');
    // Pré-preenche a linha sugerida pelo modelo (para games/sets/aces/DFs)
    const lineMatch = r.suggestion.match(/(\d+\.?\d*)/);
    if (lineMatch && r.market !== 'moneyline' && r.market !== 'first_set') {
      setLine(lineMatch[1]);
    }
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  }

  const r = result?.result;

  return (
    <div className="min-h-screen">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}>
        {/* Cabeçalho da página */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Simular partida</h1>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Previsão baseada em dados históricos. Informe os jogadores e o que deseja analisar.
          </p>
        </div>

        {/* Seletor de modo — segmented control premium */}
        <div className="rounded-2xl border bg-card p-1.5 flex gap-1 shadow-elevated">
          {([
            { value: 'best',     label: 'Melhores apostas', sub: 'Analisa todos os mercados' },
            { value: 'specific', label: 'Aposta específica', sub: 'Você escolhe e informa a odd' },
          ] as { value: Mode; label: string; sub: string }[]).map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => { setMode(m.value); setResult(null); setBestBets(null); setError(''); }}
              disabled={loading}
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

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Jogadores */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PlayerInput
              label="Jogador 1"
              value={p1}
              onChange={setP1}
              placeholder="Ex: Carlos Alcaraz"
              disabled={loading}
            />
            <PlayerInput
              label="Jogador 2"
              value={p2}
              onChange={setP2}
              placeholder="Ex: Jannik Sinner"
              disabled={loading}
            />
          </div>

          {/* Superfície */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Superfície</p>
            <div className="flex gap-2">
              {SURFACES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSurface(s.value)}
                  disabled={loading}
                  className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    surface === s.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Torneio + Rodada (opcionais) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <PlayerInput
                label={`Torneio (opcional)`}
                value={tourney}
                onChange={setTourney}
                placeholder="Ex: Hamburg"
                disabled={loading}
                searchEndpoint="/api/tournaments"
              />
              {tourney && (
                <p className="text-xs text-muted-foreground mt-1 pl-1">
                  Melhor de {bestOf} sets detectado
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Rodada <span className="font-normal opacity-60">(opcional)</span>
              </label>
              <select
                value={round}
                onChange={e => setRound(e.target.value)}
                disabled={loading}
                className="w-full px-4 py-3 rounded-xl border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
              >
                {ROUNDS.map(r => (
                  <option key={r} value={r}>{r || 'Não informada'}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Mercado + Linha + Odd — só no modo "específico" */}
          {mode === 'specific' && (<>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Tipo de aposta</p>
            <div className="space-y-2">
              {MARKETS.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMarket(m.value)}
                  disabled={loading}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                    market === m.value
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card hover:bg-accent'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    market === m.value ? 'border-primary' : 'border-muted-foreground'
                  }`}>
                    {market === m.value && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${market === m.value ? 'text-primary' : ''}`}>
                      {m.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{m.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Linha + Odd (contextual por mercado) */}
          <div className="rounded-xl border bg-card p-4 space-y-3">
            {/* Aces / DFs: escolhe o jogador */}
            {needsPlayer && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  {market === 'total_aces' ? 'Aces de qual jogador?' : 'Duplas faltas de qual jogador?'}
                </p>
                <div className="flex gap-2">
                  {(['p1', 'p2'] as const).map(side => (
                    <button key={side} type="button" disabled={loading}
                      onClick={() => setAcesPlayer(side)}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        acesPlayer === side
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {side === 'p1' ? p1Label : p2Label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Games + Aces: linha */}
            {needsLine && (
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                  Linha Over/Under <span className="font-normal opacity-60">(opcional. Se não preencher, o modelo sugere uma)</span>
                </label>
                <input
                  type="number" step="0.5" min="0"
                  inputMode="decimal"
                  value={line}
                  onChange={e => setLine(e.target.value)}
                  placeholder={
                    market === 'total_games' ? (bestOf === 5 ? 'ex: 38.5' : 'ex: 22.5') :
                    market === 'total_sets'  ? (bestOf === 5 ? 'ex: 3.5'  : 'ex: 2.5')  :
                    market === 'total_dfs'   ? 'ex: 5.5' : 'ex: 12.5'
                  }
                  disabled={loading}
                  className="w-full px-4 py-3 rounded-xl border bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                />
              </div>
            )}

            {/* Odd + para quem / qual direção — seletor sempre visível */}
            <div className="space-y-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  {isMoneylineType ? 'A odd que você tem é para a vitória de:' : 'A odd que você tem é para:'}
                </p>
                <div className="flex gap-2">
                  {isMoneylineType ? (
                    (['p1', 'p2'] as const).map(side => (
                      <button key={side} type="button" disabled={loading}
                        onClick={() => setOddPlayer(side)}
                        className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                          oddPlayer === side
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        {side === 'p1' ? p1Label : p2Label}
                      </button>
                    ))
                  ) : (
                    (['over', 'under'] as const).map(dir => (
                      <button key={dir} type="button" disabled={loading}
                        onClick={() => setOddDir(dir)}
                        className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                          oddDir === dir
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        {dir === 'over' ? 'Over (mais)' : 'Under (menos)'}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                  Odd da casa <span className="font-normal opacity-60">(opcional. Informe se quiser saber se há vantagem)</span>
                </label>
                <input
                  type="number" step="0.01" min="1.01"
                  inputMode="decimal"
                  value={odd}
                  onChange={e => setOdd(e.target.value)}
                  placeholder="ex: 1.85"
                  disabled={loading}
                  className="w-full px-4 py-3 rounded-xl border bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                />
              </div>
            </div>
          </div>
          </>)}

          {/* Contexto */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
              Contexto <span className="font-normal opacity-60">(opcional. Ex: lesão, cansaço, condição climática)</span>
            </label>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="Ex: Alcaraz reclamou de dor no pulso após o último jogo..."
              disabled={loading}
              rows={2}
              className="w-full px-4 py-3 rounded-xl border bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 resize-none"
            />
          </div>

          {/* Botão principal — CTA com glow */}
          <button
            type="submit"
            disabled={loading || !p1.trim() || !p2.trim()}
            className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-semibold text-base flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] enabled:glow-primary"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                Analisando...
              </>
            ) : (
              <>
                <span>🎾</span>
                {mode === 'best' ? 'Encontrar melhores apostas' : 'Analisar partida'}
              </>
            )}
          </button>
        </form>

        {/* Resultados */}
        <div ref={resultsRef}>
          {/* Skeleton de loading */}
          {loading && (
            <div className="space-y-3 pt-2">
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          )}

          {/* Erro */}
          {!loading && error && (
            <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 space-y-2">
              <p className="text-sm font-medium text-destructive">Falha na análise</p>
              <p className="text-xs text-destructive/80">{error}</p>
            </div>
          )}

          {/* Resultados — modo "melhores apostas" */}
          {!loading && bestBets && (
            <div className="space-y-4 animate-stagger">
              <div className="flex items-center gap-3 pt-2">
                <div className="h-px flex-1 bg-border" />
                <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-widest">Melhores apostas</p>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold">
                  {p1} <span className="font-normal text-muted-foreground">vs</span> {p2}
                </h2>
                <SurfaceBadge surface={surface} />
              </div>

              {bestBets.results.length === 0 ? (
                <div className="rounded-xl border bg-card p-6 text-center space-y-2">
                  <p className="text-2xl">🤷</p>
                  <p className="font-medium text-sm">Nenhuma aposta com confiança alta</p>
                  <p className="text-xs text-muted-foreground">
                    Os dois jogadores estão muito parelhos nos dados. Não há oportunidade clara.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Mostrando {bestBets.shown} mercado{bestBets.shown !== 1 ? 's' : ''} com confiança acima de 55%, em ordem da maior para a menor.
                  </p>
                  {bestBets.results.map((r, idx) => {
                    const medals = ['🥇', '🥈', '🥉'];
                    const medal = idx < 3 ? medals[idx] : `${idx + 1}.`;
                    const confColor =
                      r.confidence >= 0.70 ? 'text-emerald-600 dark:text-emerald-400' :
                      r.confidence >= 0.60 ? 'text-amber-600 dark:text-amber-400' :
                      'text-muted-foreground';
                    const isTop = idx === 0;
                    return (
                      <div
                        key={r.market}
                        className={`rounded-2xl border bg-card p-4 space-y-2.5 transition-all hover:shadow-elevated ${
                          isTop ? 'border-gradient' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-widest">
                              {medal} {MARKET_NAMES[r.market]}
                            </p>
                            <p className="text-base font-bold mt-1 leading-tight">{r.suggestion}</p>
                          </div>
                          <div className={`text-3xl font-bold tabular-nums leading-none ${confColor}`}>
                            {Math.round(r.confidence * 100)}<span className="text-base">%</span>
                          </div>
                        </div>

                        {r.reasoning && (
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {r.reasoning}
                          </p>
                        )}

                        <button
                          type="button"
                          onClick={() => analyzeWithOdd(r)}
                          className="w-full mt-1 py-2 rounded-xl border text-xs font-semibold text-primary hover:bg-primary/10 active:scale-[0.98] transition-all"
                        >
                          Analisar com a odd da casa →
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Stats dos jogadores no fim */}
              {bestBets.results[0] && (
                <PlayerStatsSection
                  stats1={bestBets.results[0].support.player1Stats}
                  stats2={bestBets.results[0].support.player2Stats}
                  h2h={bestBets.results[0].support.h2h}
                />
              )}

              {/* Contexto recente via web search */}
              <PlayerContextCard key={`bb-${p1}-${p2}`} p1={p1.trim()} p2={p2.trim()} />

              <button
                type="button"
                onClick={() => { setBestBets(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="w-full py-3 rounded-xl border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Nova análise
              </button>
            </div>
          )}

          {/* Resultado — modo "análise específica" */}
          {!loading && r && (
            <div className="space-y-4 animate-stagger">
              {/* Divisor */}
              <div className="flex items-center gap-3 pt-2">
                <div className="h-px flex-1 bg-border" />
                <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-widest">Análise</p>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Partida */}
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold">
                  {r.player1} <span className="font-normal text-muted-foreground">vs</span> {r.player2}
                </h2>
                <SurfaceBadge surface={r.surface} />
                {tourney && (
                  <span className="text-xs text-muted-foreground">
                    {[tourney, round].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>

              {/* Edge badge */}
              <EdgeBadge edge={r.edge} />

              {/* Card principal — hero */}
              <div className="rounded-2xl border bg-card p-5 space-y-4 shadow-elevated">
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold mb-1.5">Sugestão</p>
                  <p className="text-2xl font-bold tracking-tight leading-tight">{r.suggestion}</p>
                  {r.reasoning && (
                    <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                      {r.reasoning}
                    </p>
                  )}
                </div>

                <ConfidenceBar value={r.confidence} />

                {r.oddValue && (
                  <div className="pt-3 border-t space-y-2">
                    <div className="flex items-baseline gap-3">
                      <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Sua odd</span>
                      <span className="font-mono font-bold text-xl">{r.oddValue.toFixed(2)}</span>
                    </div>

                    {r.impliedProbability != null && (() => {
                      const casa  = Math.round(r.impliedProbability! * 100);
                      const model = Math.round(r.modelProbability * 100);
                      const diff  = model - casa;

                      let explanation = '';
                      let tone = 'text-muted-foreground';

                      if (diff > 5) {
                        explanation = `O modelo acha essa aposta mais provável (${model}%) do que a casa precifica (${casa}%). Há vantagem para você.`;
                        tone = 'text-green-600 dark:text-green-400';
                      } else if (diff < -5) {
                        explanation = `A casa está mais confiante (${casa}%) do que o modelo (${model}%). Não compensa apostar.`;
                        tone = 'text-red-600 dark:text-red-400';
                      } else {
                        explanation = `O modelo (${model}%) e a casa (${casa}%) estão alinhados. Odd justa, sem grande vantagem.`;
                        tone = 'text-yellow-600 dark:text-yellow-500';
                      }

                      return (
                        <p className={`text-xs leading-relaxed ${tone}`}>
                          {explanation}
                        </p>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Justificativa do Claude */}
              {result?.justification && (
                <div className="rounded-2xl border bg-card p-5">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold mb-2">Análise</p>
                  <p className="text-sm leading-relaxed">{result.justification}</p>
                </div>
              )}

              {/* Avisos */}
              {r.warnings.length > 0 && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                  {r.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700 dark:text-amber-400 flex gap-2 leading-relaxed">
                      <span className="shrink-0 mt-0.5">⚠️</span>
                      <span>{w}</span>
                    </p>
                  ))}
                </div>
              )}

              {/* Stats */}
              <PlayerStatsSection
                stats1={r.support.player1Stats}
                stats2={r.support.player2Stats}
                h2h={r.support.h2h}
              />

              {/* Contexto recente via web search */}
              <PlayerContextCard key={`sp-${p1}-${p2}-${r.market}`} p1={p1.trim()} p2={p2.trim()} />

              {/* Nova análise */}
              <button
                type="button"
                onClick={() => { setResult(null); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="w-full py-3 rounded-xl border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Nova análise
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function SimulatorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <SimulatorContent />
    </Suspense>
  );
}
