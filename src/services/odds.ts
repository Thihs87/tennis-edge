import axios, { AxiosError } from 'axios';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface OddsResult {
  available: boolean;
  player1: string;
  player2: string;
  player1Odd: number | null;
  player2Odd: number | null;
  overOdd: number | null;
  underOdd: number | null;
  overLine: number | null;
  bookmaker: string | null;      // nome do bookmaker que forneceu os dados
  source: 'odds-api.io' | 'none';
  fetchedAt: number;
  unavailableReason?: string;
}

export interface ImpliedProbability {
  player1: number | null; // 0-1
  player2: number | null; // 0-1
  overProb: number | null;
  underProb: number | null;
}

// Bookmakers em ordem de preferência (plano atual cobre Betano BR; Bet365 fica como tentativa)
const BOOKMAKER_PRIORITY = ['Bet365', 'Betano BR', 'Betano', 'Unibet', 'Betway', '1xbet', 'Pinnacle'];

// ─── Utilitários ─────────────────────────────────────────────────────────────

export function getImpliedProbability(odd: number | null): number | null {
  if (!odd || odd <= 0) return null;
  return 1 / odd;
}

export function extractImpliedProbabilities(odds: OddsResult): ImpliedProbability {
  return {
    player1: getImpliedProbability(odds.player1Odd),
    player2: getImpliedProbability(odds.player2Odd),
    overProb: getImpliedProbability(odds.overOdd),
    underProb: getImpliedProbability(odds.underOdd),
  };
}

function oddsUnavailable(player1: string, player2: string, reason: string): OddsResult {
  return {
    available: false, player1, player2,
    player1Odd: null, player2Odd: null,
    overOdd: null, underOdd: null, overLine: null,
    bookmaker: null, source: 'none',
    fetchedAt: Date.now(), unavailableReason: reason,
  };
}

// ─── Correspondência de nomes ────────────────────────────────────────────────

// A API usa formato "Sobrenome, Nome" — o TML usa "Nome Sobrenome"
function extractSurname(name: string): string {
  const trimmed = name.trim();
  if (trimmed.includes(',')) {
    // Formato API: "Sinner, Jannik" → "sinner"
    return trimmed.split(',')[0].trim().toLowerCase();
  }
  // Formato TML: "Jannik Sinner" → "sinner"
  const parts = trimmed.toLowerCase().split(/\s+/);
  return parts[parts.length - 1];
}

function playerMatches(apiName: string, searchName: string): boolean {
  const apiSurname = extractSurname(apiName);
  const searchSurname = extractSurname(searchName);
  if (apiSurname === searchSurname) return true;
  // Comparação parcial para lidar com acentos / variações
  const apiNorm = apiName.toLowerCase().replace(/[^a-z]/g, '');
  const searchNorm = searchName.toLowerCase().replace(/[^a-z]/g, '');
  return apiNorm.includes(searchNorm.substring(0, 5)) || searchNorm.includes(apiNorm.substring(0, 5));
}

// ─── Tipos internos da API ───────────────────────────────────────────────────

interface ApiEvent {
  id: number;
  home: string;
  away: string;
  date: string;
  status: string;
  league?: { name: string; slug: string };
}

interface ApiMarket {
  name: string;          // "ML", "Total", "Spread", etc.
  updatedAt: string;
  odds: Array<{
    home?: string;
    away?: string;
    handicap?: string | number;
    over?: string;
    under?: string;
    [key: string]: unknown;
  }>;
}

// ─── odds-api.io ─────────────────────────────────────────────────────────────

async function fetchEvents(apiKey: string): Promise<ApiEvent[]> {
  const res = await axios.get<ApiEvent[]>(
    'https://api.odds-api.io/v3/events',
    { params: { apiKey, sport: 'tennis' }, timeout: 10_000 }
  );
  return Array.isArray(res.data) ? res.data : [];
}

