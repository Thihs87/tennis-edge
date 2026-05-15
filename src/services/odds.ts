import axios, { AxiosError } from 'axios';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface OddsResult {
  available: boolean;
  player1: string;
  player2: string;
  player1Odd: number | null;   // odd decimal da Bet365 para o jogador 1 vencer
  player2Odd: number | null;   // odd decimal da Bet365 para o jogador 2 vencer
  overOdd: number | null;      // odd para over (total de games)
  underOdd: number | null;     // odd para under (total de games)
  overLine: number | null;     // linha do over/under (ex: 21.5)
  source: 'sportsdataapi' | 'odds-api.io' | 'none';
  fetchedAt: number;           // timestamp ms
  unavailableReason?: string;
}

export interface ImpliedProbability {
  player1: number | null; // 0-1
  player2: number | null; // 0-1
  overProb: number | null;
  underProb: number | null;
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

/** Converte odd decimal em probabilidade implícita (sem margem removida) */
export function getImpliedProbability(odd: number | null): number | null {
  if (!odd || odd <= 0) return null;
  return 1 / odd;
}

/** Extrai probabilidades implícitas de um OddsResult */
export function extractImpliedProbabilities(odds: OddsResult): ImpliedProbability {
  return {
    player1: getImpliedProbability(odds.player1Odd),
    player2: getImpliedProbability(odds.player2Odd),
    overProb: getImpliedProbability(odds.overOdd),
    underProb: getImpliedProbability(odds.underOdd),
  };
}

function normalizePlayerName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z\s]/g, '');
}

function nameSimilarity(a: string, b: string): boolean {
  const na = normalizePlayerName(a);
  const nb = normalizePlayerName(b);
  // Checa se os sobrenomes coincidem (última palavra do nome)
  const surnameA = na.split(' ').pop() ?? '';
  const surnameB = nb.split(' ').pop() ?? '';
  return surnameA === surnameB || na.includes(nb) || nb.includes(na);
}

function oddsUnavailable(
  player1: string,
  player2: string,
  reason: string
): OddsResult {
  return {
    available: false,
    player1,
    player2,
    player1Odd: null,
    player2Odd: null,
    overOdd: null,
    underOdd: null,
    overLine: null,
    source: 'none',
    fetchedAt: Date.now(),
    unavailableReason: reason,
  };
}

// ─── SportsDataAPI ───────────────────────────────────────────────────────────

interface SportsDataEvent {
  event_key?: string;
  event_name?: string;
  home_team?: string;
  away_team?: string;
  odds?: Array<{
    bookmaker_key?: string;
    bookmaker_name?: string;
    outcomes?: Array<{
      name?: string;
      odds?: number;
      handicap?: number;
    }>;
  }>;
}

async function fetchFromSportsDataAPI(
  player1: string,
  player2: string
): Promise<OddsResult | null> {
  const key = process.env.ODDS_API_KEY;
  if (!key) return null;

  try {
    const res = await axios.get<{ data?: SportsDataEvent[] }>(
      'https://api.sportsdataapi.com/v1/tennis/odds',
      {
        params: { apikey: key, bookmaker: 'bet365' },
        timeout: 10_000,
      }
    );

    const events: SportsDataEvent[] = res.data?.data ?? [];
    const match = events.find(e => {
      const home = e.home_team ?? '';
      const away = e.away_team ?? '';
      return (
        (nameSimilarity(home, player1) && nameSimilarity(away, player2)) ||
        (nameSimilarity(home, player2) && nameSimilarity(away, player1))
      );
    });

    if (!match) return null;

    const bet365 = match.odds?.find(
      b =>
        (b.bookmaker_key ?? '').toLowerCase().includes('bet365') ||
        (b.bookmaker_name ?? '').toLowerCase().includes('bet365')
    );
    if (!bet365?.outcomes) return null;

    const homeIsP1 = nameSimilarity(match.home_team ?? '', player1);
    const outcomes = bet365.outcomes;

    // Moneyline
    const homeWin = outcomes.find(o => (o.name ?? '').toLowerCase().includes('home') || nameSimilarity(o.name ?? '', match.home_team ?? ''));
    const awayWin = outcomes.find(o => (o.name ?? '').toLowerCase().includes('away') || nameSimilarity(o.name ?? '', match.away_team ?? ''));

    // Totais
    const over = outcomes.find(o => (o.name ?? '').toLowerCase() === 'over');
    const under = outcomes.find(o => (o.name ?? '').toLowerCase() === 'under');

    return {
      available: true,
      player1,
      player2,
      player1Odd: homeIsP1 ? (homeWin?.odds ?? null) : (awayWin?.odds ?? null),
      player2Odd: homeIsP1 ? (awayWin?.odds ?? null) : (homeWin?.odds ?? null),
      overOdd: over?.odds ?? null,
      underOdd: under?.odds ?? null,
      overLine: over?.handicap ?? null,
      source: 'sportsdataapi',
      fetchedAt: Date.now(),
    };
  } catch (err) {
    const e = err as AxiosError;
    console.warn('[Odds] SportsDataAPI erro:', e.response?.status ?? e.message);
    return null;
  }
}

