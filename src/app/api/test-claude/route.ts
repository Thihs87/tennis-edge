import { NextResponse } from 'next/server';
import { fetchTMLData } from '@/services/tml';
import { analyzeMatch } from '@/services/model';
import { generateJustification } from '@/services/claude';
import type { Market } from '@/services/model';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const p1 = searchParams.get('p1') ?? 'Jannik Sinner';
  const p2 = searchParams.get('p2') ?? 'Alexander Zverev';
  const surface = searchParams.get('surface') ?? 'Clay';
  const market = (searchParams.get('market') ?? 'moneyline') as Market;

  try {
    const data = await fetchTMLData();
    const result = await analyzeMatch(p1, p2, surface, market, data);
    const justification = await generateJustification(result);

    return NextResponse.json({
      query: { p1, p2, surface, market },
      suggestion: result.suggestion,
      confidence: `${(result.confidence * 100).toFixed(1)}%`,
      edge: result.edge,
      oddValue: result.oddValue,
      bookmaker: result.bookmaker,
      justification,
      model: 'claude-haiku-4-5-20251001',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
