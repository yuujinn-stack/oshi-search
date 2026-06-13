// GET /api/cron/vod-refresh
// Vercel Cron Jobs から毎日 04:00 UTC に自動実行
// 全人物の auto_published 作品の配信情報を更新する
// 認証: Authorization: Bearer {CRON_SECRET}

import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsWithConfig } from '@/lib/persons';
import { getAllWorks, updateWorkVod } from '@/lib/work-store';
import { getWatchProviders } from '@/lib/tmdb';
import { supplementVodWithAI } from '@/lib/vod-supplement';
import type { VodProvider } from '@/types/vod';

// 配信情報の更新間隔（日数）
const TMDB_STALE_DAYS = 7;
const AI_STALE_DAYS = 30;

// Cron 1回あたりの OpenAI 呼び出し上限（コスト制御）
const AI_CALL_LIMIT_PER_CRON = 20;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET が設定されていません' }, { status: 503 });
  }

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '認証エラー' }, { status: 401 });
  }

  const startedAt = Date.now();
  const TMDB_STALE_MS = TMDB_STALE_DAYS * 24 * 60 * 60 * 1000;
  const AI_STALE_MS = AI_STALE_DAYS * 24 * 60 * 60 * 1000;

  const persons = getAllPersonsWithConfig();
  let totalTmdb = 0;
  let totalAi = 0;
  let totalSkip = 0;
  let totalError = 0;
  let aiCallCount = 0;
  const personResults: Array<{ name: string; updated: number; ai: number }> = [];

  for (const person of persons) {
    const works = await getAllWorks(person.name);
    const targets = works.filter(
      (w) => w.status === 'auto_published' && w.tmdbId,
    );

    let personUpdated = 0;
    let personAi = 0;

    for (const work of targets) {
      // TMDb更新の要否: vodUpdatedAt が TMDB_STALE_DAYS より古い or 未取得
      const isVodStale =
        !work.vodUpdatedAt ||
        Date.now() - work.vodUpdatedAt >= TMDB_STALE_MS;

      if (!isVodStale) {
        totalSkip++;
        continue;
      }

      try {
        const { providers: tmdbProviders } = await getWatchProviders(work.tmdbId!, work.type);
        let finalProviders: VodProvider[] = tmdbProviders;
        let vodAiCheckedAt: number | undefined;

        // TMDBでJP情報なし かつ AI呼び出し枠が残っている場合
        if (
          tmdbProviders.length === 0 &&
          aiCallCount < AI_CALL_LIMIT_PER_CRON
        ) {
          const lastAiCheck = work.vodAiCheckedAt ?? 0;
          const isAiStale = Date.now() - lastAiCheck >= AI_STALE_MS;

          if (isAiStale) {
            const aiProviders = await supplementVodWithAI(work);
            finalProviders = aiProviders;
            aiCallCount++;
            personAi++;
            totalAi++;
            vodAiCheckedAt = Date.now();
          }
        }

        await updateWorkVod(person.name, work.id, finalProviders, { vodAiCheckedAt });
        personUpdated++;
        totalTmdb++;
      } catch (err) {
        totalError++;
        console.error(`[cron/vod-refresh] エラー: "${work.title}"`, err);
      }
    }

    if (personUpdated > 0 || personAi > 0) {
      personResults.push({ name: person.name, updated: personUpdated, ai: personAi });
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[cron/vod-refresh] 完了: TMDb更新${totalTmdb}件 AI補完${totalAi}件 スキップ${totalSkip}件 エラー${totalError}件 ${elapsed}秒`,
  );

  return NextResponse.json({
    ok: true,
    elapsed: `${elapsed}秒`,
    tmdbUpdated: totalTmdb,
    aiCalled: totalAi,
    skipped: totalSkip,
    errors: totalError,
    persons: personResults,
  });
}
