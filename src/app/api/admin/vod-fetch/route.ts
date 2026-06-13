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
// 処理順:
//   1. TMDb Watch Providers (JP)
//   2. providers=0 の場合 → OpenAI補完（stale/forceAiチェック）
//   3. 両方0 → 配信情報なし保存

export interface VodFetchDebugItem {
  title: string;
  workId: string;
  tmdbId?: number;
  workType: 'movie' | 'tv';
  // TMDb debug
  jpExists: boolean;
  tmdbProviderCount: number;
  tmdbFlatrateCount: number;
  tmdbRentCount: number;
  tmdbBuyCount: number;
  tmdbAdsCount: number;
  tmdbReason?: string;
  // AI debug
  aiCalled: boolean;
  aiCallReason: string;     // なぜAIを呼んだ / 呼ばなかったか
  aiProviderCount: number;
  // 最終結果
  finalProviderCount: number;
  finalProviders: Array<{
    name: string;
    type: string;
    source: string;
    sourceLabel?: string;
    confidence?: string;
    checkedDate?: string;
    note?: string;
    publicVisible: boolean;
    hiddenReason?: string;
  }>;
  savedDebug: WatchProvidersDebug;
}

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
  // forceAi=true のときは 0日 = 常に再実行
  const AI_STALE_DAYS = forceAi ? 0 : 7;
  const AI_STALE_MS = AI_STALE_DAYS * 24 * 60 * 60 * 1000;

  let updatedCount = 0;
  let skippedCount = 0;
  let aiCalledCount = 0;
  const debugInfo: VodFetchDebugItem[] = [];

  for (const work of targets) {
    try {
      // 1. TMDb Watch Providers
      const { providers: tmdbProviders, debug } = await getWatchProviders(work.tmdbId!, work.type);
      let finalProviders: VodProvider[] = tmdbProviders;
      let aiCalled = false;
      let aiCallReason = '';
      let aiProviderCount = 0;
      let vodAiCheckedAt: number | undefined;

      // 2. providers=0（jpExists の有無に関わらず）→ AI補完を試みる
      //    jpExists=true でも providers=0 = TMDb側に配信登録なし → AI で補完
      //    jpExists=false = TMDb自体にJP情報なし → AI で補完
      const needsAi =
        !skipAi &&
        tmdbProviders.length === 0 &&
        aiCalledCount < AI_CALL_LIMIT;

      if (!needsAi) {
        if (skipAi) {
          aiCallReason = 'スキップ: skipAi=true';
        } else if (tmdbProviders.length > 0) {
          aiCallReason = `スキップ: TMDb取得済み（${tmdbProviders.length}件）`;
        } else if (aiCalledCount >= AI_CALL_LIMIT) {
          aiCallReason = `スキップ: AI呼び出し上限（${AI_CALL_LIMIT}件）に達した`;
        }
      } else {
        const lastAiCheck = work.vodAiCheckedAt ?? 0;
        const isStale = Date.now() - lastAiCheck >= AI_STALE_MS;
        const daysSince = Math.floor((Date.now() - lastAiCheck) / (1000 * 60 * 60 * 24));

        if (!forceAi && !isStale) {
          aiCallReason = `スキップ: AI補完を${daysSince}日前に実行済み（${AI_STALE_DAYS}日以内は再実行しない）`;
        } else {
          const reason = debug.jpExists
            ? 'jpExists=true だが providers=0（TMDb配信登録なし）'
            : 'jpExists=false（TMDbにJP情報なし）';

          const aiProviders = await supplementVodWithAI(work);
          finalProviders = aiProviders;
          aiCalled = true;
          aiCallReason = `実行: ${reason}${forceAi ? ' forceAi=true' : ''}`;
          aiProviderCount = aiProviders.length;
          aiCalledCount++;
          vodAiCheckedAt = Date.now();
        }
      }

      await updateWorkVod(personName, work.id, finalProviders, { vodAiCheckedAt });
      updatedCount++;

      // デバッグ情報を組み立て
      const debugItem: VodFetchDebugItem = {
        title: work.title,
        workId: work.id,
        tmdbId: work.tmdbId,
        workType: work.type,
        jpExists: debug.jpExists,
        tmdbProviderCount: tmdbProviders.length,
        tmdbFlatrateCount: debug.jpFlatrate.length,
        tmdbRentCount: debug.jpRent.length,
        tmdbBuyCount: debug.jpBuy.length,
        tmdbAdsCount: debug.jpAds.length,
        tmdbReason: debug.reason,
        aiCalled,
        aiCallReason,
        aiProviderCount,
        finalProviderCount: finalProviders.length,
        finalProviders: finalProviders.map((p) => {
          const isLowConfidence = p.source === 'openai_supplement' && p.confidence === 'low';
          return {
            name: p.providerName,
            type: p.type,
            source: p.source,
            sourceLabel: p.sourceLabel,
            confidence: p.confidence,
            checkedDate: p.checkedDate,
            note: p.note,
            publicVisible: !isLowConfidence,
            hiddenReason: isLowConfidence ? 'AI補完・confidence=low' : undefined,
          };
        }),
        savedDebug: debug,
      };
      debugInfo.push(debugItem);
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
