import { NextRequest, NextResponse } from 'next/server';
import { createCarouselAndPublish } from '@/server/instagram-post/publish';
import { InstagramConfigError } from '@/server/instagram-post/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

interface PublishRequestBody {
  personName?: unknown;
  imageUrls?: unknown;
  caption?: unknown;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as PublishRequestBody;

  const personName = typeof body.personName === 'string' ? body.personName.trim() : '';
  const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls : [];
  const caption = typeof body.caption === 'string' ? body.caption : '';

  if (!personName) {
    return NextResponse.json({ error: '人物名が指定されていません' }, { status: 400 });
  }
  if (imageUrls.length !== 3 || !imageUrls.every((u) => typeof u === 'string' && u.startsWith('https://'))) {
    return NextResponse.json({ error: '投稿画像のURLが3件そろっていません' }, { status: 400 });
  }
  if (!caption) {
    return NextResponse.json({ error: 'キャプションが空です' }, { status: 400 });
  }

  try {
    const result = await createCarouselAndPublish(
      personName,
      imageUrls as [string, string, string],
      caption,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof InstagramConfigError) {
      // 設定不足（トークン未設定等）。値そのものは含めない。
      return NextResponse.json({ error: err.message, code: 'CONFIG_MISSING' }, { status: 500 });
    }
    // Graph APIエラーを含め、メッセージのみをクライアントへ返す
    // （トークン等の秘密情報がレスポンスに含まれないようにするため、レスポンス本文全体は返さない）。
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Instagramへの投稿に失敗しました: ${message}`, code: 'PUBLISH_FAILED' }, { status: 502 });
  }
}
