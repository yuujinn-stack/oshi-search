// GET /api/cron/vod-recheck
// Vercel Cron から毎月1,4,7,10,13,16,19,22,25,28日 05:00 UTC（日本時間 同日14:00頃、
// "0 5 1,4,7,10,13,16,19,22,25,28 * *"）に自動実行
// （毎月必ず10回 × 1回30件 ≒ 月間約300件。5,000件超の未確認バックログを、
//  1回のVercel Function実行時間内（maxDuration=300秒）に収まる件数へ安全に分割している。
//  「月1回」という要件自体は、同一作品を短期間に繰り返し再検索しないという
//  クールダウン設計（nextVodCheckAt等）で維持し、実行回数はあくまで
//  バックログの分割処理のためだけに増やしている）
// 重点確認人物: その人物の全作品（条件除外なし）
// 通常対象: 配信情報未取得（ただしvod-refresh等の直近クールダウン中でない）・
//           180日以上未確認（最後にAI確認された日時が古い順）・作品単位優先フラグ（条件付き）
// 認証: Authorization: Bearer {CRON_SECRET}
// 上限: 重点確認人物は全件 / 通常対象は VOD_RECHECK_LIMIT 件（デフォルト 30）
//
// vod-refreshとの重複防止: nextVodCheckAt（work-processor.ts等が使う既存の30日
// スロットリングと同じフィールド）を共有し、直近どちらかのCronがAI検索済みの
// 作品を同日/近日中に二重検索しない（詳細は src/lib/vod-check-throttle.ts）。

import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllWorks, updateWorkVod, updateWorkVodCheckStatus } from '@/lib/work-store';
import { supplementVodWithAI } from '@/lib/vod-supplement';
import { getIntensivePersonNames } from '@/lib/person-vod-intensive';
import { getRedis } from '@/lib/redis';
import { isVodCheckThrottled, computeNextVodCheckAt, isStuckChecking } from '@/lib/vod-check-throttle';
import type { VodProvider } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

export const dynamic = 'force-dynamic';
// AI Web検索そのものに時間がかかる（1件あたり最大30秒程度）ため、
// Vercel Function timeoutで処理が途中停止し vodCheckStatus='checking' のまま
// 固まらないよう猶予を確保する（根本対策は isStuckChecking による自己修復）。
export const maxDuration = 300;

const RECHECK_STALE_DAYS = 180;
// 3日に1回 × 30件 ≒ 月間約300件（バックログ分割処理のための調整。180日基準自体は変更していない）
const DEFAULT_RECHECK_LIMIT = 30;
const LOG_KEY = 'vod:recheck:logs';
const LOG_MAX = 30;

interface RecheckTarget {
  personName: string;
  work: WorkRecord;
  reason: string;
  priority: number;
  // 最後にVOD確認された日時（lastVodCheckAt / vodAiCheckedAt の新しい方）。
  // 同一priority内で「最も古い順」に処理するための並べ替えキー。
  lastAiCheck: number;
}

// 通常の作品単位条件でターゲットを選定（重点確認人物は別処理）
function collectConditionTargets(
  personName: string,
  works: WorkRecord[],
  now: number,
): RecheckTarget[] {
  const staleMs = RECHECK_STALE_DAYS * 24 * 60 * 60 * 1000;
  const targets: RecheckTarget[] = [];

  for (const work of works) {
    if (work.status !== 'auto_published') continue;
    if (!work.tmdbId) continue;
    // vodCheckStatus='checking' は通常は処理中を示すが、Vercel Function timeout等で
    // 更新が完走しなかった場合に永久に固まることがあるため、一定時間以上放置されて
    // いるものは「放棄された」とみなし再試行対象に戻す（isStuckChecking）。
    if (work.vodCheckStatus === 'checking' && !isStuckChecking(work, now)) continue;

    const lastAiCheck = Math.max(work.lastVodCheckAt ?? 0, work.vodAiCheckedAt ?? 0);
    const hasVod = (work.vodProviders?.length ?? 0) > 0;
    const isStale = !lastAiCheck || now - lastAiCheck >= staleMs;
    const noVod = !hasVod;
    const isPriority = work.priorityRecheck === true;
    // vod-refresh（またはこのCron自身の前回実行）が直近AI検索済みなら、
    // 配信情報0件であっても今回は再検索しない（vod-refreshとの重複防止）。
    const throttled = isVodCheckThrottled(work, now);
    const eligibleAsNoVod = noVod && !throttled;

    if (!isPriority && !eligibleAsNoVod && !isStale) continue;

    let reason = '';
    let priority = 0;
    if (isPriority) {
      reason = '優先再確認フラグ';
      priority = 100;
    } else if (eligibleAsNoVod) {
      reason = '配信情報未取得';
      priority = 50;
    } else {
      const days = Math.floor((now - lastAiCheck) / (1000 * 60 * 60 * 24));
      reason = `${days}日未確認`;
      priority = 10;
    }

    targets.push({ personName, work, reason, priority, lastAiCheck });
  }
  return targets;
}

// 重点確認人物のターゲット（条件なし・全作品）。
// checking固着からの復旧のみ collectConditionTargets と同様に適用する。
function collectIntensiveTargets(personName: string, works: WorkRecord[], now: number): RecheckTarget[] {
  return works
    .filter((w) => w.status === 'auto_published' && w.tmdbId && !(w.vodCheckStatus === 'checking' && !isStuckChecking(w, now)))
    .map((w) => ({
      personName,
      work: w,
      reason: '重点確認人物（全件対象）',
      priority: 200,
      lastAiCheck: Math.max(w.lastVodCheckAt ?? 0, w.vodAiCheckedAt ?? 0),
    }));
}

