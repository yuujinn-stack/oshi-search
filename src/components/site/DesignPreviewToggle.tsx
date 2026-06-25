'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { DESIGN_THEMES, THEME_LABEL, THEME_ACCENT } from '@/lib/designTheme';
import { useDesignTheme } from './DesignProvider';

// opt-out モデル: NEXT_PUBLIC_ENABLE_DESIGN_PREVIEW='false' のときのみ非表示
// 未設定・'true' はすべて表示（.env.local がVercelに渡らないため opt-out で運用）
const DISABLED = process.env.NEXT_PUBLIC_ENABLE_DESIGN_PREVIEW === 'false';

export default function DesignPreviewToggle() {
  const pathname = usePathname();
  const { theme, setTheme } = useDesignTheme();
  const [open, setOpen] = useState(false);

  // 管理画面では非表示 / 環境変数で明示的に無効化
  if (DISABLED || pathname.startsWith('/admin')) return null;

  return (
    <div className="fixed bottom-16 right-4 z-[9999] flex flex-col items-end gap-2">
      {/* テーマ選択パネル */}
      {open && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-xl p-3 flex flex-col gap-1.5 min-w-[140px]">
          <p className="text-[10px] font-semibold text-gray-400 px-1 mb-0.5">デザインテーマ</p>
          {DESIGN_THEMES.map((t) => (
            <button
              key={t}
              onClick={() => { setTheme(t); setOpen(false); }}
              className={[
                'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all text-left',
                theme === t
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-600 hover:bg-gray-100',
              ].join(' ')}
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: THEME_ACCENT[t] }}
              />
              {THEME_LABEL[t]}
              {theme === t && <span className="ml-auto text-[10px] opacity-70">✓</span>}
            </button>
          ))}
        </div>
      )}

      {/* トグルボタン */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="デザインテーマを切り替え"
        className="w-11 h-11 rounded-full shadow-lg border border-gray-200 bg-white flex items-center justify-center text-lg hover:scale-105 active:scale-95 transition-transform"
        style={{ boxShadow: `0 0 0 2px ${THEME_ACCENT[theme]}40` }}
      >
        🎨
      </button>
    </div>
  );
}
