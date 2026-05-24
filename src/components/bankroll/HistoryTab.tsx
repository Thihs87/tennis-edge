'use client';

import { useMemo, useState } from 'react';
import { calcBetStats, formatBRL, formatPercent } from '@/services/bankroll';
import { setBetStatus, removeBet, clearHistory } from '@/lib/bankroll-storage';
import type { BetRecord, BetStatus } from '@/types/bankroll';

interface Props {
  history: BetRecord[];
  onChange: () => void;
}

type FilterStatus = 'all' | BetStatus;

const STATUS_LABEL: Record<BetStatus, string> = {
  pending: 'Pendente',
  won:     'Ganhou',
  lost:    'Perdeu',
  void:    'Anulada',
};

const STATUS_TONE: Record<BetStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  won:     'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  lost:    'bg-rose-500/15 text-rose-700 dark:text-rose-400',
  void:    'bg-muted text-muted-foreground',
};

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch {
    return iso;
  }
}

function betProfit(b: BetRecord): number {
  if (b.status === 'won')  return (b.odd - 1) * b.stakeAmount;
  if (b.status === 'lost') return -b.stakeAmount;
  return 0;
}

export function HistoryTab({ history, onChange }: Props) {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterUser,   setFilterUser]   = useState<string>('all');

  const usernames = useMemo(() => {
    const set = new Set<string>();
    history.forEach(b => { if (b.username) set.add(b.username); });
    return Array.from(set).sort();
  }, [history]);

  const filtered = useMemo(() => {
    return history.filter(b => {
      if (filterStatus !== 'all' && b.status !== filterStatus) return false;
      if (filterUser !== 'all' && (b.username ?? '') !== filterUser) return false;
      return true;
    });
  }, [history, filterStatus, filterUser]);

  const stats = useMemo(() => calcBetStats(filtered), [filtered]);

  function handleStatus(id: string, status: BetStatus) {
    setBetStatus(id, status);
    onChange();
  }

  function handleRemove(id: string) {
    if (confirm('Remover essa aposta do histórico?')) {
      removeBet(id);
      onChange();
    }
  }

  function handleClearAll() {
    if (confirm('Limpar TODO o histórico? Essa ação não pode ser desfeita.')) {
      clearHistory();
      onChange();
    }
  }

  if (history.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center space-y-3">
        <p className="text-3xl">📒</p>
        <p className="font-semibold">Nenhuma aposta registrada</p>
        <p className="text-sm text-muted-foreground">
          Quando você registrar apostas pelo simulador ou pela aba &quot;Registrar&quot;, elas aparecem aqui com lucro, ROI e taxa de acerto.
        </p>
      </div>
    );
  }

  const profitTone = stats.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
  const roiTone    = stats.roi    >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Apostas</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{stats.total}</p>
          <p className="text-xs text-muted-foreground">
            {stats.won} W · {stats.lost} L · {stats.pending} pendente{stats.pending !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Taxa de acerto</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{formatPercent(stats.winRate, 0)}</p>
          <p className="text-xs text-muted-foreground">sobre apostas resolvidas</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Lucro</p>
          <p className={`text-2xl font-bold tabular-nums mt-1 ${profitTone}`}>
            {stats.profit >= 0 ? '+' : ''}{formatBRL(stats.profit)}
          </p>
          <p className="text-xs text-muted-foreground">total apostado: {formatBRL(stats.staked)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">ROI</p>
          <p className={`text-2xl font-bold tabular-nums mt-1 ${roiTone}`}>
            {stats.roi >= 0 ? '+' : ''}{formatPercent(stats.roi, 1)}
          </p>
          <p className="text-xs text-muted-foreground">retorno sobre o apostado</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as FilterStatus)}
          className="px-3 py-2 rounded-xl border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="all">Todas as apostas</option>
          <option value="pending">Pendentes</option>
          <option value="won">Ganhas</option>
          <option value="lost">Perdidas</option>
          <option value="void">Anuladas</option>
        </select>
        {usernames.length > 0 && (
          <select
            value={filterUser}
            onChange={e => setFilterUser(e.target.value)}
            className="px-3 py-2 rounded-xl border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">Todos os usuários</option>
            {usernames.map(u => <option key={u} value={u}>{u}</option>)}
            <option value="">Sem usuário</option>
          </select>
        )}
        <button
          type="button"
          onClick={handleClearAll}
          className="ml-auto text-xs text-muted-foreground hover:text-rose-500 transition-colors"
        >
          Limpar histórico
        </button>
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhuma aposta com os filtros selecionados.
          </p>
        ) : (
          filtered.map(bet => (
            <div key={bet.id} className="rounded-2xl border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${STATUS_TONE[bet.status]}`}>
                      {STATUS_LABEL[bet.status]}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{shortDate(bet.recordedAt)}</span>
                    {bet.username && (
                      <span className="text-xs text-muted-foreground">· {bet.username}</span>
                    )}
                  </div>
                  <p className="font-semibold text-sm mt-1 truncate">
                    {bet.player1} <span className="text-muted-foreground font-normal">vs</span> {bet.player2}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {bet.market}
                    {bet.tourneyName ? ` · ${bet.tourneyName}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground">odd <span className="font-mono tabular-nums">{bet.odd.toFixed(2)}</span></p>
                  <p className="text-sm font-bold tabular-nums">{bet.stakeUnits}u</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{formatBRL(bet.stakeAmount)}</p>
                </div>
              </div>

              {bet.status !== 'pending' && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Resultado:</span>
                  <span className={`tabular-nums font-bold ${
                    bet.status === 'won' ? 'text-emerald-600 dark:text-emerald-400' :
                    bet.status === 'lost' ? 'text-rose-600 dark:text-rose-400' :
                    'text-muted-foreground'
                  }`}>
                    {bet.status === 'won' ? `+${formatBRL(betProfit(bet))}` :
                     bet.status === 'lost' ? `-${formatBRL(bet.stakeAmount)}` :
                     'Anulada (devolvida)'}
                  </span>
                </div>
              )}

              {/* Ações */}
              <div className="flex gap-2 pt-1 border-t border-border/50">
                {bet.status === 'pending' ? (
                  <>
                    <button type="button" onClick={() => handleStatus(bet.id, 'won')}
                      className="flex-1 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/10">
                      Ganhou
                    </button>
                    <button type="button" onClick={() => handleStatus(bet.id, 'lost')}
                      className="flex-1 py-1.5 rounded-lg border border-rose-500/40 text-rose-700 dark:text-rose-400 text-xs font-semibold hover:bg-rose-500/10">
                      Perdeu
                    </button>
                    <button type="button" onClick={() => handleStatus(bet.id, 'void')}
                      className="flex-1 py-1.5 rounded-lg border text-muted-foreground text-xs font-semibold hover:bg-accent">
                      Anular
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => handleStatus(bet.id, 'pending')}
                      className="flex-1 py-1.5 rounded-lg border text-muted-foreground text-xs font-medium hover:bg-accent">
                      Voltar pra pendente
                    </button>
                    <button type="button" onClick={() => handleRemove(bet.id)}
                      className="px-3 py-1.5 rounded-lg border text-muted-foreground text-xs font-medium hover:bg-accent hover:text-rose-500">
                      Excluir
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
