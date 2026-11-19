// 作品ページの OGP／SNS 共有用画像（D-1共通デザイン・1200×630 PNG）。
//   GET /work/[workId]/og
// - 作品画像の表示設定が「D-1共通デザイン」のときだけ、作品ページの og:image・twitter:image・
//   JSON-LD の image がこの URL を指す（従来画像表示のときは使われない）。
// - 作品名・種類・公開年だけを描く。外部の作品画像（TMDb・OG・手動画像）は読み込まない。
// - /api/ は robots.txt でクロール禁止のため、X 等のクローラーが取得できるこの場所から配信する
//   （/oshi-vod/og と同じ）。画像自体は検索結果に出さない（X-Robots-Tag: noindex）。
import { ImageResponse } from 'next/og';
import { getPublicWorkById } from '@/lib/work-store';
import { getDisplayWorkType, DISPLAY_WORK_TYPE_LABEL } from '@/lib/work-display-type';
import { getNotoSansJpBoldFontData } from '@/server/instagram-post/fonts/font-loader';
import { WorkD1OgImage, WORK_D1_OG_SIZE } from '@/server/work-d1/og-image';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ workId: string }> }) {
  const { workId: rawWorkId } = await params;
  const workId = decodeURIComponent(rawWorkId);
  let work: Awaited<ReturnType<typeof getPublicWorkById>>;
  try {
    work = await getPublicWorkById(workId);
  } catch (err) {
    console.error('[work-og] 作品の読み込みに失敗しました:', String(err));
    return new Response('error', { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!work) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

  const image = new ImageResponse(
    <WorkD1OgImage
      title={work.title}
      typeLabel={DISPLAY_WORK_TYPE_LABEL[getDisplayWorkType(work)]}
      releaseYear={work.releaseYear}
    />,
    {
      ...WORK_D1_OG_SIZE,
      fonts: [{ name: 'Noto Sans JP', data: getNotoSansJpBoldFontData(), weight: 700, style: 'normal' }],
      headers: {
        // 作品名・種類・公開年はほとんど変わらないため CDN で1日キャッシュ（変更後も最大1日で作り直される）
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
        'X-Robots-Tag': 'noindex',
      },
    },
  );
  return image;
}
