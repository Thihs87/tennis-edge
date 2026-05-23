// Auth simples baseada em cookie HMAC assinado.
// Usa Web Crypto API para funcionar tanto em Node quanto no Edge runtime (middleware).

export const COOKIE_NAME = 'te_session';
export const MAX_AGE     = 60 * 60 * 24 * 7; // 7 dias

interface SessionPayload {
  username: string;
  issuedAt: number;
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    // Em produção isso vai estourar logo no primeiro request — bom.
    throw new Error('AUTH_SECRET ausente ou muito curto (mínimo 16 caracteres).');
  }
  return secret;
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function b64encode(str: string): string {
  // btoa funciona no Edge; encodeURIComponent garante caracteres seguros
  return btoa(unescape(encodeURIComponent(str)));
}

function b64decode(b64: string): string {
  return decodeURIComponent(escape(atob(b64)));
}

export async function createSessionToken(username: string): Promise<string> {
  const payload = `${username}|${Date.now()}`;
  const encoded = b64encode(payload);
  const sig     = await hmacSign(encoded, getSecret());
  return `${encoded}.${sig}`;
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;

  let expectedSig: string;
  try {
    expectedSig = await hmacSign(encoded, getSecret());
  } catch {
    return null;
  }

  // Comparação constante (best effort)
  if (sig.length !== expectedSig.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) mismatch |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  if (mismatch !== 0) return null;

  try {
    const decoded = b64decode(encoded);
    const [username, issuedAtStr] = decoded.split('|');
    const issuedAt = parseInt(issuedAtStr, 10);
    if (!username || isNaN(issuedAt)) return null;

    // Sessão expirada?
    if (Date.now() - issuedAt > MAX_AGE * 1000) return null;

    return { username, issuedAt };
  } catch {
    return null;
  }
}
