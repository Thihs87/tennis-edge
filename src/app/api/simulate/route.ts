import { NextResponse } from 'next/server';
import { fetchTMLData, getPlayerStats, getH2H } from '@/services/tml';
import { analyzeMatch } from '@/services/model';
import { generateJustification } from '@/services/claude';
import type { Market } from '@/services/model';
import type { MatchRecord } from '@/types/tennis';

// Filtra registros para usar apenas dados ANTES da data do jogo simulado
function filterBeforeDate(data: MatchRecord[], cutoffDate: string): MatchRecord[] {
  return data.filter(m => m.tourney_date < cutoffDate);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const p1      = searchParams.get('p1')      ?? 'Jannik Sinner';
  const p2      = searchParams.get('p2')      ?? 'Alexander Zverev';
  const surface = searchParams.get('surface') ?? 'Hard';
  const market  = (searchParams.get('market') ?? 'moneyline') as Market;
  const matchDate = searchParams.get('date')  ?? '20250113'; // YYYYMMDD

  const allData = await fetchTMLData();

  // Dados disponíveis ANTES do jogo — simula o que o sistema saberia naquele momento
  const historicalData = filterBeforeDate(allData, matchDate);

  // Estatísticas e H2H com corte temporal
  const stats1 = getPlayerStats(p1, surface, historicalData);
  const stats2 = getPlayerStats(p2, surface, historicalData);
  const h2h    = getH2H(p1, p2, historicalData);

  // Análise completa (sem odds — jogo já aconteceu, API não tem dados históricos)
  const result = await analyzeMatch(p1, p2, surface, market, historicalData);
  const justification = await generateJustification(result);

  return NextResponse.json({
    simulacao: {
      partida: `${p1} vs ${p2}`,
      torneio: 'Australian Open 2025',
      superficie: surface,
      data: matchDate,
      mercado: market,
      dadosUsados: historicalData.length,
      totalDisponivel: allData.length,
      corteTemporal: `Apenas partidas anteriores a ${matchDate}`,
    },
    previsao: {
      sugestao: result.suggestion,
      confianca: `${(result.confidence * 100).toFixed(1)}%`,
      edge: result.edge,
    },
    dadosQueOUsuarioVeria: {
      jogador1: {
        nome: stats1.playerName,
        ranking: stats1.rank > 0 ? `#${stats1.rank}` : 'Desconhecido',
        partidas: stats1.matchCount,
        winRate: `${(stats1.winRate * 100).toFixed(1)}%`,
        mediaGames: stats1.avgGamesPerMatch.toFixed(1),
        mediaAces: stats1.avgAcesPerMatch.toFixed(1),
        superficie: stats1.surface,
        dadosSuficientes: stats1.hasEnoughData,
      },
      jogador2: {
        nome: stats2.playerName,
        ranking: stats2.rank > 0 ? `#${stats2.rank}` : 'Desconhecido',
        partidas: stats2.matchCount,
        winRate: `${(stats2.winRate * 100).toFixed(1)}%`,
        mediaGames: stats2.avgGamesPerMatch.toFixed(1),
        mediaAces: stats2.avgAcesPerMatch.toFixed(1),
        superficie: stats2.surface,
        dadosSuficientes: stats2.hasEnoughData,
      },
      h2h: {
        total: h2h.totalMatches,
        sinner: h2h.player1Wins,
        zverev: h2h.player2Wins,
        mediaGames: h2h.avgGamesPerMatch.toFixed(1),
        ultimosJogos: h2h.recentMatches.slice(0, 5).map(m => ({
          data: m.tourney_date,
          vencedor: m.winner,
          placar: m.score,
          torneio: m.tourney_name,
          superficie: m.surface,
        })),
      },
    },
    textoGerado: justification,
    resultadoReal: {
      vencedor: 'Jannik Sinner',
      placar: '6-3 7-6(4) 6-3',
      modeloAcertou: result.suggestion.includes('Sinner'),
    },
    avisos: result.warnings,
  });
}
