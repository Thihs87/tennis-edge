import { NextResponse } from 'next/server';
import axios, { AxiosError } from 'axios';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-haiku-4-5-20251001';
const MAX_TOKENS    = 800;

interface Source {
  title: string;       // título da matéria
  url: string;         // link para a fonte original
  publisher: string;   // ex: "ESPN", "Tennis.com"
  when: string;        // ex: "há 3 dias", "semana passada"
}

interface ContextResponse {
  summary: string;     // resumo único consolidando os pontos relevantes dos dois jogadores
  sources: Source[];   // links para o usuário ler mais (max 6)
  fetchedAt: string;
}

function buildPrompt(p1: string, p2: string): string {
  return `Use a ferramenta de busca para encontrar notícias dos últimos 30 dias sobre os jogadores de tênis ${p1} e ${p2}.

Busque por:
- Lesões, problemas físicos ou retiradas de torneios
- Desempenho em torneios recentes (vitórias ou derrotas notáveis)
- Qualquer fato verificável que possa afetar o desempenho em uma próxima partida entre eles

Depois de pesquisar, consolide o que encontrou num ÚNICO resumo curto, escolhendo apenas os pontos mais relevantes para alguém que vai analisar uma aposta nessa partida. Se um jogador não teve nada relevante, simplesmente não comente sobre ele.

Responda EXATAMENTE neste formato JSON, sem nada antes ou depois (sem prefácio, sem markdown, sem explicação):
{
  "summary": "Resumo consolidado em 2 a 4 frases curtas, focando nos pontos mais relevantes dos dois jogadores. Se não encontrou nada relevante, use string vazia.",
  "sources": [
    { "title": "Título da matéria", "url": "https://...", "publisher": "ESPN", "when": "há 3 dias" }
  ]
}

REGRAS OBRIGATÓRIAS:
- O resumo é UM ÚNICO bloco de texto em português brasileiro, no máximo 4 frases curtas.
- Se um jogador não teve notícias relevantes, mencione brevemente ("Sem notícias recentes sobre Fulano") em vez de inventar coisas.
- Liste no máximo 6 fontes em "sources", priorizando as mais recentes e relevantes.
- O campo "url" deve ser o link real da matéria que você encontrou na busca.
- NÃO use travessões longos (— ou –). Use ponto, vírgula ou parênteses.
- NÃO use jargão técnico. Linguagem direta e simples.
- Foque em fatos verificáveis, nunca opiniões ou prognósticos.`;
}

/**
 * Tenta extrair um JSON válido do texto retornado pelo Claude.
 * O modelo às vezes envolve em ```json ... ``` ou adiciona texto antes.
 */
function extractJSON(text: string): ContextResponse | null {
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/g, '')
    .trim();

  // Tenta parse direto
  try { return JSON.parse(cleaned); } catch {}

  // Tenta encontrar { ... } envolvente
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const { p1, p2 } = await request.json();
    if (!p1?.trim() || !p2?.trim()) {
      return NextResponse.json({ error: 'Nomes dos dois jogadores são obrigatórios.' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Chave da API Claude não configurada.' }, { status: 500 });
    }

    const prompt = buildPrompt(p1.trim(), p2.trim());

    const res = await axios.post(
      ANTHROPIC_API,
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 4, // 2 buscas mínimas + margem
        }],
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        timeout: 60_000,
      }
    );

    // Encontra o último bloco "text" da resposta (após eventuais tool_use/result)
    const blocks: Array<{ type: string; text?: string }> = res.data?.content ?? [];
    const textBlocks = blocks.filter(b => b.type === 'text' && b.text);
    const lastText = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text! : '';

    const parsed = extractJSON(lastText);
    if (!parsed) {
      console.warn('[player-context] não conseguiu extrair JSON:', lastText.slice(0, 200));
      return NextResponse.json({
        summary: '',
        sources: [],
        fetchedAt: new Date().toISOString(),
        warning: 'Não foi possível processar a resposta da busca. Tente novamente.',
      });
    }

    return NextResponse.json({
      summary: parsed.summary ?? '',
      sources: Array.isArray(parsed.sources) ? parsed.sources.slice(0, 6) : [],
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const e = err as AxiosError;
    const msg = e.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : e.message;
    console.error('[player-context]', msg);
    return NextResponse.json({ error: 'Falha ao buscar contexto. Tente novamente em alguns instantes.' }, { status: 500 });
  }
}
