import { NextRequest, NextResponse } from 'next/server';
import { getPersonWithConfigMerged } from '@/lib/persons';
import { getAllWorks, saveWork } from '@/lib/work-store';
import { fetchAiWorkSuggestions, normalizeWorkTitle } from '@/lib/work-processor';
import type { WorkRecord, WorkType } from '@/types/work';

// POST /api/admin/work-ai-supplement
// body: { personName: string, commit?: boolean }
//
// commit=false（デフォルト）: ドライラン。DBへの書き込みなし。
//   → AI補完候補を取得してプレビュー用に返す。
// commit=true: 候補をDBへ保存（source=ai_supplement, status=auto_published）。
//
// 動作仕様:
//   - 既存作品と normalizedTitle が一致する候補はスキップ
//   - workId は csv-{type}-{normalizedTitle.slice(0,32)} で自動採番
//   - source = 'ai_supplement', status = 'auto_published'
//   - VOD情報はこの処理では登録しない
//   - OpenAI API はサーバー側のみ利用（管理画面専用）

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─────────────────────────────────────────
// 型
// ─────────────────────────────────────────

export interface AiSupplementPreviewRow {
  title: string;
  type: string;         // AI返却値のまま（'movie' | 'tv'）
  releaseYear?: number;
  reason: string;
  workId: string;
  action: 'add' | 'skip';
  skipReason?: string;
}

// ─────────────────────────────────────────
// workId 生成（work-csv-import と同じルール）
// ─────────────────────────────────────────

function generateWorkId(type: WorkType, normalizedTitle: string): string {
  return `csv-${type}-${normalizedTitle.slice(0, 32)}`;
}

// ─────────────────────────────────────────
// ハンドラー
// ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    personName?: string;
    commit?: boolean;
  };

  const { personName, commit = false } = body;

  if (!personName) {
    return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });
  }

  const person = await getPersonWithConfigMerged(personName);
  if (!person) {
    return NextResponse.json({ error: `"${personName}" は登録されていない人物です` }, { status: 404 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY が設定されていません' }, { status: 500 });
  }

  // ── AI補完候補を取得（ドライラン、既存作品は除外済み） ──
  const suggestions = await fetchAiWorkSuggestions(person);

  const previewRows: AiSupplementPreviewRow[] = suggestions.map((s) => {
    const normalizedTitle = normalizeWorkTitle(s.title);
    const workId = generateWorkId(s.type as WorkType, normalizedTitle);
    return {
      title: s.title,
      type: s.type,
      releaseYear: s.releaseYear,
      reason: s.reason,
      workId,
      action: 'add' as const,
    };
  });

  const addCount = previewRows.length;

  if (!commit) {
    return NextResponse.json({ addCount, previewRows });
  }

  // ── コミット: 保存 ──
  // プレビュー取得後に別の作品が追加されている可能性があるため再チェック
  const existing = await getAllWorks(personName);
  const existingNormalized = new Set(existing.map((w) => normalizeWorkTitle(w.title)));

  const now = Date.now();
  let savedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  for (const row of previewRows) {
    const normalizedTitle = normalizeWorkTitle(row.title);

    if (existingNormalized.has(normalizedTitle)) {
      skippedCount++;
      continue;
    }
    existingNormalized.add(normalizedTitle);

    const work: WorkRecord = {
      id: row.workId,
      personName,
      title: row.title,
      normalizedTitle,
      type: row.type as WorkType,
      source: 'ai_supplement',
      releaseYear: row.releaseYear,
      roleName: undefined,
      confidenceScore: 60,
      status: 'auto_published',
      aiReason: row.reason,
      usedAi: true,
      vodProviders: [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveWork(work);
      savedCount++;
    } catch (err) {
      errors.push(`「${row.title}」: ${String(err)}`);
    }
  }

  const failedCount = previewRows.length - savedCount - skippedCount;
  return NextResponse.json({ savedCount, skippedCount, failedCount, errors });
}
