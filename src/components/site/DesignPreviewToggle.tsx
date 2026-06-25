'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  DESIGN_THEMES,
  THEME_LABEL,
  THEME_ACCENT,
  DEFAULT_THEME,
  LS_KEY,
  QUERY_KEY,
  isValidTheme,
  type DesignTheme,
} from '@/lib/designTheme';

// opt-out: NEXT_PUBLIC_ENABLE_DESIGN_PREVIEW='false' のときのみ非表示
// 未設定・その他の値はすべて表示
const DISABLED = process.env.NEXT_PUBLIC_ENABLE_DESIGN_PREVIEW === 'false';

function applyTheme(t: DesignTheme) {
  document.documentElement.setAttribute('data-design', t);
}

// Provider に依存しない完全独立コンポーネント
export default function DesignPreviewToggle() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [theme, setThemeLocal] = useState<DesignTheme>(DEFAULT_THEME);
  const [mounted, setMounted] = useState(false);

  // クライアント側のみで初期化 (hydration mismatch 回避)
  useEffect(() => {
    // URL → localStorage → default の優先順
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get(QUERY_KEY);
      if (isValidTheme(fromUrl)) {
        setThemeLocal(fromUrl);
        applyTheme(fromUrl);
        setMounted(true);
        return;
      }
      const saved = localStorage.getItem(LS_KEY);
      if (isValidTheme(saved)) {
        setThemeLocal(saved);
        applyTheme(saved);
        setMounted(true);
        return;
      }
    } catch { /* ignore */ }
    applyTheme(DEFAULT_THEME);
    setMounted(true);
  }, []);

  function handleSetTheme(t: DesignTheme) {
    setThemeLocal(t);
    applyTheme(t);
    try { localStorage.setItem(LS_KEY, t); } catch { /* ignore */ }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(QUERY_KEY, t);
      window.history.replaceState(null, '', url.toString());
    } catch { /* ignore */ }
    setOpen(false);
  }

  // admin・無効化・未マウントは非表示
  if (DISABLED || !mounted || pathname.startsWith('/admin')) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '72px',
        right: '16px',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '8px',
      }}
    >
      {/* テーマ選択パネル */}
      {open && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
            padding: '12px',
            minWidth: '148px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <p style={{ fontSize: '10px', fontWeight: 600, color: '#9ca3af', padding: '0 4px 4px', margin: 0 }}>
            デザインテーマ
          </p>
          {DESIGN_THEMES.map((t) => (
            <button
              key={t}
              onClick={() => handleSetTheme(t)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                textAlign: 'left',
                background: theme === t ? '#1e293b' : 'transparent',
                color: theme === t ? '#fff' : '#475569',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                if (theme !== t) (e.currentTarget as HTMLElement).style.background = '#f1f5f9';
              }}
              onMouseLeave={(e) => {
                if (theme !== t) (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: THEME_ACCENT[t],
                  flexShrink: 0,
                }}
              />
              {THEME_LABEL[t]}
              {theme === t && <span style={{ marginLeft: 'auto', opacity: 0.7, fontSize: '10px' }}>✓</span>}
            </button>
          ))}
        </div>
      )}

      {/* トグルボタン */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="デザインテーマを切り替え"
        aria-label="デザインテーマを切り替え"
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: `2px solid ${THEME_ACCENT[theme]}`,
          background: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          cursor: 'pointer',
          transition: 'transform 0.15s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
      >
        🎨
      </button>
    </div>
  );
}