async function fetchEventOdds(
  apiKey: string,
  eventId: number,
  bookmakers: string
): Promise<Record<string, ApiMarket[]>> {
  const res = await axios.get<{
    bookmakers?: Record<string, ApiMarket[]>;
  }>(
    'https://api.odds-api.io/v3/odds',
    {
      params: { apiKey, sport: 'tennis', bookmakers, markets: 'h2h,totals', eventId },
      timeout: 10_000,
    }
  );
  return res.data?.bookmakers ?? {};
}

function parseOdds(
  player1: string,
  player2: string,
  event: ApiEvent,
  bookmakerName: string,
  markets: ApiMarket[]
): OddsResult {
  const homeIsP1 = playerMatches(event.home, player1);

  // Moneyline
  const mlMarket = markets.find(m => m.name === 'ML');
  const mlOdds = mlMarket?.odds?.[0];
  const homeOdd = parseFloat(mlOdds?.home ?? '') || null;
  const awayOdd = parseFloat(mlOdds?.away ?? '') || null;

  // Totals (Over/Under de games)
  const totalMarket = markets.find(m =>
    m.name?.toLowerCase().includes('total') ||
    m.name?.toLowerCase().includes('over')
  );
  const overOdd = totalMarket?.odds?.[0]?.over
    ? parseFloat(String(totalMarket.odds[0].over)) || null
    : null;
  const underOdd = totalMarket?.odds?.[0]?.under
    ? parseFloat(String(totalMarket.odds[0].under)) || null
    : null;
  const overLine = totalMarket?.odds?.[0]?.handicap
    ? parseFloat(String(totalMarket.odds[0].handicap)) || null
    : null;

  return {
    available: true,
    player1,
    player2,
    player1Odd: homeIsP1 ? homeOdd : awayOdd,
    player2Odd: homeIsP1 ? awayOdd : homeOdd,
    overOdd,
    underOdd,
    overLine,
    bookmaker: bookmakerName,
    source: 'odds-api.io',
    fetchedAt: Date.now(),
  };
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Busca odds em tempo real para uma partida de tênis.
 * Tenta bookmakers em ordem de preferência (Bet365 → Betano BR → ...).
 * Nunca usa cache — sempre consulta em tempo real.
 */
export async function fetchOdds(player1: string, player2: string): Promise<OddsResult> {
  const apiKey = process.env.ODDS_API_KEY_ALT;
  if (!apiKey) {
    return oddsUnavailable(player1, player2, 'Chave ODDS_API_KEY_ALT não configurada no .env.local.');
  }

  let events: ApiEvent[];
  try {
    events = await fetchEvents(apiKey);
  } catch (err) {
    const e = err as AxiosError;
    console.warn('[Odds] Erro ao buscar eventos:', e.message);
    return oddsUnavailable(player1, player2, 'Falha ao conectar com odds-api.io.');
  }

  // Busca o evento correspondente à partida
  const event = events.find(e => {
    const homeMatch = playerMatches(e.home, player1) || playerMatches(e.home, player2);
    const awayMatch = playerMatches(e.away, player1) || playerMatches(e.away, player2);
    return homeMatch && awayMatch;
  });

  if (!event) {
    return oddsUnavailable(
      player1,
      player2,
      'Odd não disponível — esta partida ainda não está no sistema de odds. Análise baseada apenas no modelo.'
    );
  }

  // Tenta bookmakers em ordem de prioridade
  for (const bk of BOOKMAKER_PRIORITY) {
    try {
      const bookmakers = await fetchEventOdds(apiKey, event.id, bk);
      const marketData = bookmakers[bk];
      if (marketData && marketData.length > 0) {
        return parseOdds(player1, player2, event, bk, marketData);
      }
    } catch (err) {
      const e = err as AxiosError;
      console.warn(`[Odds] ${bk} erro:`, e.response?.status ?? e.message);
    }
  }

  return oddsUnavailable(
    player1,
    player2,
    'Odd da Bet365 não disponível — análise baseada apenas no modelo.'
  );
}
