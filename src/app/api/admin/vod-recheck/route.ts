// GET  /api/admin/vod-recheck  → 再確認対象一覧を返す
// POST /api/admin/vod-recheck  → 単体作品を手動AI再確認
// PATCH /api/admin/vod-recheck → 優先再確認フラグを切り替え

import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import {
  getAllWorks,
  getWork,
  updateWorkVod,
  updateWorkVodCheckStatus,
  setPriorityRecheck,
} from '@/lib/work-store';
import { supplementVodWithAI } from '@/lib/vod-supplement';
import type { VodProvider } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

export const dynamic = 'force-dynamic';

const RECHECK_STALE_DAYS = 180;

interface RecheckTarget {
  personName: string;
  workId: string;
  workTitle: string;
  workType: string;
  releaseYear?: number;
  reason: string;
  lastVodCheckAt?: number;
  vodProviderCount: number;
  vodCheckStatus?: WorkRecord['vodCheckStatus'];
  priorityRecheck?: boolean;
}

function isRecheckTarget(work: WorkRecord, now: number): { eligible: boolean; reason: string } {
  if (work.status !== 'auto_published' || !work.tmdbId) return { eligible: false, reason: '' };
  if (work.vodCheckStatus === 'checking') return { eligible: false, reason: '' };

  const staleMs = RECHECK_STALE_DAYS * 24 * 60 * 60 * 1000;
  const lastAiCheck = Math.max(work.lastVodCheckAt ?? 0, work.vodAiCheckedAt ?? 0);
  const hasVod = (work.vodProviders?.length ?? 0) > 0;
  const isStale = !lastAiCheck || now - lastAiCheck >= staleMs;
  const noVod = !hasVod;
  const isPriority = work.priorityRecheck === true;

  if (isPriority) return { eligible: true, reason: '優先再確認フラグ' };
  if (noVod) return { eligible: true, reason: '配信情報未取得' };
  if (isStale) {
    const days = Math.floor((now - lastAiCheck) / (1000 * 60 * 60 * 24));
    return { eligible: true, reason: `${days}日未確認` };
  }
  return { eligible: false, reason: '' };
}

// GET: 再確認対象一覧
export async function GET() {
  const now = Date.now();
  const persons = await getAllPersonsMerged();
  const targets: RecheckTarget[] = [];

  for (const person of persons) {
    const works = await getAllWorks(person.name);
    for (const work of works) {
      const { eligible, reason } = isRecheckTarget(work, now);
      if (!eligible) continue;
      targets.push({
        personName: person.name,
        workId: work.id,
        workTitle: work.title,
        workType: work.type,
        releaseYear: work.releaseYear,
        reason,
        lastVodCheckAt: work.lastVodCheckAt ?? work.vodAiCheckedAt,
        vodProviderCount: work.vodProviders?.length ?? 0,
        vodCheckStatus: work.vodCheckStatus,
        priorityRecheck: work.priorityRecheck,
      });
    }
  }

  targets.sort((a, b) => {
    const priorityScore = (t: RecheckTarget) =>
      t.priorityRecheck ? 100 : t.vodProviderCount === 0 ? 50 : 10;
    return priorityScore(b) - priorityScore(a);
  });

  return NextResponse.json({ targets, total: targets.length });
}

// POST: 単体手動AI再確認
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { personName?: string; workId?: string };
  const { personName, workId } = body;

  if (!personName || !workId) {
    return NextResponse.json({ error: 'personName と workId が必要です' }, { status: 400 });
  }

  const work = await getWork(personName, workId);
  if (!work) {
    return NextResponse.json({ error: '作品が見つかりません' }, { status: 404 });
  }
  if (!work.tmdbId) {
    return NextResponse.json({ error: 'tmdbId がないため配信確認できません' }, { status: 400 });
  }

  try {
    await updateWorkVodCheckStatus(personName, workId, 'checking');

    const aiProviders = await supplementVodWithAI(work);

    const recheckProviders: VodProvider[] = aiProviders.map((p) => ({
      ...p,
      source: 'ai_recheck' as const,
      sourceLabel: 'AI再確認',
    }));

    const hasLowOnly = recheckProviders.length > 0 &&
      recheckProviders.every((p) => p.confidence === 'low');
    const newStatus = hasLowOnly ? 'needs_recheck' : 'checked';

    await updateWorkVod(personName, workId, recheckProviders, {
      replaceSources: ['openai_supplement', 'openai_web_search', 'ai_recheck'],
      vodAiCheckedAt: Date.now(),
    });
    await updateWorkVodCheckStatus(personName, workId, newStatus, {
      source: 'ai',
      lastVodCheckAt: Date.now(),
    });

    return NextResponse.json({
      ok: true,
      providerCount: recheckProviders.length,
      vodCheckStatus: newStatus,
    });
  } catch (err) {
    await updateWorkVodCheckStatus(personName, workId, 'failed', { error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH: 優先再確認フラグ切り替え
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    personName?: string;
    workId?: string;
    priority?: boolean;
  };
  const { personName, workId, priority } = body;

  if (!personName || !workId || typeof priority !== 'boolean') {
    return NextResponse.json(
      { error: 'personName, workId, priority (boolean) が必要です' },
      { status: 400 },
    );
  }

  await setPriorityRecheck(personName, workId, priority);
  return NextResponse.json({ ok: true, priority });
}
