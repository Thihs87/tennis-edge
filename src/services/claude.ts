import axios, { AxiosError } from 'axios';
import type { ModelResult } from '@/services/model';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 200;

const EDGE_LABEL: Record<string, string> = {
  value:       'com vantagem para o apostador (o modelo dá mais chance do que a casa)',
  fair:        'justa (modelo e casa estão alinhados)',
  no_value:    'sem vantagem (a casa está mais confiante que o modelo)',
  unavailable: 'sem odd informada para comparar',
};

function buildPrompt(result: ModelResult, context?: string): string {
  const { player1, player2, surface, suggestion, confidence, edge, bookmaker, oddValue, support } = result;
  const p1 = support.player1Stats;
  const p2 = support.player2Stats;
  const h2h = support.h2h;

  const edgeText = EDGE_LABEL[edge] ?? edge;
  const oddText = oddValue && bookmaker
    ? `A odd da ${bookmaker} é ${oddValue.toFixed(2)}, classificada como ${edgeText}.`
    : 'Não há odd disponível para comparação com a casa.';

  return `Você é um analista de tênis. Escreva exatamente DUAS frases curtas em português brasileiro, diretas e sem rodeios, explicando a aposta para um apostador leigo.

DADOS:
- Partida: ${player1} vs ${player2} no ${surface}
- Sugestão: ${suggestion} (confiança ${(confidence * 100).toFixed(0)}%)
- ${player1}: ranking ${p1.rank > 0 ? '#' + p1.rank : 'sem ranking'}, ${(p1.winRate * 100).toFixed(0)}% de vitórias em ${surface}, média de ${p1.avgGamesPerMatch.toFixed(1)} games por partida
- ${player2}: ranking ${p2.rank > 0 ? '#' + p2.rank : 'sem ranking'}, ${(p2.winRate * 100).toFixed(0)}% de vitórias em ${surface}, média de ${p2.avgGamesPerMatch.toFixed(1)} games por partida
- Confronto direto: ${h2h.player1Wins} a ${h2h.player2Wins} em ${h2h.totalMatches} partidas
- ${oddText}

REGRAS OBRIGATÓRIAS:
- Máximo 2 frases curtas. Sem introdução, sem título, sem listas.
- 1ª frase: o motivo principal da sugestão usando o dado mais forte.
- 2ª frase: opinião sobre a odd (se informada) ou aviso sobre a confiança (se baixa).
- NÃO use travessões (— ou –). Use ponto, vírgula ou parênteses.
- NÃO use jargão técnico nem palavras como "H2H", "edge", "value", "ROI".
- NÃO use frases como "É importante notar", "Vale destacar", "Ressalta-se".
- Não exagere nem prometa nada.${context ? `\n\nO usuário informou este contexto adicional: "${context}". Considere isso se for relevante.` : ''}`;
}

const FALLBACK_TEXT = 'Não foi possível gerar a justificativa automática no momento. Consulte os dados estatísticos acima para embasar sua decisão.';

export async function generateJustification(result: ModelResult, context?: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[Claude] ANTHROPIC_API_KEY não configurada.');
    return FALLBACK_TEXT;
  }

  const prompt = buildPrompt(result, context);

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
