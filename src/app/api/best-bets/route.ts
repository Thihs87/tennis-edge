import { NextResponse } from 'next/server';
import { fetchTMLData } from '@/services/tml';
import { analyzeMatch } from '@/services/model';
import type { Market, ModelResult } from '@/services/model';

const ALL_MARKETS: Market[] = [
  'moneyline',
  'first_set',
  'total_sets',
  'total_games',
  'total_aces',
  'total_dfs',
];

const MIN_CONFIDENCE = 0.55; // só mostra apostas com pelo menos 55% de confiança

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      p1,
      p2,
      surface = 'Hard',
      bestOf = 3,
      context,
    } = body as {
      p1: string;
      p2: string;
      surface?: string;
      bestOf?: 3 | 5;
      context?: string;
    };

    if (!p1?.trim() || !p2?.trim()) {
      return NextResponse.json(
        { error: 'Os nomes dos dois jogadores são obrigatórios.' },
        { status: 400 }
      );
    }

    const data = await fetchTMLData();

    // Roda os 6 mercados em paralelo (sem Claude, sem API externa de odds)
    const results = await Promise.all(
      ALL_MARKETS.map(market =>
        analyzeMatch(p1.trim(), p2.trim(), surface, market, data, {
          bestOf,
          context,
        }).catch(err => {
          console.warn(`[best-bets] Falha no mercado ${market}:`, err.message);
          return null;
        })
      )
    );

    // Filtra falhas, abaixo do threshold, e ordena por confiança decrescente
    const ranked = (results.filter(r => r !== null) as ModelResult[])
      .filter(r => r.confidence >= MIN_CONFIDENCE)
      .sort((a, b) => b.confidence - a.confidence);

    return NextResponse.json({
      results: ranked,
      total: results.length,
      shown: ranked.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[best-bets]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
