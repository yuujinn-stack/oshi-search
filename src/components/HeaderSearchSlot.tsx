'use client';

import { usePathname } from 'next/navigation';

// ヘッダー内の検索フォーム枠。トップページ（/）ではヒーローの大きな検索フォームをメインにするため
// ヘッダー側の検索は表示しない。トップページ以外（人物・作品・検索結果ページ等）では従来どおり表示する。
export default function HeaderSearchSlot({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/') return null;
  return <div className="flex-1 min-w-0 max-w-lg">{children}</div>;
}
