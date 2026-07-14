import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import AdminLayoutClient from './AdminLayoutClient';

// /admin/* 全体にnoindexを適用する。
// 管理画面はクロール対象外とし、検索エンジンに索引させない。
export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
