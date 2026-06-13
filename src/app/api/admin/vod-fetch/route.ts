import { NextRequest, NextResponse } from 'next/server';
import { getPersonWithConfig } from '@/lib/persons';
import { getAllWorks, updateWorkVod } from '@/lib/work-store';
import { getWatchProviders } from '@/lib/tmdb';
import type { WatchProvidersDebug } from '@/lib/tmdb';

// POST /api/admin/vod-fetch
// body: { personName, workId? }
// workId 指定時は1作品のみ、省略時は全公開作品を対象に配信情報を取得
// 管理画面からのみ呼び出し可（proxy.ts で認証済み）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId } = body as { personName?: string; workId?: string };

  if (!personName) {
    return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });
  }

  const person = getPersonWithConfig(personName);
  if (!person) {
    return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });
  }

  const allWorks = await getAllWorks(personName);

  // 対象作品を絞り込み（workId指定 or 全公開作品 + tmdbId あり）
  const targets = allWorks.filter((w) => {
    if (!w.tmdbId) return false;
    if (workId) return w.id === workId;
    return w.status === 'auto_published';
  });

  if (!targets.length) {
    return NextResponse.json({
      message: '対象作品がありません（tmdbId なし、または公開中の作品がない）',
      updatedCount: 0,
      skippedCount: 0,
      debugInfo: [],
    });
  }

  let updatedCount = 0;
  let skippedCount = 0;
  const debugInfo: Array<{
    title: string;
    workId: string;
    providerCount: number;
    debug: WatchProvidersDebug;
  }> = [];

  for (const work of targets) {
    try {
      const { providers, debug } = await getWatchProviders(work.tmdbId!, work.type);
      await updateWorkVod(personName, work.id, providers);
      updatedCount++;
      debugInfo.push({
        title: work.title,
        workId: work.id,
        providerCount: providers.length,
        debug,
      });
    } catch (err) {
      skippedCount++;
      console.error(`[vod-fetch] エラー: "${work.title}"`, err);
    }
  }

  console.log(`[vod-fetch] "${personName}": 更新${updatedCount}件 スキップ${skippedCount}件`);
  return NextResponse.json({ updatedCount, skippedCount, debugInfo });
}
