// 管理画面「作品画像表示設定」。作品画像を D-1共通デザイン／従来画像表示 のどちらで表示するかを切り替える。
// /admin/* は src/proxy.ts でログイン必須（未ログインはログイン画面へ）。保存は PUT /api/admin/work-image-display。
import { and, eq, isNotNull, desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { works as worksTable } from '@/db/schema';
import { LogoutButton } from '@/components/admin/LogoutButton';
import { getWorkImageDisplaySetting } from '@/lib/site-settings';
import type { WorkRecord } from '@/types/work';
import WorkImageDisplayClient from './WorkImageDisplayClient';

export const dynamic = 'force-dynamic';

// プレビュー用に、画像のある公開作品を数件だけ読む（読み取りのみ。失敗しても設定画面は表示する）
async function loadPreviewWorks(): Promise<WorkRecord[]> {
  try {
    const rows = await db
      .select({
        id: worksTable.id,
        personName: worksTable.personName,
        title: worksTable.title,
        type: worksTable.type,
        releaseYear: worksTable.releaseYear,
        roleName: worksTable.roleName,
        posterUrl: worksTable.posterUrl,
        manualImageUrl: worksTable.manualImageUrl,
        ogImageUrl: worksTable.ogImageUrl,
      })
      .from(worksTable)
      .where(and(eq(worksTable.status, 'auto_published'), eq(worksTable.deleted, false), isNotNull(worksTable.posterUrl)))
      .orderBy(desc(worksTable.updatedAt))
      .limit(3);
    return rows.map((r) => ({
      id: r.id,
      personName: r.personName,
      title: r.title,
      normalizedTitle: r.title,
      type: r.type as WorkRecord['type'],
      source: 'tmdb',
      releaseYear: r.releaseYear ?? undefined,
      roleName: r.roleName ?? undefined,
      posterUrl: r.posterUrl ?? undefined,
      manualImageUrl: r.manualImageUrl ?? undefined,
      ogImageUrl: r.ogImageUrl ?? undefined,
      confidenceScore: 0,
      status: 'auto_published',
      vodProviders: [],
      createdAt: 0,
      updatedAt: 0,
    }));
  } catch (err) {
    console.warn('[admin/work-image-display] プレビュー用の作品を読み込めませんでした:', String(err));
    return [];
  }
}

export default async function AdminWorkImageDisplayPage() {
  const [setting, previewWorks] = await Promise.all([getWorkImageDisplaySetting(), loadPreviewWorks()]);
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800">作品画像表示設定</h1>
          <p className="text-sm text-gray-500 mt-1">
            公開ページの作品画像を「D-1共通デザイン」と「従来画像表示」のどちらで表示するかを切り替えます。保存するとサイト全体に反映されます（再デプロイ不要）。
          </p>
        </div>
        <LogoutButton className="text-xs text-gray-400 hover:text-red-500 mt-1 flex-shrink-0" />
      </div>
      <WorkImageDisplayClient initialSetting={setting} previewWorks={previewWorks} />
    </div>
  );
}
