// GET  /api/admin/vod-person-recheck?person=NAME → 実行前確認用stats
// POST /api/admin/vod-person-recheck { personName } → 全作品AI再確認実行
// PATCH /api/admin/vod-person-recheck { personName, intensive } → Cron重点確認フラグ切り替え

import { NextRequest, NextResponse } from 'next/server';
import { getAllWorks, updateWorkVod, updateWorkVodCheckStatus } from '@/lib/work-store';
import { supplementVodWithAI } from '@/lib/vod-supplement';
import { setPersonIntensive } from '@/lib/person-vod-intensive';
import type { VodProvider } from '@/types/vod';

export const dynamic = 'force-dynamic';

// GET: 重点確認前の確認画面用データ
export async function GET(req: NextRequest) {
  const personName = req.nextUrl.searchParams.get('person');
  if (!personName) {
    return NextResponse.json({ error: 'person パラメータが必要です' }, { status: 400 });
  }

  const allWorks = await getAllWorks(personName);
  // 条件なし: auto_published かつ tmdbId あり → 全件対象
  const eligible = allWorks.filter((w) => w.status === 'auto_published' && w.tmdbId);

  const withVod = eligible.filter((w) => (w.vodProviders?.length ?? 0) > 0).length;
  const withoutVod = eligible.filter((w) => (w.vodProviders?.length ?? 0) === 0).length;
  const csvOnly = eligible.filter(
    (w) =>
      (w.vodProviders?.length ?? 0) > 0 &&
      w.vodProviders!.every((p) => p.source === 'manual_csv' || p.source === 'manual'),
  ).length;
  const aiChecked = eligible.filter((w) => w.lastVodCheckAt || w.vodAiCheckedAt).length;

  return NextResponse.json({
    personName,
    totalEligible: eligible.length,
    totalAll: allWorks.length,
    withVod,
    withoutVod,
    csvOnly,
    aiChecked,
    works: eligible.map((w) => ({
      id: w.id,
      title: w.title,
      type: w.type,
      releaseYear: w.releaseYear,
      vodProviderCount: w.vodProviders?.length ?? 0,
      lastVodCheckAt: w.lastVodCheckAt ?? w.vodAiCheckedAt,
      vodCheckStatus: w.vodCheckStatus,
      sources: [...new Set((w.vodProviders ?? []).map((p) => p.source))],
    })),
  });
}

// POST: 全作品AI再確認を即時実行（条件なし・全件対象）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { personName?: string };
  const { personName } = body;
  if (!personName) {
    return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });
  }

  const allWorks = await getAllWorks(personName);
  const targets = allWorks.filter((w) => w.status === 'auto_published' && w.tmdbId);

  const results: Array<{
    workId: string;
    title: string;
    status: string;
    providerCount: number;
    error?: string;
  }> = [];

  for (const work of targets) {
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

      results.push({
        workId: work.id,
        title: work.title,
        status: newStatus,
        providerCount: recheckProviders.length,
      });
    } catch (err) {
      await updateWorkVodCheckStatus(personName, work.id, 'failed', { error: String(err) });
      results.push({
        workId: work.id,
        title: work.title,
        status: 'failed',
        providerCount: 0,
        error: String(err),
      });
    }
  }

  const checkedCount = results.filter((r) => r.status !== 'failed').length;
  const errorCount = results.filter((r) => r.status === 'failed').length;

  return NextResponse.json({
    ok: true,
    personName,
    totalTargets: targets.length,
    checkedCount,
    errorCount,
    results,
  });
}

// PATCH: Cron重点確認フラグを切り替え（この人物の全作品をCronで継続確認）
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    personName?: string;
    intensive?: boolean;
  };
  const { personName, intensive } = body;
  if (!personName || typeof intensive !== 'boolean') {
    return NextResponse.json(
      { error: 'personName と intensive (boolean) が必要です' },
      { status: 400 },
    );
  }
  await setPersonIntensive(personName, intensive);
  return NextResponse.json({ ok: true, personName, intensive });
}
