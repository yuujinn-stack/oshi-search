// GET /api/cron/vod-recheck
// Vercel Cron から毎日 05:00 UTC に自動実行
// 重点確認人物: その人物の全作品（条件除外なし）
// 通常対象: 配信情報未取得・180日以上未確認・作品単位優先フラグ（条件付き）
// 認証: Authorization: Bearer {CRON_SECRET}
// 上限: 重点確認人物は全件 / 通常対象は VOD_RECHECK_LIMIT 件（デフォルト 20）

import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllWorks, updateWorkVod, updateWorkVodCheckStatus } from '@/lib/work-store';
import { supplementVodWithAI } from '@/lib/vod-supplement';
import { getIntensivePersonNames } from '@/lib/person-vod-intensive';
import { getRedis } from '@/lib/redis';
import type { VodProvider } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

export const dynamic = 'force-dynamic';

const RECHECK_STALE_DAYS = 180;
const DEFAULT_RECHECK_LIMIT = 20;
const LOG_KEY = 'vod:recheck:logs';
const LOG_MAX = 30;

interface RecheckTarget {
  personName: string;
  work: WorkRecord;
  reason: string;
  priority: number;
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
    if (work.vodCheckStatus === 'checking') continue;

    const lastAiCheck = Math.max(work.lastVodCheckAt ?? 0, work.vodAiCheckedAt ?? 0);
    const hasVod = (work.vodProviders?.length ?? 0) > 0;
    const isStale = !lastAiCheck || now - lastAiCheck >= staleMs;
    const noVod = !hasVod;
    const isPriority = work.priorityRecheck === true;

    if (!isPriority && !noVod && !isStale) continue;

    let reason = '';
    let priority = 0;
    if (isPriority) {
      reason = '優先再確認フラグ';
      priority = 100;
    } else if (noVod) {
      reason = '配信情報未取得';
      priority = 50;
    } else {
      const days = Math.floor((now - lastAiCheck) / (1000 * 60 * 60 * 24));
      reason = `${days}日未確認`;
      priority = 10;
    }

    targets.push({ personName, work, reason, priority });
  }
  return targets;
}

// 重点確認人物のターゲット（条件なし・全作品）
function collectIntensiveTargets(personName: string, works: WorkRecord[]): RecheckTarget[] {
  return works
    .filter((w) => w.status === 'auto_published' && w.tmdbId && w.vodCheckStatus !== 'checking')
    .map((w) => ({
      personName,
      work: w,
      reason: '重点確認人物（全件対象）',
      priority: 200,
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

    await updateWorkVod(personName, work.id, recheckProviders, {
      replaceSources: ['openai_supplement', 'openai_web_search', 'ai_recheck'],
      vodAiCheckedAt: Date.now(),
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
      const targets = collectIntensiveTargets(person.name, works);
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

  regularTargets.sort((a, b) => b.priority - a.priority);
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
