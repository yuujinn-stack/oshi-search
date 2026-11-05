import type { ReactNode } from 'react';
import Link from 'next/link';
import { getAllAffiliateProgramsOrThrow } from '@/lib/affiliate-store';
import { listOshikatsuAffiliateServicesOrThrow } from '@/lib/oshikatsu-affiliate/store';
import { LogoutButton } from '@/components/admin/LogoutButton';
import RedisErrorBanner from '@/components/admin/RedisErrorBanner';
import AffiliateManager from './AffiliateManager';
import OshikatsuAffiliateManager from './OshikatsuAffiliateManager';

export const dynamic = 'force-dynamic';

// タブ: ①VOD配信（既存の VODアフィリエイト管理をそのまま表示） ②推し活サービス（グッズ制作・グッズ買取・ファッションレンタル）。
// 表示中のタブのデータだけを読み込む。VOD側のデータ・処理（AffiliateManager / affiliate-store）は変更していない。
type Tab = 'vod' | 'oshikatsu';

const TABS: { id: Tab; label: string }[] = [
  { id: 'vod', label: 'VOD配信' },
  { id: 'oshikatsu', label: '推し活サービス' },
];

export default async function AdminAffiliatesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: rawTab } = await searchParams;
  const tab: Tab = rawTab === 'oshikatsu' ? 'oshikatsu' : 'vod';

  let body: ReactNode;
  if (tab === 'vod') {
    let programs: Awaited<ReturnType<typeof getAllAffiliateProgramsOrThrow>>;
    try {
      programs = await getAllAffiliateProgramsOrThrow();
    } catch (err) {
      return <RedisErrorBanner detail={String(err)} />;
    }
    body = (
      <>
        <p className="text-sm text-gray-500 mb-4 max-w-2xl">
          VODサービスとのアフィリエイト提携（ASP案件・広告素材・掲載位置）を管理します。
          ここに登録していない、または無効化したサービスは、これまで通り既存のVOD配信リンクがそのまま表示されます。
        </p>
        <AffiliateManager initialPrograms={programs} />
      </>
    );
  } else {
    let services: Awaited<ReturnType<typeof listOshikatsuAffiliateServicesOrThrow>> | null = null;
    let loadError: string | null = null;
    try {
      services = await listOshikatsuAffiliateServicesOrThrow();
    } catch (err) {
      loadError = String(err);
    }
    body = loadError !== null || services === null ? (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-bold mb-1">推し活サービスの案件を読み込めませんでした</p>
        <p className="mb-2">
          テーブル（oshikatsu_affiliate_services / oshikatsu_affiliate_creatives）が未作成の可能性があります。
          <a href="/admin/db-init" className="underline font-semibold">DB初期化（/admin/db-init）</a> を実行してから再読み込みしてください。
          既存テーブル・データは変更されません。
        </p>
        <p className="text-xs text-red-500 break-all">{loadError}</p>
      </div>
    ) : (
      <OshikatsuAffiliateManager initialServices={services} />
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800">アフィリエイト広告管理</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            ASPの広告案件・広告タグを登録・更新・停止できます。変更は公開ページへすぐ反映されます。
          </p>
        </div>
        <div className="flex items-center gap-4 mt-1 flex-shrink-0">
          {tab === 'vod' && (
            <a href="/admin/providers" className="text-xs text-indigo-600 hover:underline">
              配信サービス管理 →
            </a>
          )}
          <LogoutButton className="text-xs text-gray-400 hover:text-red-500" />
        </div>
      </div>

      <nav className="flex gap-1 border-b border-gray-200 mb-6" aria-label="広告の種類">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === 'vod' ? '/admin/affiliates' : `/admin/affiliates?tab=${t.id}`}
            aria-current={t.id === tab ? 'page' : undefined}
            className={
              t.id === tab
                ? '-mb-px border-b-2 border-indigo-600 px-4 py-2 text-sm font-bold text-indigo-700'
                : 'px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-800'
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {body}
    </div>
  );
}
