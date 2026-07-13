'use client';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

const NAV_ITEMS = [
  { href: '/admin/people/import',              label: '人物登録' },
  { href: '/admin/people-progress',            label: '進捗管理' },
  { href: '/admin/work-check',                 label: '作品管理' },
  { href: '/admin/product-check',              label: '商品管理' },
  { href: '/admin/rakuten-search',             label: '楽天検索' },
  { href: '/admin/groups',                     label: 'グループ管理' },
  { href: '/admin/providers',                  label: '配信サービス' },
  { href: '/admin/people-membership-import',   label: '所属CSV' },
  { href: '/admin/work-import',                label: '作品CSV' },
  { href: '/admin/import-history',             label: 'インポート履歴' },
  { href: '/admin/system-usage',               label: '🖥️ システム使用量' },
  { href: '/admin/openai-usage',               label: 'OpenAI利用状況' },
  { href: '/admin/analytics',                  label: '📊 アナリティクス' },
  { href: '/admin/redis-backup',               label: '💾 バックアップ' },
  { href: '/admin/db-init',                    label: '🗄️ DBスキーマ初期化' },
] as const;

async function handleLogout() {
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* 管理メニューバー */}
      <nav className="bg-slate-800 border-b border-slate-700">
        <div
          className="max-w-7xl mx-auto px-3 flex items-center gap-0.5 overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          <span className="text-slate-400 text-[10px] font-bold mr-2 whitespace-nowrap py-2">
            管理
          </span>
          {NAV_ITEMS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="whitespace-nowrap px-3 py-2 text-xs font-medium transition-colors rounded-sm text-slate-300 hover:text-white hover:bg-slate-700"
            >
              {label}
            </a>
          ))}
          <button
            type="button"
            onClick={handleLogout}
            className="whitespace-nowrap px-3 py-2 text-xs font-medium transition-colors rounded-sm text-red-400 hover:text-red-300 hover:bg-slate-700"
          >
            ログアウト
          </button>
        </div>
      </nav>
      {children}
    </>
  );
}
