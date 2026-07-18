import { NextRequest, NextResponse } from 'next/server';
import { neonSql } from '@/db/client';
import { getWork, updateWorkStatus } from '@/lib/work-store';
import { insertWorkStatusHistory, hasIdempotencyKey } from '@/db/write';
import type { WorkStatus } from '@/types/work';

export const dynamic = 'force-dynamic';

const MAX_WORKS_PER_EXECUTE = 100;
const VALID_TARGET_STATUSES: WorkStatus[] = ['auto_published', 'needs_review'];

export interface WorkRecoveryItem {
  personName: string;
  workId: string;
  title: string;
  type: string;
  source: string;
  currentStatus: string;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// GET /api/admin/work-recovery
// 隠し状態の manual_csv 作品を一覧取得する（ページネーション付き）
// query params: page, pageSize, search, personName
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page     = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? '100')));
  const search   = (searchParams.get('search') ?? '').trim();
  const pFilter  = (searchParams.get('personName') ?? '').trim();

  const offset = (page - 1) * pageSize;

  try {
    const rows = await neonSql`
      SELECT
        person_name,
        id AS work_id,
        title,
        type,
        source,
        status AS current_status,
        checked_at,
        created_at,
        updated_at
      FROM works
      WHERE source = 'manual_csv'
        AND status = 'hidden'
        AND deleted = FALSE
        ${pFilter ? neonSql`AND person_name = ${pFilter}` : neonSql``}
        ${search ? neonSql`AND (title ILIKE ${'%' + search + '%'} OR person_name ILIKE ${'%' + search + '%'} OR id ILIKE ${'%' + search + '%'})` : neonSql``}
      ORDER BY person_name, title
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const countRows = await neonSql`
      SELECT COUNT(*)::int AS total
      FROM works
      WHERE source = 'manual_csv'
        AND status = 'hidden'
        AND deleted = FALSE
        ${pFilter ? neonSql`AND person_name = ${pFilter}` : neonSql``}
        ${search ? neonSql`AND (title ILIKE ${'%' + search + '%'} OR person_name ILIKE ${'%' + search + '%'} OR id ILIKE ${'%' + search + '%'})` : neonSql``}
    `;

    const total = (countRows[0]?.total as number) ?? 0;

    const works: WorkRecoveryItem[] = rows.map((r) => ({
      personName:    r.person_name as string,
      workId:        r.work_id as string,
      title:         r.title as string,
      type:          r.type as string,
      source:        r.source as string,
      currentStatus: r.current_status as string,
      checkedAt:     r.checked_at ? String(r.checked_at).slice(0, 19).replace('T', ' ') : null,
      createdAt:     String(r.created_at).slice(0, 19).replace('T', ' '),
      updatedAt:     String(r.updated_at).slice(0, 19).replace('T', ' '),
    }));

    return NextResponse.json({ works, total, page, pageSize });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/admin/work-recovery
// body:
//   dryRun: boolean (default true)
//   workIds: string[]  — 対象 workId のリスト
//   personName: string — 対象人物名（workIds と組み合わせて特定）
//   targetStatus: 'auto_published' | 'needs_review' (default 'auto_published')
//   reason: string — 実行時必須
//   idempotencyKey: string — 実行時必須（二重実行防止）
//   confirmToken: string — 実行時必須。'RECOVER' と一致すること
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    dryRun        = true,
    workIds,
    personName,
    targetStatus  = 'auto_published',
    reason,
    idempotencyKey,
    confirmToken,
  } = body as {
    dryRun?:        boolean;
    workIds?:       string[];
    personName?:    string;
    targetStatus?:  string;
    reason?:        string;
    idempotencyKey?: string;
    confirmToken?:  string;
  };

  if (!personName || !workIds?.length) {
    return NextResponse.json({ error: 'personName, workIds が必要です' }, { status: 400 });
  }
  if (!VALID_TARGET_STATUSES.includes(targetStatus as WorkStatus)) {
    return NextResponse.json({ error: `targetStatus は ${VALID_TARGET_STATUSES.join(' | ')} のみ有効です` }, { status: 400 });
  }

  // ── dry-run モード ─────────────────────────────────────────────────────────
  if (dryRun) {
    try {
      const rows = await neonSql`
        SELECT person_name, id AS work_id, title, type, source, status, checked_at, created_at, updated_at
        FROM works
        WHERE person_name = ${personName}
          AND id = ANY(${workIds})
          AND source = 'manual_csv'
          AND status = 'hidden'
          AND deleted = FALSE
      `;
      const preview: WorkRecoveryItem[] = rows.map((r) => ({
        personName:    r.person_name as string,
        workId:        r.work_id as string,
        title:         r.title as string,
        type:          r.type as string,
        source:        r.source as string,
        currentStatus: r.status as string,
        checkedAt:     r.checked_at ? String(r.checked_at).slice(0, 19).replace('T', ' ') : null,
        createdAt:     String(r.created_at).slice(0, 19).replace('T', ' '),
        updatedAt:     String(r.updated_at).slice(0, 19).replace('T', ' '),
      }));
      return NextResponse.json({ dryRun: true, preview, count: preview.length });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // ── 実行モード ─────────────────────────────────────────────────────────────

  // 環境変数ゲート
  if (process.env.DATA_RECOVERY_EXECUTION_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'DATA_RECOVERY_EXECUTION_ENABLED=true が設定されていないため実行できません' },
      { status: 403 },
    );
  }

  // バリデーション
  if (!reason?.trim()) {
    return NextResponse.json({ error: '実行には reason が必要です' }, { status: 400 });
  }
  if (!idempotencyKey?.trim()) {
    return NextResponse.json({ error: '実行には idempotencyKey が必要です' }, { status: 400 });
  }
  if (confirmToken !== 'RECOVER') {
    return NextResponse.json(
      { error: 'confirmToken に "RECOVER" を入力してください' },
      { status: 400 },
    );
  }
  if (workIds.length > MAX_WORKS_PER_EXECUTE) {
    return NextResponse.json(
      { error: `一度に実行できる最大件数は ${MAX_WORKS_PER_EXECUTE} 件です` },
      { status: 400 },
    );
  }

  // 二重実行防止
  try {
    const alreadyExecuted = await hasIdempotencyKey(idempotencyKey);
    if (alreadyExecuted) {
      return NextResponse.json(
        { error: 'この idempotencyKey は既に実行済みです（二重実行防止）' },
        { status: 409 },
      );
    }
  } catch (err) {
    return NextResponse.json({ error: `idempotencyKey チェック失敗: ${String(err)}` }, { status: 500 });
  }

  // 対象作品の取得・実行
  let recovered = 0;
  const skipped: string[] = [];

  for (const workId of workIds) {
    const work = await getWork(personName, workId);
    if (!work || work.source !== 'manual_csv' || work.status !== 'hidden' || work.deleted) {
      skipped.push(workId);
      continue;
    }

    await updateWorkStatus(personName, workId, targetStatus as WorkStatus);

    // 最初の1件にのみ idempotencyKey を付与（グループ識別子として使用）
    await insertWorkStatusHistory({
      personName,
      workId,
      title:          work.title,
      workSource:     work.source,
      previousStatus: work.status,
      newStatus:      targetStatus,
      changedBy:      'admin:work-recovery',
      reason:         reason.trim(),
      idempotencyKey: recovered === 0 ? idempotencyKey : undefined,
    });

    recovered++;
  }

  return NextResponse.json({
    ok: true,
    recovered,
    skipped:       skipped.length,
    idempotencyKey,
  });
}
