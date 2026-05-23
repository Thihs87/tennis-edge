import { NextResponse } from 'next/server';
import { fetchTMLData } from '@/services/tml';
import { analyzeMatch } from '@/services/model';
import { generateJustification } from '@/services/claude';
import type { Market } from '@/services/model';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const p1      = searchParams.get('p1') ?? '';
  const p2      = searchParams.get('p2') ?? '';
  const surface = searchParams.get('surface') ?? 'Hard';
  const market  = (searchParams.get('market') ?? 'moneyline') as Market;

  if (!p1 || !p2) {
    return NextResponse.json({ error: 'Parâmetros p1 e p2 são obrigatórios.' }, { status: 400 });
  }

  try {
    const data = await fetchTMLData();
    const result = await analyzeMatch(p1, p2, surface, market, data);
    const justification = await generateJustification(result);

    return NextResponse.json({
      result,
      justification,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
