import { NextRequest, NextResponse } from 'next/server';
import {
  prepareScheduleContent,
  InsufficientWorksError,
  PersonPhotoMissingError,
  UnknownTemplateError,
  NoEligibleTemplateError,
} from '@/server/instagram-schedule/prepare';
import { PersonNotFoundError } from '@/server/instagram-post/person-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 画像生成はnext/og（Satori+Resvg）のため長時間のChromium起動は発生しないが、
// 作品画像のダウンロード等を含め余裕を見て60秒とする（/api/admin/instagram-post/generateと同じ）。
export const maxDuration = 60;

/** 予約登録前の内容確定（人物選択→3枚生成→Blobアップロード→キャプション/ハッシュタグ生成）。DBへはまだ保存しない */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const personName = typeof body.personName === 'string' ? body.personName.trim() : '';
  const templateId = typeof body.templateId === 'string' && body.templateId.trim() ? body.templateId.trim() : 'default-person';
  const previousTemplateId = typeof body.previousTemplateId === 'string' && body.previousTemplateId.trim()
    ? body.previousTemplateId.trim()
    : undefined;

  if (!personName) {
    return NextResponse.json({ error: '人物名が指定されていません' }, { status: 400 });
  }

  try {
    const result = await prepareScheduleContent(personName, templateId, previousTemplateId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PersonNotFoundError) {
      return NextResponse.json({ error: err.message, code: 'PERSON_NOT_FOUND' }, { status: 404 });
    }
    if (err instanceof PersonPhotoMissingError) {
      return NextResponse.json({ error: err.message, code: 'PERSON_PHOTO_MISSING' }, { status: 422 });
    }
    if (err instanceof InsufficientWorksError) {
      return NextResponse.json({ error: err.message, code: 'INSUFFICIENT_WORKS' }, { status: 422 });
    }
    if (err instanceof NoEligibleTemplateError) {
      return NextResponse.json({ error: err.message, code: 'NO_ELIGIBLE_TEMPLATE' }, { status: 422 });
    }
    if (err instanceof UnknownTemplateError) {
      return NextResponse.json({ error: err.message, code: 'UNKNOWN_TEMPLATE' }, { status: 400 });
    }
    return NextResponse.json(
      { error: `投稿内容の準備に失敗しました: ${err instanceof Error ? err.message : String(err)}`, code: 'PREPARE_FAILED' },
      { status: 500 },
    );
  }
}
