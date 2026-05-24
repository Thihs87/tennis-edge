/**
 * Integração leve com odds-api.io APENAS para listar partidas dos próximos dias.
 *
 * NÃO buscamos odds individuais por partida (isso estourava cota).
 * Só usamos o endpoint /v3/events que retorna a lista de partidas agendadas
 * dos próximos dias. Uma única chamada por refresh. Cache de 2h para economizar.
 *
 * O usuário continua entrando com a odd manualmente no simulador.
 */

import axios from 'axios';
import type { OngoingMatch, CacheEntry } from '@/types/tennis';

interface ApiEvent {
  id: number;
  home: string;
  away: string;
  date: string;
  status: string;
  league?: { name: string; slug: string };
}

const EVENTS_TTL = 2 * 60 * 60 * 1000; // 2 horas — minimiza requisições à API
const DAYS_AHEAD = 7;

let eventsCache: CacheEntry<OngoingMatch[]> | null = null;

// ─── Helpers de superfície e nomes ──────────────────────────────────────────

function getSurface(leagueName = '', slug = ''): 'Clay' | 'Hard' | 'Grass' {
  const s = (leagueName + ' ' + slug).toLowerCase();
  const clay = ['clay', 'terra', 'rome', 'roma', 'roland', 'paris', 'monte', 'madrid',
    'hamburg', 'munich', 'lyon', 'geneva', 'estoril', 'bucharest', 'marrakech',
    'istanbul', 'nice', 'barcelona', 'bogota', 'buenos aires', 'rio'];
  const grass = ['grass', 'wimbledon', 'halle', "queen's", 'eastbourne', 'birmingham',
    'nottingham', 'hertogenbosch', 's-hertogenbosch', 'mallorca', 'newport', 'bad homburg'];
  if (clay.some(k => s.includes(k))) return 'Clay';
  if (grass.some(k => s.includes(k))) return 'Grass';
  return 'Hard';
}

function isWTALeague(leagueName = '', slug = ''): boolean {
  const s = (leagueName + ' ' + slug).toLowerCase();
  return s.includes('wta') || s.includes('women');
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
  const name = leagueName
    .replace(/^(ATP|WTA)\s*-\s*(ATP|WTA)\s*/i, '')
    .replace(/,\s*\w[\w\s]*\s+(Men|Women)\s+(Singles|Doubles)$/i, '')
    .replace(/\s+(Men|Women)\s+(Singles|Doubles)$/i, '')
    .trim();
  return name || leagueName;
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

function dateToYYYYMMDD(dateStr: string): string | undefined {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return undefined;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  } catch {
    return undefined;
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Busca partidas de tênis dos próximos N dias na odds-api.io.
 * Retorna lista vazia se a API key não estiver configurada ou se a chamada falhar.
 * Cache de 2h em memória.
 */
export async function fetchUpcomingMatches(): Promise<OngoingMatch[]> {
  const now = Date.now();
  if (eventsCache && now - eventsCache.fetchedAt < EVENTS_TTL) {
    return eventsCache.data;
  }

  const apiKey = process.env.ODDS_API_KEY_ALT;
  if (!apiKey) {
    console.warn('[odds] ODDS_API_KEY_ALT não configurada — sem lista de partidas futuras.');
    return [];
  }

  let events: ApiEvent[];
  try {
    const res = await axios.get<ApiEvent[]>(
      'https://api.odds-api.io/v3/events',
      { params: { apiKey, sport: 'tennis' }, timeout: 15_000 }
    );
    events = Array.isArray(res.data) ? res.data : [];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[odds] Falha ao buscar eventos:', msg);
    return eventsCache?.data ?? [];
  }

  const cutoff = now + DAYS_AHEAD * 24 * 60 * 60 * 1000;

  const matches: OngoingMatch[] = events
    .filter(e => {
      // Exclui eventos passados e além do horizonte de 7 dias
      if (e.date) {
        const ts = new Date(e.date).getTime();
        if (isNaN(ts) || ts > cutoff) return false;
      }
      // Filtra apenas ATP/WTA main tour (ignora challenger, ITF, futures, doubles)
      const name = (e.league?.name ?? '').toLowerCase();
      const slug = (e.league?.slug ?? '').toLowerCase();
      const combined = name + ' ' + slug;
      if (combined.includes('challenger')) return false;
      if (combined.includes('itf')) return false;
      if (combined.includes('futures')) return false;
      if (combined.includes('utr')) return false;
      if (combined.includes('125k')) return false;
      if (combined.includes('doubles')) return false;
      // Exclui partidas com jogadores ainda não definidos (R16P11, QFP3, etc.)
      if (/\d/.test(e.home) || /\d/.test(e.away)) return false;
      return true;
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
        tourney_date: e.date ? dateToYYYYMMDD(e.date) : undefined,
        tourney_level: isWTALeague(leagueName, slug) ? 'WTA' : 'ATP',
      } as OngoingMatch;
    });

  eventsCache = { data: matches, fetchedAt: now };
  console.log(`[odds] Eventos carregados: ${matches.length} partidas próximas`);
  return matches;
}

export function refreshUpcomingMatchesCache() {
  eventsCache = null;
}
