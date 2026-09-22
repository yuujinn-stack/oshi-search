import { NextRequest, NextResponse } from 'next/server';
import { createSchedule, listSchedules, getScheduleStatusCounts } from '@/server/instagram-schedule/schedule-store';
import { getInstagramTemplateMeta } from '@/lib/instagram-templates';
import { maskSecrets } from '@/lib/mask-secrets';

export const dynamic = 'force-dynamic';

/**
 * 予約一覧（直近200件、予定日時の昇順）＋status別件数（サマリーカード用、DB側で集計）。
 * errorMessageは万一外部APIレスポンス由来の秘密情報らしき文字列が混ざっていた場合に備え、
 * クライアントへ返す前に防御的にマスクする（保存データ自体は変更しない）。
 */
export async function GET() {
  try {
    const [schedules, statusCounts] = await Promise.all([listSchedules(), getScheduleStatusCounts()]);
    const maskedSchedules = schedules.map((s) => ({ ...s, errorMessage: maskSecrets(s.errorMessage) }));
    return NextResponse.json({ schedules: maskedSchedules, statusCounts });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

interface CreateScheduleBody {
  personName?: string;
  templateId?: string;
  scheduledAtIso?: string; // UTCのISO文字列（クライアント側でJST壁時計から変換済み）
  caption?: string;
  hashtags?: string;
  imageUrls?: string[];
}

/**
 * 予約登録。/prepare で完成させた画像URL・キャプション・ハッシュタグをそのまま保存する
 * （ここでは画像の再生成もInstagramへのアクセスも一切行わない。DB書き込みのみ）。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as CreateScheduleBody;

  const personName = body.personName?.trim();
  const templateId = body.templateId?.trim();
  const scheduledAtIso = body.scheduledAtIso?.trim();
  const caption = body.caption ?? '';
  const hashtags = body.hashtags ?? '';
  const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.filter((u) => typeof u === 'string') : [];

  if (!personName) return NextResponse.json({ error: '人物名が指定されていません' }, { status: 400 });
  if (!templateId || !getInstagramTemplateMeta(templateId)) {
    return NextResponse.json({ error: '未知のテンプレートIDです' }, { status: 400 });
  }
  if (!scheduledAtIso) return NextResponse.json({ error: '予約日時が指定されていません' }, { status: 400 });
  if (imageUrls.length !== 3) return NextResponse.json({ error: '投稿画像は3枚である必要があります' }, { status: 400 });

  const scheduledAt = new Date(scheduledAtIso);
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: '予約日時の形式が不正です' }, { status: 400 });
  }
  // 過去日時の予約は不可（サーバー側でも必ず検証する。クライアント側の判定はバイパス可能なため）
  if (scheduledAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: '過去の日時は予約できません' }, { status: 400 });
  }

  try {
    const schedule = await createSchedule({
      personId: personName,
      personName,
      templateId,
      scheduledAt,
      caption,
      hashtags,
      imageUrls,
    });
    return NextResponse.json({ schedule });
  } catch (err) {
    return NextResponse.json(
      { error: `予約の登録に失敗しました: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
