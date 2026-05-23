import { NextResponse } from 'next/server';
import { createSessionToken, COOKIE_NAME, MAX_AGE } from '@/lib/auth';

// Atraso pequeno pra dificultar brute-force ingênuo
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse de APP_USERS no formato "user1:senha1,user2:senha2,...".
 * Espaços em volta de cada par são tolerados.
 * Retorna lista vazia se a env não estiver definida.
 */
function parseUsers(envValue: string | undefined): Array<{ user: string; pass: string }> {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => {
      const idx = pair.indexOf(':');
      if (idx <= 0) return null;
      return { user: pair.slice(0, idx).trim(), pass: pair.slice(idx + 1) };
    })
    .filter((x): x is { user: string; pass: string } => x !== null && !!x.user && !!x.pass);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');

    if (!username || !password) {
      return NextResponse.json({ error: 'Informe usuário e senha.' }, { status: 400 });
    }

    // 1ª tentativa: lista de usuários (APP_USERS)
    // 2ª tentativa: usuário único legado (APP_USERNAME / APP_PASSWORD)
    const users = parseUsers(process.env.APP_USERS);
    if (process.env.APP_USERNAME && process.env.APP_PASSWORD) {
      users.push({ user: process.env.APP_USERNAME, pass: process.env.APP_PASSWORD });
    }

    if (users.length === 0) {
      console.error('[auth] Nenhum usuário configurado (defina APP_USERS ou APP_USERNAME/APP_PASSWORD).');
      return NextResponse.json({ error: 'Configuração de autenticação ausente no servidor.' }, { status: 500 });
    }

    const match = users.find(u => u.user === username && u.pass === password);

    if (!match) {
      await delay(700);
      return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
    }

    const token = await createSessionToken(username);
    const res   = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   MAX_AGE,
      path:     '/',
    });
    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[auth/login]', msg);
    return NextResponse.json({ error: 'Erro interno ao processar login.' }, { status: 500 });
  }
}
