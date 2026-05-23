import { NextResponse } from 'next/server';
import { fetchTMLData } from '@/services/tml';
import { previewMatch } from '@/services/model';

interface MatchInput {
  player1: string;
  player2: string;
  surface: string;
}

export async function POST(request: Request) {
  try {
    const matches: MatchInput[] = await request.json();
    if (!Array.isArray(matches) || matches.length === 0) {
      return NextResponse.json([]);
    }

    const data = await fetchTMLData(); // 24h cache — zero chamadas extras

    const previews = matches.map(m =>
      previewMatch(m.player1, m.player2, m.surface, data)
    );

    return NextResponse.json(previews);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
