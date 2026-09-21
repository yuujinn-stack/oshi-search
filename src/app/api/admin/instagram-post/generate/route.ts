import { NextRequest, NextResponse } from 'next/server';
import { buildInstagramPost, InsufficientWorksError, PersonPhotoMissingError } from '@/server/instagram-post/build-post';
import { PersonNotFoundError } from '@/server/instagram-post/person-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// next/og（Satori+Resvg）ベースの画像生成に変更し、Playwright/Chromiumへの依存を
// なくしたため、以前必要だった長いmaxDuration（Chromiumのコールドスタート対策）は
// 不要になった。作品画像のダウンロード等を含めても数秒〜十数秒で完了する想定のため、
// 余裕を見て60秒としている。
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const personName = typeof body.personName === 'string' ? body.personName.trim() : '';
  if (!personName) {
    return NextResponse.json({ error: '人物名が指定されていません' }, { status: 400 });
  }

  try {
    const result = await buildInstagramPost(personName);
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
    return NextResponse.json(
      { error: `投稿画像の生成に失敗しました: ${err instanceof Error ? err.message : String(err)}`, code: 'GENERATE_FAILED' },
      { status: 500 },
    );
  }
}
