import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { saveWork, getWork, getAllWorks } from '@/lib/work-store';
import type { WorkRecord, WorkType, WorkStatus } from '@/types/work';

const VALID_TYPES: WorkType[] = ['movie', 'tv', 'variety', 'anime'];
const VALID_STATUSES: WorkStatus[] = ['auto_published', 'needs_review', 'hidden'];

function normalizeTitle(title: string): string {
  return title.replace(/[\s　]+/g, ' ').trim().toLowerCase();
}

function generateManualWorkId(): string {
  return `mw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// POST /api/admin/work-manual — 手動作品追加
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    personName?: string;
    title?: string;
    type?: string;
    releaseYear?: number | string;
    roleName?: string;
    overview?: string;
    status?: string;
  };

  const { personName, title, type, releaseYear, roleName, overview, status } = body;

  if (!personName || !title || !type) {
    return NextResponse.json({ error: '必須項目が不足しています（作品名・種別）' }, { status: 400 });
  }
  if (!VALID_TYPES.includes(type as WorkType)) {
    return NextResponse.json({ error: '無効な種別です' }, { status: 400 });
  }

  const resolvedStatus = (VALID_STATUSES.includes(status as WorkStatus) ? status : 'auto_published') as WorkStatus;

  // 重複チェック（同名・同種別）
  const existing = await getAllWorks(personName);
  const norm = normalizeTitle(title);
  const dup = existing.find((w) => normalizeTitle(w.title) === norm && w.type === type);
  if (dup) {
    return NextResponse.json(
      { error: '同名・同種別の作品がすでに登録されています', existingId: dup.id },
      { status: 409 },
    );
  }

  const now = Date.now();
  const work: WorkRecord = {
    id: generateManualWorkId(),
    personName,
    title: title.trim(),
    normalizedTitle: norm,
    type: type as WorkType,
    source: 'manual',
    releaseYear: releaseYear ? Number(releaseYear) : undefined,
    roleName: roleName?.trim() || undefined,
    overview: overview?.trim() || undefined,
    confidenceScore: 100,
    status: resolvedStatus,
    checkedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  await saveWork(work);
  revalidatePath(`/person/${encodeURIComponent(personName)}`);
  return NextResponse.json({ ok: true, id: work.id });
}

// PUT /api/admin/work-manual — 手動作品編集
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    personName?: string;
    workId?: string;
    title?: string;
    type?: string;
    releaseYear?: number | string;
    roleName?: string;
    overview?: string;
    status?: string;
  };

  const { personName, workId, title, type, releaseYear, roleName, overview, status } = body;

  if (!personName || !workId) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
  }

  const existing = await getWork(personName, workId);
  if (!existing) {
    return NextResponse.json({ error: '作品が見つかりません' }, { status: 404 });
  }

  const now = Date.now();
  const updated: WorkRecord = {
    ...existing,
    title: title?.trim() ?? existing.title,
    type: (type && VALID_TYPES.includes(type as WorkType) ? type : existing.type) as WorkType,
    releaseYear: releaseYear !== undefined ? (releaseYear ? Number(releaseYear) : undefined) : existing.releaseYear,
    roleName: roleName !== undefined ? (roleName.trim() || undefined) : existing.roleName,
    overview: overview !== undefined ? (overview.trim() || undefined) : existing.overview,
    status: (status && VALID_STATUSES.includes(status as WorkStatus) ? status : existing.status) as WorkStatus,
    normalizedTitle: title ? normalizeTitle(title) : existing.normalizedTitle,
    checkedAt: now,
    updatedAt: now,
  };

  await saveWork(updated);
  revalidatePath(`/person/${encodeURIComponent(personName)}`);
  return NextResponse.json({ ok: true });
}
