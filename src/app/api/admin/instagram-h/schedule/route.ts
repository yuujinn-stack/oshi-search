import { NextRequest, NextResponse } from 'next/server';
import { createSchedule } from '@/server/instagram-schedule/schedule-store';
import { getPersonWithConfigMerged } from '@/lib/persons';
import { H_TEMPLATE_ID } from '@/lib/instagram-templates';
import { validateHScheduleInput } from '@/server/instagram-post/site-ui/h-schedule';

export const dynamic = 'force-dynamic';

interface Body {
  personName?: string;
  scheduledAtIso?: string; // UTCのISO文字列（クライアント側でJST壁時計から変換済み）
  caption?: string;
  hashtags?: string;
  imageUrls?: string[];
}

/**
 * H「観るもの・買うもの、まとめて」の予約登録。/api/admin/instagram-h/preview で生成・確認した3枚の画像URLと、
 * 管理画面で確認・編集したキャプションを、既存の createSchedule で instagram_post_schedules に保存する。
 * 保存後の投稿は既存のCron（/api/cron/instagram-publish）が、保存済みの画像・キャプションでカルーセル投稿する。
 * ここでは画像の再生成もInstagramへのアクセスも行わない（DB書き込みのみ）。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const personName = body.personName?.trim() ?? '';
  const input = {
    personName,
    imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.filter((u): u is string => typeof u === 'string') : [],
    caption: body.caption ?? '',
    hashtags: body.hashtags ?? '',
    scheduledAt: new Date(body.scheduledAtIso ?? ''),
  };
  const invalid = validateHScheduleInput(input);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const person = await getPersonWithConfigMerged(personName);
  if (!person) return NextResponse.json({ error: `人物が見つかりません: ${personName}` }, { status: 404 });

  try {
    const schedule = await createSchedule({
      personId: person.name,
      personName: person.name,
      templateId: H_TEMPLATE_ID,
      scheduledAt: input.scheduledAt,
      caption: input.caption,
      hashtags: input.hashtags,
      imageUrls: input.imageUrls,
    });
    return NextResponse.json({ schedule });
  } catch (err) {
    return NextResponse.json({ error: `予約の登録に失敗しました: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
