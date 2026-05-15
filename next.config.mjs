import { readFileSync } from 'fs';
import { resolve } from 'path';

// Lê e aplica .env.local com override=true antes de qualquer coisa.
// Necessário porque o Claude Code CLI injeta ANTHROPIC_API_KEY vazio no ambiente
// de todos os processos filhos, e o dotenv padrão do Next.js não sobrescreve
// variáveis já definidas no processo.
try {
  const envPath = resolve(process.cwd(), '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (key && value) {
      process.env[key] = value; // override explícito
    }
  }
} catch {
  // .env.local ausente é aceitável (ex: produção usa variáveis do ambiente)
}

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