// ─── odds-api.io (fallback) ──────────────────────────────────────────────────

interface OddsApiEvent {
  id?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: Array<{
    key?: string;
    title?: string;
    markets?: Array<{
      key?: string;
      outcomes?: Array<{
        name?: string;
        price?: number;
        point?: number;
      }>;
    }>;
  }>;
}

async function fetchFromOddsApiIo(
  player1: string,
  player2: string
): Promise<OddsResult | null> {
  const key = process.env.ODDS_API_KEY_ALT;
  if (!key) return null;

  try {
    const res = await axios.get<OddsApiEvent[]>(
      'https://api.odds-api.io/v3/odds',
      {
        params: {
          apiKey: key,
          sport: 'tennis',
          bookmakers: 'bet365',
          markets: 'h2h,totals',
        },
        timeout: 10_000,
      }
    );

    const events: OddsApiEvent[] = res.data ?? [];
    const match = events.find(e => {
      const home = e.home_team ?? '';
      const away = e.away_team ?? '';
      return (
        (nameSimilarity(home, player1) && nameSimilarity(away, player2)) ||
        (nameSimilarity(home, player2) && nameSimilarity(away, player1))
      );
    });

    if (!match) return null;

    const bet365 = match.bookmakers?.find(
      b => (b.key ?? '').includes('bet365') || (b.title ?? '').toLowerCase().includes('bet365')
    );
    if (!bet365) return null;

    const homeIsP1 = nameSimilarity(match.home_team ?? '', player1);
    const h2hMarket = bet365.markets?.find(m => m.key === 'h2h');
    const totalsMarket = bet365.markets?.find(m => m.key === 'totals');

    const homeOdd = h2hMarket?.outcomes?.find(o =>
      nameSimilarity(o.name ?? '', match.home_team ?? '')
    )?.price ?? null;
    const awayOdd = h2hMarket?.outcomes?.find(o =>
      nameSimilarity(o.name ?? '', match.away_team ?? '')
    )?.price ?? null;

    const over = totalsMarket?.outcomes?.find(o => (o.name ?? '').toLowerCase() === 'over');
    const under = totalsMarket?.outcomes?.find(o => (o.name ?? '').toLowerCase() === 'under');

    return {
      available: true,
      player1,
      player2,
      player1Odd: homeIsP1 ? homeOdd : awayOdd,
      player2Odd: homeIsP1 ? awayOdd : homeOdd,
      overOdd: over?.price ?? null,
      underOdd: under?.price ?? null,
      overLine: over?.point ?? null,
      source: 'odds-api.io',
      fetchedAt: Date.now(),
    };
  } catch (err) {
    const e = err as AxiosError;
    console.warn('[Odds] odds-api.io erro:', e.response?.status ?? e.message);
    return null;
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Busca odds em tempo real da Bet365 para uma partida.
 * Tenta SportsDataAPI primeiro, depois odds-api.io como fallback.
 * Nunca usa cache — sempre consulta em tempo real.
 */
export async function fetchOdds(
  player1: string,
  player2: string
): Promise<OddsResult> {
  const keyPrimary = process.env.ODDS_API_KEY;
  const keyAlt = process.env.ODDS_API_KEY_ALT;

  if (!keyPrimary && !keyAlt) {
    return oddsUnavailable(
      player1,
      player2,
      'Nenhuma chave de API configurada. Adicione ODDS_API_KEY ou ODDS_API_KEY_ALT no .env.local.'
    );
  }

  // odds-api.io é prioridade (SportsDataAPI não resolvia em testes)
  const primary = await fetchFromOddsApiIo(player1, player2);
  if (primary) return primary;

  // SportsDataAPI como tentativa secundária
  const fallback = await fetchFromSportsDataAPI(player1, player2);
  if (fallback) return fallback;

  // Nenhum retornou resultado para este jogo
  return oddsUnavailable(
    player1,
    player2,
    'Odd da Bet365 não disponível para esta partida — análise baseada apenas no modelo.'
  );
}
