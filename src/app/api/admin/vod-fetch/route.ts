import { NextRequest, NextResponse } from 'next/server';
import { getPersonWithConfig } from '@/lib/persons';
import { getAllWorks, updateWorkVod } from '@/lib/work-store';
import { getWatchProviders } from '@/lib/tmdb';
import type { WatchProvidersDebug } from '@/lib/tmdb';
import { supplementVodWithAI } from '@/lib/vod-supplement';
import type { VodProvider } from '@/types/vod';

// POST /api/admin/vod-fetch
// body: { personName, workId?, skipAi?, forceAi? }
// 管理画面からのみ呼び出し可（proxy.ts で認証済み）
// 処理順: TMDb Watch Providers → (JP情報なしの場合) OpenAI 補完
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    personName,
    workId,
    skipAi = false,
    forceAi = false,
  } = body as {
    personName?: string;
    workId?: string;
    skipAi?: boolean;
    forceAi?: boolean;
  };

  if (!personName) {
    return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });
  }

  const person = getPersonWithConfig(personName);
  if (!person) {
    return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });
  }

  const allWorks = await getAllWorks(personName);

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
      aiCalledCount: 0,
      debugInfo: [],
    });
  }

  // AI補完の呼び出し制限（コスト制御）
  const AI_CALL_LIMIT = 10;
  // 管理者手動実行では staleDays を短くする（常に最新を確認したい）
  const AI_STALE_DAYS = forceAi ? 0 : 7;
  const AI_STALE_MS = AI_STALE_DAYS * 24 * 60 * 60 * 1000;

  let updatedCount = 0;
  let skippedCount = 0;
  let aiCalledCount = 0;
  const debugInfo: Array<{
    title: string;
    workId: string;
    providerCount: number;
    aiUsed: boolean;
    debug: WatchProvidersDebug;
  }> = [];

  for (const work of targets) {
    try {
      // 1. TMDb Watch Providers
      const { providers: tmdbProviders, debug } = await getWatchProviders(work.tmdbId!, work.type);
      let finalProviders: VodProvider[] = tmdbProviders;
      let aiUsed = false;
      let vodAiCheckedAt: number | undefined;

      // 2. TMDbでJP情報が取れなかった場合 → OpenAI補完
      const needsAi =
        !skipAi &&
        tmdbProviders.length === 0 &&
        aiCalledCount < AI_CALL_LIMIT;

      if (needsAi) {
        // AI補完の実行判定: forceAi または前回AI補完から staleDays 以上経過
        const lastAiCheck = work.vodAiCheckedAt ?? 0;
        const isStale = Date.now() - lastAiCheck >= AI_STALE_MS;

        if (forceAi || isStale) {
          const aiProviders = await supplementVodWithAI(work);
          finalProviders = aiProviders;
          aiUsed = true;
          aiCalledCount++;
          vodAiCheckedAt = Date.now();
        }
      }

      await updateWorkVod(personName, work.id, finalProviders, { vodAiCheckedAt });
      updatedCount++;
      debugInfo.push({
        title: work.title,
        workId: work.id,
        providerCount: finalProviders.length,
        aiUsed,
        debug,
      });
    } catch (err) {
      skippedCount++;
      console.error(`[vod-fetch] エラー: "${work.title}"`, err);
    }
  }

  console.log(
    `[vod-fetch] "${personName}": 更新${updatedCount}件 スキップ${skippedCount}件 AI補完${aiCalledCount}件`,
  );
  return NextResponse.json({ updatedCount, skippedCount, aiCalledCount, debugInfo });
}
