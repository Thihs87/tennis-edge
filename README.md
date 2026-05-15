# TennisEdge

Webapp de análise de apostas em tênis baseada em dados históricos públicos e odds em tempo real.

## O que faz

- Lista partidas de tênis do dia (ATP/WTA), incluindo ao vivo
- Permite selecionar um jogo e um mercado de aposta (moneyline, total de games, total de aces)
- Calcula probabilidades com base em dados históricos ponderados temporalmente
- Compara com as odds da Bet365 em tempo real
- Gera uma sugestão com justificativa em texto usando Claude (Anthropic)

## Fontes de dados

| Fonte | Uso | Licença |
|---|---|---|
| [TML Database](https://stats.tennismylife.org) | Histórico de partidas ATP/WTA | MIT |
| SportsDataAPI / odds-api.io | Odds em tempo real (Bet365) | Plano gratuito |
| Anthropic Claude API | Geração de texto da justificativa | Pago por uso |

## Pré-requisitos

- Node.js v18 ou superior
- npm v9 ou superior

## Instalação

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/tennis-edge.git
cd tennis-edge

# Instale as dependências
npm install

# Configure as variáveis de ambiente
cp .env.example .env.local
# Edite .env.local e preencha as chaves de API
```

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha:

```env
# Odds em tempo real (Bet365) — cadastro gratuito em sportsdataapi.com
ODDS_API_KEY=

# Fallback para odds — cadastro gratuito em odds-api.io
ODDS_API_KEY_ALT=

# Geração de texto com Claude — console.anthropic.com
ANTHROPIC_API_KEY=
```

## Rodando localmente

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000)

## Build para produção

```bash
npm run build
npm start
```

## Deploy no Vercel

1. Faça push do repositório para o GitHub
2. Acesse [vercel.com](https://vercel.com) e importe o projeto
3. Em **Settings → Environment Variables**, adicione as três chaves do `.env.example`
4. O Vercel detecta Next.js automaticamente — clique em **Deploy**

## Estratégia de atualização de dados

| Dado | Frequência |
|---|---|
| Partidas ao vivo (`ongoing_tourneys.csv`) | A cada 60 minutos |
| Histórico anual (2024, 2025, 2026) | Uma vez por dia às 06h local |
| Odds da Bet365 | Sempre em tempo real, sem cache |

## Mercados disponíveis

1. **Moneyline** — quem vence a partida
2. **Total de games** — over/under nas linhas 19.5, 21.5 e 23.5
3. **Total de aces** — over/under por jogador

## Aviso legal

Esta análise é baseada em dados históricos e modelos estatísticos. Não representa garantia de resultado. Aposte com responsabilidade.
