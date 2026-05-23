import { NextResponse } from 'next/server';
import { fetchTMLData } from '@/services/tml';

let cachedPlayers: string[] | null = null;
let cachedAt = 0;
const TTL = 24 * 60 * 60 * 1000; // 24h

async function getPlayerList(): Promise<string[]> {
  if (cachedPlayers && Date.now() - cachedAt < TTL) return cachedPlayers;

  const data = await fetchTMLData();
  const set = new Set<string>();
  for (const m of data) {
    if (m.winner_name) set.add(m.winner_name);
    if (m.loser_name) set.add(m.loser_name);
  }

  cachedPlayers = Array.from(set).sort();
  cachedAt = Date.now();
  return cachedPlayers;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim().toLowerCase();

  if (q.length < 2) {
    return NextResponse.json([]);
  }

  try {
    const players = await getPlayerList();
    // Prioriza correspondências que começam com a query, depois inclui
    const startsWith = players.filter(p => p.toLowerCase().startsWith(q));
    const contains   = players.filter(p => !p.toLowerCase().startsWith(q) && p.toLowerCase().includes(q));
    const results = [...startsWith, ...contains].slice(0, 10);
    return NextResponse.json(results);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
