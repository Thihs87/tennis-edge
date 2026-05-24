import { NextResponse } from 'next/server';
import { getTopPicks } from '@/services/topPicks';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === 'true';

  try {
    const result = await getTopPicks(force);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[top-do-dia]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