async function runRecheck(target: RecheckTarget): Promise<{
  status: string;
  providerCount: number;
  error?: string;
}> {
  const { personName, work } = target;
  try {
    await updateWorkVodCheckStatus(personName, work.id, 'checking');
    const aiProviders = await supplementVodWithAI(work);
    const recheckProviders: VodProvider[] = aiProviders.map((p) => ({
      ...p,
      source: 'ai_recheck' as const,
      sourceLabel: 'AI再確認',
    }));
    const hasLowOnly =
      recheckProviders.length > 0 && recheckProviders.every((p) => p.confidence === 'low');
    const newStatus = hasLowOnly ? 'needs_recheck' : 'checked';
    // 配信情報が見つからなかった場合、vod-refresh側にもこのクールダウンを共有する
    // （nextVodCheckAtはvod-refresh/vod-recheck両方が参照する共通フィールド）。
    const nextVodCheckAt = computeNextVodCheckAt(recheckProviders.length > 0);

    await updateWorkVod(personName, work.id, recheckProviders, {
      replaceSources: ['openai_supplement', 'openai_web_search', 'ai_recheck'],
      vodAiCheckedAt: Date.now(),
      nextVodCheckAt,
    });
    await updateWorkVodCheckStatus(personName, work.id, newStatus, {
      source: 'ai',
      lastVodCheckAt: Date.now(),
    });
    return { status: newStatus, providerCount: recheckProviders.length };
  } catch (err) {
    await updateWorkVodCheckStatus(personName, work.id, 'failed', { error: String(err) });
    console.error(`[cron/vod-recheck] エラー: "${work.title}" (${personName})`, err);
    return { status: 'failed', providerCount: 0, error: String(err) };
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET が設定されていません' }, { status: 503 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '認証エラー' }, { status: 401 });
  }

  const regularLimit = Math.max(1, Number(process.env.VOD_RECHECK_LIMIT ?? DEFAULT_RECHECK_LIMIT));
  const now = Date.now();
  const startedAt = now;

  const [persons, intensiveNames] = await Promise.all([
    getAllPersonsMerged(),
    getIntensivePersonNames(),
  ]);
  const intensiveSet = new Set(intensiveNames);

  const intensiveTargets: RecheckTarget[] = [];
  const regularTargets: RecheckTarget[] = [];
  const intensiveWorkKeys = new Set<string>(); // 重点確認で追加済みの workId

  for (const person of persons) {
    const works = await getAllWorks(person.name);

    if (intensiveSet.has(person.name)) {
      // 重点確認人物: 全作品（条件なし）
      const targets = collectIntensiveTargets(person.name, works, now);
      for (const t of targets) {
        intensiveTargets.push(t);
        intensiveWorkKeys.add(`${t.personName}:${t.work.id}`);
      }
    }

    // 通常条件ターゲット（重点確認で追加済みのものを除外）
    const conditionTargets = collectConditionTargets(person.name, works, now).filter(
      (t) => !intensiveWorkKeys.has(`${t.personName}:${t.work.id}`),
    );
    regularTargets.push(...conditionTargets);
  }

  // 優先度（priorityRecheck > noVod > 180日超過）を最優先に、
  // 同一優先度内では lastAiCheck が古い順（＝最後にVOD確認された日時が古い作品から）に処理する。
  // これにより「180日以上未確認」の5,000件超のグループも、実質固定順ではなく
  // 最も長く放置されている作品から優先的に処理されるようになる。
  regularTargets.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.lastAiCheck - b.lastAiCheck;
  });
  const regularSlice = regularTargets.slice(0, regularLimit);

  // 実行順: 重点確認を先に、通常を後
  const allTargets = [...intensiveTargets, ...regularSlice];

  const results: Array<{
    personName: string;
    workTitle: string;
    reason: string;
    status: string;
    providerCount: number;
  }> = [];
  let checkedCount = 0;
  let errorCount = 0;

  for (const target of allTargets) {
    const { status, providerCount } = await runRecheck(target);
    results.push({
      personName: target.personName,
      workTitle: target.work.title,
      reason: target.reason,
      status,
      providerCount,
    });
    if (status === 'failed') errorCount++;
    else checkedCount++;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const logEntry = {
    runAt: new Date(startedAt).toISOString(),
    intensivePersons: intensiveNames,
    intensiveTargetCount: intensiveTargets.length,
    regularTargetCount: regularSlice.length,
    totalTargetCount: allTargets.length,
    checkedCount,
    errorCount,
    elapsed: `${elapsed}秒`,
    results: results.slice(0, 15),
  };

  const redis = getRedis();
  if (redis) {
    await redis.lpush(LOG_KEY, JSON.stringify(logEntry));
    await redis.ltrim(LOG_KEY, 0, LOG_MAX - 1);
  }

  console.log(
    `[cron/vod-recheck] 完了: 重点確認${intensiveTargets.length}件 + 通常${regularSlice.length}件 = 合計${allTargets.length}件 チェック${checkedCount}件 エラー${errorCount}件 ${elapsed}秒`,
  );

  return NextResponse.json({
    ok: true,
    elapsed: `${elapsed}秒`,
    intensivePersons: intensiveNames,
    intensiveTargetCount: intensiveTargets.length,
    regularTargetCount: regularSlice.length,
    totalTargetCount: allTargets.length,
    checkedCount,
    errorCount,
    results,
  });
}
