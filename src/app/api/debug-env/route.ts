import { NextResponse } from 'next/server';
export async function GET() {
  return NextResponse.json({
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    keyLength: process.env.ANTHROPIC_API_KEY?.length ?? 0,
    keyPrefix: process.env.ANTHROPIC_API_KEY?.substring(0, 15) ?? 'undefined',
    hasOddsKey: !!process.env.ODDS_API_KEY_ALT,
    testeVar: process.env.TESTE_VAR ?? 'undefined',
    allKeys: Object.keys(process.env).filter(k => k.startsWith('ODDS') || k.startsWith('ANTHROPIC') || k.startsWith('TESTE')),
  });
}
