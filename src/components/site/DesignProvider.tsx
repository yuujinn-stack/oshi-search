'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  type DesignTheme,
  DEFAULT_THEME,
  LS_KEY,
  QUERY_KEY,
  isValidTheme,
} from '@/lib/designTheme';

interface DesignContextValue {
  theme: DesignTheme;
  setTheme: (t: DesignTheme) => void;
}

const DesignContext = createContext<DesignContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
});

export function useDesignTheme() {
  return useContext(DesignContext);
}

export function DesignProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAdmin = pathname.startsWith('/admin');

  const [theme, setThemeState] = useState<DesignTheme>(DEFAULT_THEME);

  // 初期化: URL → localStorage → default の優先順
  useEffect(() => {
    if (isAdmin) {
      applyTheme(DEFAULT_THEME);
      return;
    }
    const fromUrl = searchParams.get(QUERY_KEY);
    if (isValidTheme(fromUrl)) {
      setThemeState(fromUrl);
      applyTheme(fromUrl);
      try { localStorage.setItem(LS_KEY, fromUrl); } catch { /* ignore */ }
      return;
    }
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (isValidTheme(saved)) {
        setThemeState(saved);
        applyTheme(saved);
        return;
      }
    } catch { /* ignore */ }
    applyTheme(DEFAULT_THEME);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // admin遷移時はstandard固定
  useEffect(() => {
    if (isAdmin) applyTheme(DEFAULT_THEME);
    else applyTheme(theme);
  }, [isAdmin, theme]);

  const setTheme = useCallback((t: DesignTheme) => {
    if (isAdmin) return;
    setThemeState(t);
    applyTheme(t);
    try { localStorage.setItem(LS_KEY, t); } catch { /* ignore */ }
    // URLクエリにも反映
    const url = new URL(window.location.href);
    url.searchParams.set(QUERY_KEY, t);
    window.history.replaceState(null, '', url.toString());
  }, [isAdmin]);

  return (
    <DesignContext.Provider value={{ theme: isAdmin ? DEFAULT_THEME : theme, setTheme }}>
      {children}
    </DesignContext.Provider>
  );
}

function applyTheme(t: DesignTheme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-design', t);
  }
}
