import { NextResponse } from 'next/server';
import { fetchTMLData } from '@/services/tml';

let cachedTourneys: string[] | null = null;
let cachedAt = 0;
const TTL = 6 * 60 * 60 * 1000; // 6h

async function getTourneyList(): Promise<string[]> {
  if (cachedTourneys && Date.now() - cachedAt < TTL) return cachedTourneys;

  const data = await fetchTMLData();
  const set = new Set<string>();
  for (const m of data) {
    if (m.tourney_name) set.add(m.tourney_name);
  }

  cachedTourneys = Array.from(set).sort();
  cachedAt = Date.now();
  return cachedTourneys;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim().toLowerCase();

  if (q.length < 2) return NextResponse.json([]);

  try {
    const tourneys = await getTourneyList();
    const startsWith = tourneys.filter(t => t.toLowerCase().startsWith(q));
    const contains   = tourneys.filter(t => !t.toLowerCase().startsWith(q) && t.toLowerCase().includes(q));
    return NextResponse.json([...startsWith, ...contains].slice(0, 8));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
