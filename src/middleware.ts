import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth';

// Rotas que NÃO exigem autenticação
const PUBLIC_PREFIXES = ['/login', '/api/login'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Libera rotas públicas e assets do Next
  if (PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // Valida cookie
  const token   = req.cookies.get(COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    // Para chamadas de API, retorna 401 em vez de redirecionar
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    if (pathname !== '/') loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Aplica o middleware em tudo exceto assets estáticos
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf)$).*)',
  ],
};
