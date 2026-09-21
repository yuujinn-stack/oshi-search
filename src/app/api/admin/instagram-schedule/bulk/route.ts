import { NextRequest, NextResponse } from 'next/server';
import { createSchedulesBatch, SlotConflictError } from '@/server/instagram-schedule/schedule-store';
import { getInstagramTemplateMeta } from '@/lib/instagram-templates';

export const dynamic = 'force-dynamic';

interface BulkItem {
  personName?: string;
  templateId?: string;
  scheduledAtIso?: string;
  caption?: string;
  hashtags?: string;
  imageUrls?: string[];
}

/**
 * 一括予約の確定登録。画像生成・Instagram APIへのアクセスは一切行わない
 * （プレビュー段階で既に生成済みの画像URL・キャプションをそのままDBへ保存するだけ）。
 * 既存の単発予約（POST /api/admin/instagram-schedule）とは別経路の、
 * 複数件まとめてINSERTするためだけのエンドポイント。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { items?: BulkItem[] };
  const items = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) {
    return NextResponse.json({ error: '予約する項目が指定されていません' }, { status: 400 });
  }

  const inputs: { personId: string; personName: string; templateId: string; scheduledAt: Date; caption: string; hashtags: string; imageUrls: string[] }[] = [];

  for (const [i, item] of items.entries()) {
    const personName = item.personName?.trim();
    const templateId = item.templateId?.trim();
    const scheduledAtIso = item.scheduledAtIso?.trim();
    const imageUrls = Array.isArray(item.imageUrls) ? item.imageUrls.filter((u) => typeof u === 'string') : [];

    if (!personName) return NextResponse.json({ error: `${i + 1}件目: 人物名が指定されていません` }, { status: 400 });
    if (!templateId || !getInstagramTemplateMeta(templateId)) {
      return NextResponse.json({ error: `${i + 1}件目（${personName}）: 未知のテンプレートIDです` }, { status: 400 });
    }
    if (!scheduledAtIso) return NextResponse.json({ error: `${i + 1}件目（${personName}）: 予約日時が指定されていません` }, { status: 400 });
    if (imageUrls.length !== 3) {
      return NextResponse.json({ error: `${i + 1}件目（${personName}）: 投稿画像は3枚である必要があります` }, { status: 400 });
    }

    const scheduledAt = new Date(scheduledAtIso);
    if (Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ error: `${i + 1}件目（${personName}）: 予約日時の形式が不正です` }, { status: 400 });
    }
    if (scheduledAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: `${i + 1}件目（${personName}）: 過去の日時は予約できません` }, { status: 400 });
    }

    inputs.push({
      personId: personName,
      personName,
      templateId,
      scheduledAt,
      caption: item.caption ?? '',
      hashtags: item.hashtags ?? '',
      imageUrls,
    });
  }

  try {
    const schedules = await createSchedulesBatch(inputs);
    return NextResponse.json({ schedules });
  } catch (err) {
    if (err instanceof SlotConflictError) {
      return NextResponse.json({ error: err.message, conflicts: err.conflicts }, { status: 409 });
    }
    return NextResponse.json(
      { error: `一括予約の登録に失敗しました: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
