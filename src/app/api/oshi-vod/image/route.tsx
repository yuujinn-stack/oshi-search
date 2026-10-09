// 推しに合うサブスク診断の結果画像（PNG）。
//   GET /api/oshi-vod/image?p=人物名&p=人物名[&size=feed|story]
// - 計算は結果ページと同じ loadOshiVodDiagnosis（core.ts）を使うため、ページと数値が一致する。
// - 入力は公開人物として存在する名前だけ・最大12人に制限する（任意文字列の描画はしない）。
// - /api/ 配下のため robots.txt で既にクロール対象外。CDNで短時間キャッシュする。
import { ImageResponse } from 'next/og';
import { NextRequest, NextResponse } from 'next/server';
import { getOshiVodKnownPersons, loadOshiVodDiagnosis } from '@/lib/oshi-vod/data';
import { OSHI_VOD_IMAGE_SIZES, parseImageSize, parseOshiVodParams, resolveKnownNames } from '@/lib/oshi-vod/params';
import { buildOshiVodImageData } from '@/lib/oshi-vod/image-data';
import { buildOshiVodImageElement, OSHI_VOD_IMAGE_FONT_FAMILY } from '@/server/oshi-vod/result-image';
import { getNotoSansJpBoldFontData } from '@/server/instagram-post/fonts/font-loader';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = parseOshiVodParams({ p: sp.getAll('p') });
  const size = parseImageSize(sp.get('size'));
  const known = await getOshiVodKnownPersons();
  const { valid } = resolveKnownNames(parsed.names, new Set(known.keys()));
  if (valid.length === 0) {
    return NextResponse.json({ error: 'no valid persons' }, { status: 400 });
  }

  try {
    const result = await loadOshiVodDiagnosis(valid);
    const { width, height } = OSHI_VOD_IMAGE_SIZES[size];
    return new ImageResponse(buildOshiVodImageElement(buildOshiVodImageData(result), size), {
      width,
      height,
      fonts: [{ name: OSHI_VOD_IMAGE_FONT_FAMILY, data: getNotoSansJpBoldFontData(), weight: 700, style: 'normal' }],
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[oshi-vod/image] failed:', String(err));
    return NextResponse.json({ error: 'failed to render' }, { status: 500 });
  }
}
