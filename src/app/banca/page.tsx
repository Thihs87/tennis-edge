'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { ConfigTab } from '@/components/bankroll/ConfigTab';
import { HistoryTab } from '@/components/bankroll/HistoryTab';
import { RegisterTab } from '@/components/bankroll/RegisterTab';
import { loadConfig, loadHistory } from '@/lib/bankroll-storage';
import type { BankrollConfig, BetRecord } from '@/types/bankroll';

type Tab = 'config' | 'history' | 'register';

const TABS: { value: Tab; label: string }[] = [
  { value: 'config',   label: 'Configuração' },
  { value: 'history',  label: 'Histórico' },
  { value: 'register', label: 'Registrar' },
];

export default function BancaPage() {
  const [tab, setTab]         = useState<Tab>('history');
  const [config, setConfig]   = useState<BankrollConfig | null>(null);
  const [history, setHistory] = useState<BetRecord[]>([]);

  // Carrega tudo do localStorage no mount
  useEffect(() => {
    const c = loadConfig();
    setConfig(c);
    setHistory(loadHistory());
    // Se nunca configurou, abre direto na aba Config
    if (c.updatedAt === new Date(0).toISOString() || c.bankroll === 1000) {
      // Verificar se é a primeira vez (config default)
      if (c.updatedAt === new Date(0).toISOString()) setTab('config');
    }
  }, []);

  function reloadHistory() {
    setHistory(loadHistory());
  }

  if (!config) {
    // Loading inicial — evita flash
    return (
      <div className="min-h-screen">
        <Header />
        <main className="max-w-3xl mx-auto px-4 py-6">
          <div className="h-8 w-40 rounded animate-shimmer bg-muted" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main
        className="max-w-3xl mx-auto px-4 py-6 space-y-5"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
      >
        {/* Cabeçalho */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Banca</h1>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Gestão de unidades pra apostar com disciplina. Configure sua banca e acompanhe o histórico.
          </p>
        </div>

        {/* Tabs (segmented control) */}
        <div className="rounded-2xl border bg-card p-1.5 flex gap-1 shadow-elevated">
          {TABS.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-all ${
                tab === t.value
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                  : 'text-muted-foreground hover:bg-accent active:scale-[0.98]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Conteúdo da aba */}
        <div className="animate-fade-in" key={tab}>
          {tab === 'config'   && <ConfigTab config={config} onSaved={setConfig} />}
          {tab === 'history'  && <HistoryTab history={history} onChange={reloadHistory} />}
          {tab === 'register' && <RegisterTab config={config} onRegistered={reloadHistory} />}
        </div>
      </main>
    </div>
  );
}
