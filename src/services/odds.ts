import axios, { AxiosError } from 'axios';
import type { OngoingMatch, CacheEntry } from '@/types/tennis';

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

// Plano atual cobre apenas Betano BR — tentativas extras desperdiçam quota
const BOOKMAKER_PRIORITY = ['Betano BR'];

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

// ─── Cache de eventos ─────────────────────────────────────────────────────────

const EVENTS_TTL = 60 * 60 * 1000; // 60 min
let eventsCache: CacheEntry<OngoingMatch[]> | null = null;
let rawEventsCache: CacheEntry<ApiEvent[]> | null = null;

function getSurface(leagueName = '', slug = ''): 'Clay' | 'Hard' | 'Grass' {
  const s = (leagueName + ' ' + slug).toLowerCase();
  const clay = ['clay', 'terra', 'rome', 'roma', 'roland', 'paris', 'monte', 'madrid',
    'hamburg', 'munich', 'lyon', 'geneva', 'estoril', 'bucharest', 'marrakech',
    'istanbul', 'nice', 'barcelona', 'munich', 'bogota', 'buenos aires', 'rio'];
  const grass = ['grass', 'wimbledon', 'halle', "queen's", 'eastbourne', 'birmingham',
    'nottingham', 'hertogenbosch', 's-hertogenbosch', 'mallorca', 'newport', 'bad homburg'];
  if (clay.some(k => s.includes(k))) return 'Clay';
  if (grass.some(k => s.includes(k))) return 'Grass';
  return 'Hard';
}

function isWTALeague(leagueName = '', slug = ''): boolean {
  const s = (leagueName + ' ' + slug).toLowerCase();
  return s.includes('wta') || s.includes('women') || s.includes('itf');
}

function formatPlayerName(apiName: string): string {
  // API usa "Sobrenome, Nome" → converte para "Nome Sobrenome"
  const trimmed = apiName.trim();
  if (trimmed.includes(',')) {
    const [last, first] = trimmed.split(',').map(s => s.trim());
    return first ? `${first} ${last}` : last;
  }
  return trimmed;
}

function formatTourneyName(leagueName: string): string {
  // "ATP - ATP Geneva, Switzerland Men Singles" → "Geneva"
  // "WTA - WTA Rome, Italy Women Singles" → "Rome"
  const name = leagueName
    .replace(/^(ATP|WTA)\s*-\s*(ATP|WTA)\s*/i, '')  // Remove "ATP - ATP " prefix
    .replace(/,\s*\w[\w\s]*\s+(Men|Women)\s+(Singles|Doubles)$/i, '') // Remove ", Country Men Singles"
    .replace(/\s+(Men|Women)\s+(Singles|Doubles)$/i, '') // Remove trailing "Men Singles"
    .trim();
  return name || leagueName;
}

const DAYS_AHEAD = 7;

/**
 * Busca partidas de tênis da odds-api.io para os próximos 7 dias.
 * Cache de 60 min. Fonte primária para tela inicial (ATP + WTA).
 * Usa apenas 1 chamada de API por hora — dentro do limite de 100 req/h.
 */
