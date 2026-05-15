import axios, { AxiosError } from 'axios';
import type { ModelResult } from '@/services/model';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;

const EDGE_LABEL: Record<string, string> = {
  value: 'com valor (modelo supera a casa)',
  fair: 'justa (modelo alinhado com a casa)',
  no_value: 'sem valor (casa mais confiante que o modelo)',
  unavailable: 'sem comparação disponível',
};

function buildPrompt(result: ModelResult): string {
  const { player1, player2, surface, suggestion, confidence, edge, bookmaker, oddValue, support } = result;
  const p1 = support.player1Stats;
  const p2 = support.player2Stats;
  const h2h = support.h2h;

  const edgeText = EDGE_LABEL[edge] ?? edge;
  const oddText = oddValue && bookmaker
    ? `A odd da ${bookmaker} é ${oddValue.toFixed(2)}, classificada como ${edgeText}.`
    : 'Não há odd disponível para comparação com a casa.';

  return `Você é um analista de tênis experiente. Com base nos dados abaixo, escreva exatamente um parágrafo de 3 a 4 frases em português brasileiro, sem jargão técnico, explicando a sugestão de aposta de forma clara e direta para um apostador leigo.

DADOS DA ANÁLISE:
- Partida: ${player1} vs ${player2} (${surface})
- Sugestão: ${suggestion}
- Confiança do modelo: ${(confidence * 100).toFixed(0)}%
- ${player1}: ranking ${p1.rank > 0 ? '#' + p1.rank : 'desconhecido'}, ${(p1.winRate * 100).toFixed(0)}% de vitórias em ${surface}, média de ${p1.avgGamesPerMatch.toFixed(1)} games por partida
- ${player2}: ranking ${p2.rank > 0 ? '#' + p2.rank : 'desconhecido'}, ${(p2.winRate * 100).toFixed(0)}% de vitórias em ${surface}, média de ${p2.avgGamesPerMatch.toFixed(1)} games por partida
- H2H: ${h2h.player1Wins} x ${h2h.player2Wins} em ${h2h.totalMatches} confrontos diretos
- ${oddText}

INSTRUÇÕES:
- Explique por que os dados apontam para essa sugestão
- Mencione o dado mais relevante que sustenta a análise
- Se houver odd disponível, comente em linguagem simples se vale a pena ou não apostar
- Seja direto e objetivo, sem exageros ou garantias`;
}

const FALLBACK_TEXT = 'Não foi possível gerar a justificativa automática no momento. Consulte os dados estatísticos acima para embasar sua decisão.';

export async function generateJustification(result: ModelResult): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[Claude] ANTHROPIC_API_KEY não configurada.');
    return FALLBACK_TEXT;
  }

  const prompt = buildPrompt(result);

  try {
    const res = await axios.post(
      ANTHROPIC_API,
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 20_000,
      }
    );

    const text: string = res.data?.content?.[0]?.text ?? '';
    return text.trim() || FALLBACK_TEXT;
  } catch (err) {
    const e = err as AxiosError;
    console.warn('[Claude] Erro na API:', e.response?.status ?? e.message);
    return FALLBACK_TEXT;
  }
}
