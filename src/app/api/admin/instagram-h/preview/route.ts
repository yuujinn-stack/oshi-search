import { NextRequest, NextResponse } from 'next/server';
import { SITE_UI_BUILDERS } from '@/server/instagram-post/site-ui/builders';
import { InsufficientWorksError } from '@/server/instagram-post/build-post';
import { PersonNotFoundError } from '@/server/instagram-post/person-data';
import { H_TEMPLATE_ID } from '@/lib/instagram-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * H「観るもの・買うもの、まとめて」の3枚を生成する（人物は管理画面で人が選ぶ）。
 *
 * 既存の予約用生成（/api/admin/instagram-schedule/prepare）と同じく、画像はVercel Blob（ig-posts/）へ
 * アップロードし、その公開URLを返す。管理画面ではこのURLの画像をPreviewとして確認し、予約時はこの同じURLを
 * instagram_post_schedules に保存する（投稿時刻に再生成しないため、Previewと実際の投稿画像が一致する）。
 * Instagram APIへのアクセス・DBへの書き込みはしない。
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const personName = typeof body.personName === 'string' ? body.personName.trim() : '';
  if (!personName) return NextResponse.json({ error: '人物名が指定されていません' }, { status: 400 });

  try {
    const result = await SITE_UI_BUILDERS[H_TEMPLATE_ID](personName);
    return NextResponse.json({
      personName: result.personName,
      templateId: H_TEMPLATE_ID,
      images: result.images,
      caption: result.caption,
      hashtags: result.hashtags,
    });
  } catch (err) {
    if (err instanceof PersonNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof InsufficientWorksError) return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json({ error: `生成に失敗しました: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
