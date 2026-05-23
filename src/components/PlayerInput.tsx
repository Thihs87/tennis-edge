'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Endpoint de busca — padrão /api/players */
  searchEndpoint?: string;
}

export function PlayerInput({ label, value, onChange, placeholder, disabled, searchEndpoint = '/api/players' }: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen]               = useState(false);
  const [fetching, setFetching]       = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); setOpen(false); return; }
    setFetching(true);
    try {
      const res = await fetch(`${searchEndpoint}?q=${encodeURIComponent(q)}`);
      const data: string[] = await res.json();
      setSuggestions(data);
      setOpen(data.length > 0);
    } catch {
      setSuggestions([]);
    } finally {
      setFetching(false);
    }
  }, [searchEndpoint]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
    return () => clearTimeout(debounceRef.current);
  }, [value, search]);

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function select(name: string) {
    onChange(name);
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="text-xs font-medium text-muted-foreground block mb-1.5">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder ?? 'Nome do jogador...'}
          disabled={disabled}
          autoComplete="off"
          className="w-full px-4 py-3 rounded-xl border bg-card text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all disabled:opacity-50"
        />
        {/* Loading spinner */}
        {fetching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
        )}
        {/* Clear button — área de toque ampliada */}
        {!fetching && value && (
          <button
            type="button"
            onClick={() => { onChange(''); setSuggestions([]); setOpen(false); }}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-lg"
            aria-label="Limpar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1.5 rounded-xl border bg-popover shadow-elevated max-h-52 overflow-y-auto animate-fade-in">
          {suggestions.map(s => (
            <button
              key={s}
              type="button"
              className="w-full text-left px-4 py-3 text-sm hover:bg-accent active:bg-accent transition-colors first:rounded-t-xl last:rounded-b-xl"
              onMouseDown={() => select(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
