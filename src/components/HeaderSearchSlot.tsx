'use client';

import { usePathname } from 'next/navigation';

// ヘッダー内の検索フォーム枠。トップページ（/）ではヒーローの大きな検索フォームをメインにするため
// ヘッダー側の検索は表示しない。トップページ以外（人物・作品・検索結果ページ等）では従来どおり表示する。
// Vercel 上でトップページ（ISR, revalidate=60）を再生成する際はサーバー側の pathname が '/index' になるため
// '/index' もトップとして扱う（'/' だけだと再生成後のHTMLにヘッダー検索が入り、ブラウザ側（'/'）と
// 食い違って React hydration error #418 になっていた）。
export default function HeaderSearchSlot({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/' || pathname === '/index') return null;
  return <div className="flex-1 min-w-0 max-w-lg">{children}</div>;
}
