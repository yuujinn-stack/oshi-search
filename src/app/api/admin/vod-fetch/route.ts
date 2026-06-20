import { NextRequest, NextResponse } from 'next/server';
import { getPersonWithConfigMerged } from '@/lib/persons';
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
//   2. providers=0 の場合 → AI Web検索補完（stale/forceAiチェック）
//   3. forceAi=true の場合は TMDb結果に関わらず AI を実行し、TMDb結果とマージ
//   4. 両方0 → 配信情報なし保存

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
  aiCallReason: string;
  aiProviderCount: number;
  // 最終結果
  finalProviderCount: number;
  finalProviders: Array<{
    name: string;
    type: string;
    source: string;
    sourceLabel?: string;
    confidence?: string;
    officialUrl?: string;
    reason?: string;
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

  const person = await getPersonWithConfigMerged(personName);
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

  console.log(
    `[vod-fetch] 開始: "${personName}" 対象${targets.length}件 forceAi=${forceAi} skipAi=${skipAi}`,
  );

  // AI補完の呼び出し制限（コスト制御）
  const AI_CALL_LIMIT = 10;
  // forceAi=true のときは 0日 = 常に再実行
  const AI_STALE_DAYS = forceAi ? 0 : 7;
  const AI_STALE_MS = AI_STALE_DAYS * 24 * 60 * 60 * 1000;
  const VOD_NOT_FOUND_RECHECK_MS = 30 * 24 * 60 * 60 * 1000; // 配信なし → 30日後に再チェック

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

      // 2. AI補完が必要かどうかを判定
      //    - forceAi=true: TMDb結果に関わらず AI を実行（テスト・強制補完用）
      //    - 通常: tmdbProviders=0 の場合のみ AI を試みる
      //    - nextVodCheckAt が未来の場合はスキップ（not_found 時の30日スロットリング）
      const nextCheckScheduled =
        !forceAi && work.nextVodCheckAt && Date.now() < work.nextVodCheckAt;
      const needsAi =
        !skipAi &&
        !nextCheckScheduled &&
        (forceAi || tmdbProviders.length === 0) &&
        aiCalledCount < AI_CALL_LIMIT;

      // per-work 判定ログ
      console.log(
        `[vod-fetch] AI補完判定: workId=${work.id} title="${work.title}" ` +
        `tmdbProviders=${tmdbProviders.length} jpExists=${debug.jpExists} ` +
        `forceAi=${forceAi} skipAi=${skipAi} ` +
        `vodAiCheckedAt=${work.vodAiCheckedAt
          ? new Date(work.vodAiCheckedAt).toISOString().slice(0, 10)
          : '未実行'} ` +
        `needsAi=${needsAi}`,
      );

      if (!needsAi) {
        if (skipAi) {
          aiCallReason = 'スキップ: skipAi=true';
        } else if (nextCheckScheduled) {
          const nextDate = new Date(work.nextVodCheckAt!).toLocaleDateString('ja-JP');
          aiCallReason = `スキップ: 前回「配信確認できず」のため次回チェック予定 ${nextDate}`;
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
          // stale期間内はスキップ（forceAi=true ならこのブロックに入らない）
          aiCallReason = `スキップ: AI補完を${daysSince}日前に実行済み（${AI_STALE_DAYS}日以内は再実行しない）`;
          console.log(
            `[vod-fetch] AI補完スキップ: workId=${work.id} reason=stale期間内（${daysSince}日前実行済み）`,
          );
        } else {
          const aiReason = forceAi && tmdbProviders.length > 0
            ? `forceAi=true（TMDb取得済み${tmdbProviders.length}件とマージ）`
            : debug.jpExists
              ? 'jpExists=true だが providers=0（TMDb配信登録なし）'
              : 'jpExists=false（TMDbにJP情報なし）';

          console.log(
            `[vod-fetch] AI補完実行: workId=${work.id} title="${work.title}" reason=${aiReason}`,
          );

          const aiProviders = await supplementVodWithAI(work);

          if (aiProviders.length === 0) {
            console.log(
              `[vod-fetch] AI補完失敗または結果なし: workId=${work.id} title="${work.title}"`,
            );
            // 配信なしマーカーを保存（公開ページでは confidence=low で非表示）
            const notFoundMarker: VodProvider = {
              providerId: -9999,
              providerName: '配信確認できず',
              type: 'unknown',
              countryCode: 'JP',
              source: 'openai_web_search',
              sourceLabel: 'AI Web検索補完',
              confidence: 'low',
              note: '公式配信ページを確認できず。配信なしとは断定しない。',
              checkedDate: new Date().toISOString().slice(0, 10),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            // TMDb に結果があれば TMDb 結果を優先（マーカーは不要）
            finalProviders = (forceAi && tmdbProviders.length > 0)
              ? tmdbProviders
              : [notFoundMarker];
          } else {
            console.log(
              `[vod-fetch] AI補完保存: workId=${work.id} savedProviders=${aiProviders.length}` +
              ` (${aiProviders.map((p) => p.providerName).join(', ')})`,
            );
            // forceAi=true かつ TMDb にも結果がある場合はマージ（TMDb優先 + AI補完）
            finalProviders = (forceAi && tmdbProviders.length > 0)
              ? [...tmdbProviders, ...aiProviders]
              : aiProviders;
          }

          aiCalled = true;
          aiCallReason = `実行: ${aiReason}`;
          aiProviderCount = aiProviders.length;
          aiCalledCount++;
          vodAiCheckedAt = Date.now();
        }
      }

      // not_found マーカーのみの場合は vodStatus='not_found' + nextVodCheckAt を保存
      const hasRealProviders = finalProviders.some((p) => p.providerName !== '配信確認できず');
      const vodStatus: 'found' | 'not_found' | undefined = aiCalled
        ? (hasRealProviders ? 'found' : 'not_found')
        : undefined;
      const nextVodCheckAt =
        vodStatus === 'not_found'
          ? Date.now() + VOD_NOT_FOUND_RECHECK_MS
          : undefined;

      await updateWorkVod(personName, work.id, finalProviders, {
        vodAiCheckedAt,
        vodStatus,
        nextVodCheckAt,
      });
      updatedCount++;

      console.log(
        `[vod-fetch] 保存完了: workId=${work.id} finalProviders=${finalProviders.length}件` +
        ` (tmdb=${tmdbProviders.length} ai=${aiProviderCount})`,
      );

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
          const isAiSource = p.source === 'openai_supplement' || p.source === 'openai_web_search';
          const isLowConfidence = isAiSource && p.confidence === 'low';
          return {
            name: p.providerName,
            type: p.type,
            source: p.source,
            sourceLabel: p.sourceLabel,
            confidence: p.confidence,
            officialUrl: p.officialUrl,
            reason: p.reason,
            checkedDate: p.checkedDate,
            note: p.note,
            publicVisible: !isLowConfidence,
            hiddenReason: isLowConfidence ? `${p.sourceLabel ?? p.source}・confidence=low` : undefined,
          };
        }),
        savedDebug: debug,
      };
      debugInfo.push(debugItem);
    } catch (err) {
      skippedCount++;
      console.error(`[vod-fetch] エラー: workId=${work.id} title="${work.title}"`, err);
    }
  }

  console.log(
    `[vod-fetch] 完了: "${personName}" 更新${updatedCount}件 スキップ${skippedCount}件 AI補完${aiCalledCount}件`,
  );
  return NextResponse.json({ updatedCount, skippedCount, aiCalledCount, debugInfo });
}
