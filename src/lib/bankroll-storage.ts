/**
 * Wrapper de localStorage pra config + histórico de banca.
 * Quando migrarmos pra Supabase, só esse arquivo muda — toda lógica fica intacta.
 */

import type { BankrollConfig, BetRecord, BetStatus } from '@/types/bankroll';
import { DEFAULT_CONFIG } from '@/services/bankroll';

const CONFIG_KEY  = 'bankroll_config';
const HISTORY_KEY = 'bankroll_history';

// ─── Helpers internos ───────────────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function uuid(): string {
  // ID simples baseado em timestamp + random — suficiente pra histórico local
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
}

// ─── Config ─────────────────────────────────────────────────────────────────

export function loadConfig(): BankrollConfig {
  if (!isBrowser()) return DEFAULT_CONFIG;

  const stored = safeParse<Partial<BankrollConfig>>(localStorage.getItem(CONFIG_KEY));
  if (!stored) return DEFAULT_CONFIG;

  // Merge com defaults pra tolerar versões antigas / campos novos
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    confidenceMap: Array.isArray(stored.confidenceMap) && stored.confidenceMap.length > 0
      ? stored.confidenceMap
      : DEFAULT_CONFIG.confidenceMap,
  };
}

export function saveConfig(config: BankrollConfig): void {
  if (!isBrowser()) return;
  const toSave: BankrollConfig = { ...config, updatedAt: new Date().toISOString() };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(toSave));
}

// ─── Histórico de apostas ───────────────────────────────────────────────────

export function loadHistory(): BetRecord[] {
  if (!isBrowser()) return [];
  const list = safeParse<BetRecord[]>(localStorage.getItem(HISTORY_KEY));
  return Array.isArray(list) ? list : [];
}

export function saveHistory(bets: BetRecord[]): void {
  if (!isBrowser()) return;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(bets));
}

/** Cria um novo BetRecord com ID e timestamp, e adiciona ao histórico. */
export function addBet(bet: Omit<BetRecord, 'id' | 'recordedAt'>): BetRecord {
  const newBet: BetRecord = {
    ...bet,
    id: uuid(),
    recordedAt: new Date().toISOString(),
  };
  const current = loadHistory();
  saveHistory([newBet, ...current]); // mais recentes primeiro
  return newBet;
}

/** Atualiza o status (won/lost/void) de uma aposta. */
export function setBetStatus(id: string, status: BetStatus): void {
  const current = loadHistory();
  const updated = current.map(b =>
    b.id === id
      ? { ...b, status, settledAt: status === 'pending' ? undefined : new Date().toISOString() }
      : b
  );
  saveHistory(updated);
}

/** Remove uma aposta do histórico. */
export function removeBet(id: string): void {
  const current = loadHistory();
  saveHistory(current.filter(b => b.id !== id));
}

/** Limpa o histórico inteiro. */
export function clearHistory(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(HISTORY_KEY);
}