export async function fetchEventsAsMatches(): Promise<OngoingMatch[]> {
  const now = Date.now();
  if (eventsCache && now - eventsCache.fetchedAt < EVENTS_TTL) {
    return eventsCache.data;
  }

  const apiKey = process.env.ODDS_API_KEY_ALT;
  if (!apiKey) return [];

  let events: ApiEvent[];
  try {
    const res = await axios.get<ApiEvent[]>(
      'https://api.odds-api.io/v3/events',
      { params: { apiKey, sport: 'tennis', bookmakers: 'Betano BR' }, timeout: 15_000 }
    );
    events = Array.isArray(res.data) ? res.data : [];
    rawEventsCache = { data: events, fetchedAt: now }; // salva para uso do fetchOdds
  } catch {
    return eventsCache?.data ?? [];
  }

  const cutoff = now + DAYS_AHEAD * 24 * 60 * 60 * 1000;

  const matches: OngoingMatch[] = events
    .filter(e => {
      // Exclui eventos passados e além do horizonte
      if (e.date) {
        const ts = new Date(e.date).getTime();
        if (isNaN(ts) || ts < now || ts > cutoff) return false;
      }
      // Mantém apenas ATP e WTA main tour — Betano BR não cobre circuitos menores
      const name = (e.league?.name ?? '').toLowerCase();
      const slug = (e.league?.slug ?? '').toLowerCase();
      const combined = name + ' ' + slug;
      if (combined.includes('challenger')) return false;
      if (combined.includes('itf')) return false;
      if (combined.includes('futures')) return false;
      if (combined.includes('utr')) return false;
      if (combined.includes('125k')) return false;
      if (combined.includes('doubles')) return false; // Betano BR foca em singles
      // Exclui partidas com jogadores ainda não definidos (R16P11, QFP3, etc.)
      if (/\d/.test(e.home) || /\d/.test(e.away)) return false;
      return true;
    })
    .sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return ta - tb;
    })
    .map((e, i) => {
      const leagueName = e.league?.name ?? '';
      const slug = e.league?.slug ?? '';
      return {
        id: `odds_${e.id}_${i}`,
        player1: formatPlayerName(e.home),
        player2: formatPlayerName(e.away),
        player1Rank: 0,
        player2Rank: 0,
        tourneyName: formatTourneyName(leagueName) || 'Torneio',
        surface: getSurface(leagueName, slug),
        round: '',
        status: (e.status === 'live' || e.status === 'inprogress') ? 'live' : 'scheduled',
        scheduledTime: e.date ? formatEventDate(e.date) : undefined,
        tourney_level: isWTALeague(leagueName, slug) ? 'WTA' : 'ATP',
        hasOdds: true,
      };
    });

  eventsCache = { data: matches, fetchedAt: now };
  return matches;
}

function formatEventDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();

    const time = d.toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    });

    if (isToday) return `Hoje ${time}`;
    if (isTomorrow) return `Amanhã ${time}`;
    return d.toLocaleDateString('pt-BR', {
      weekday: 'short', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return '';
  }
}

export function refreshEventsCache() {
  eventsCache = null;
  rawEventsCache = null;
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Retorna o conjunto de partidas (player1|player2) que têm odd disponível hoje.
 * Usa 1 chamada de API para verificar todos os eventos de tênis.
 */
export async function getMatchesWithOdds(
  matches: Array<{ player1: string; player2: string }>
): Promise<Set<string>> {
  const apiKey = process.env.ODDS_API_KEY_ALT;
  if (!apiKey) return new Set();

  let events: ApiEvent[];
  try {
    events = await fetchEvents(apiKey);
  } catch {
    return new Set();
  }

  // Para cada partida com evento, verifica apenas Betano BR (1 chamada por evento)
  // Evita explodir a quota de 100 req/hora ao tentar todos os bookmakers
  const result = new Set<string>();
  const VERIFY_BOOKMAKER = 'Betano BR';

  for (const match of matches) {
    const found = events.find(e => {
      const homeMatch = playerMatches(e.home, match.player1) || playerMatches(e.home, match.player2);
      const awayMatch = playerMatches(e.away, match.player1) || playerMatches(e.away, match.player2);
      return homeMatch && awayMatch;
    });
    if (!found) continue;

    try {
      const bookmakers = await fetchEventOdds(apiKey, found.id, VERIFY_BOOKMAKER);
      if (bookmakers[VERIFY_BOOKMAKER] && bookmakers[VERIFY_BOOKMAKER].length > 0) {
        result.add(`${match.player1}|${match.player2}`);
      }
    } catch { /* sem odd para este evento */ }
  }

  return result;
}

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
    // Reutiliza cache bruto da home (evita chamada extra à API)
    if (rawEventsCache && Date.now() - rawEventsCache.fetchedAt < EVENTS_TTL) {
      events = rawEventsCache.data;
    } else {
      events = await fetchEvents(apiKey);
      rawEventsCache = { data: events, fetchedAt: Date.now() };
    }
  } catch (err) {
    const e = err as AxiosError;
    console.warn('[Odds] Erro ao buscar eventos:', e.message);
    return oddsUnavailable(player1, player2, 'Serviço de odds temporariamente indisponível. Tente novamente em alguns minutos.');
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
      // Tenta qualquer bookmaker disponível caso o nome não bata exato
      const firstKey = Object.keys(bookmakers)[0];
      if (firstKey && bookmakers[firstKey]?.length > 0) {
        return parseOdds(player1, player2, event, firstKey, bookmakers[firstKey]);
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
