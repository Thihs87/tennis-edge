import { NextResponse } from 'next/server';
import { fetchTMLData } from '@/services/tml';
import { analyzeMatch, classifyEdge } from '@/services/model';
import { getImpliedProbability } from '@/services/odds';
import { generateJustification } from '@/services/claude';
import type { Market } from '@/services/model';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      p1,
      p2,
      surface = 'Hard',
      market = 'moneyline',
      line,
      odd,
      oddPlayer  = 'p1',    // moneyline / first_set: para qual jogador é a odd
      oddDir     = 'over',  // games / sets / aces / DFs: Over ou Under
      acesPlayer = 'p1',    // aces / DFs: qual jogador analisar
      bestOf = 3,
      context,
    } = body as {
      p1: string;
      p2: string;
      surface?: string;
      market?: Market;
      line?: number;
      odd?: number;
      oddPlayer?: 'p1' | 'p2';
      oddDir?: 'over' | 'under';
      acesPlayer?: 'p1' | 'p2';
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

    // Determina forceDirection e forcePlayer com base no mercado e nas escolhas do usuário
    const isMoneylineType = market === 'moneyline' || market === 'first_set';
    const isOverUnderType = market === 'total_games' || market === 'total_sets' || market === 'total_aces' || market === 'total_dfs';
    const needsPlayer     = market === 'total_aces' || market === 'total_dfs';

    const forcePlayer    = isMoneylineType ? oddPlayer : (needsPlayer ? acesPlayer : undefined);
    const forceDirection = isOverUnderType ? oddDir : undefined;

    const result = await analyzeMatch(p1.trim(), p2.trim(), surface, market, data, {
      userLine: line,
      bestOf,
      context,
      skipExternalOdds: true,
      forcePlayer,
      forceDirection,
    });

    // Se o usuário informou a odd, calcula o edge com base na confiança da SUA escolha
    if (odd && odd > 1) {
      const impliedProb = getImpliedProbability(odd);
      const edge = classifyEdge(result.confidence, impliedProb);

      result.oddValue = odd;
      result.impliedProbability = impliedProb;
      result.modelProbability = result.confidence; // a confiança já é da escolha do usuário
      result.bookmaker = 'informada';
      result.edge = edge;

      // Remove avisos de odd indisponível
      result.warnings = result.warnings.filter(w => !w.toLowerCase().includes('sem odd'));
    }

    const justification = await generateJustification(result, context);

    return NextResponse.json({
      result,
      justification,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[simulator]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
