'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppState } from '@/lib/server';
import { api } from '../api';

type Ctx = { state: AppState | null; error: string; refresh: () => Promise<void> };
const AppStateContext = createContext<Ctx>({ state: null, error: '', refresh: async () => {} });

// One poll of /api/state for the whole app shell, every 2 s while the tab is visible
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setState(await api<AppState>('GET', '/api/state'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const t = setInterval(tick, 2000);
    document.addEventListener('visibilitychange', tick);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first poll; state is only set after the fetch resolves
    refresh();
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  return <AppStateContext.Provider value={{ state, error, refresh }}>{children}</AppStateContext.Provider>;
}

export const useAppState = () => useContext(AppStateContext);
