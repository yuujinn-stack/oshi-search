// 診断結果URL（/oshi-vod?p=...&sv=cool|cute）を X・LINE に貼ったときのカード画像（og:image・1200×630）。
//   GET /oshi-vod/og?p=人物名&p=人物名[&v=cute]
// - /oshi-vod の generateMetadata が結果URLにだけ指定する（/oshi-vod 本体は従来の静的OGのまま）。
// - /api/ は robots.txt でクロール禁止のため、X 等のクローラーが取得できるこの場所から配信する。
//   画像自体は検索結果に出さない（X-Robots-Tag: noindex）。
// - 入力検証・正規化・キャッシュ・アクセス上限は /api/oshi-vod/image と共通（server/oshi-vod/image-response.ts）。
import type { NextRequest } from 'next/server';
import { buildOshiVodOgImagePath } from '@/lib/oshi-vod/params';
import { respondOshiVodImage } from '@/server/oshi-vod/image-response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return respondOshiVodImage(req, {
    fixedSize: 'og',
    noindex: true,
    buildPath: ({ names, variant }) => buildOshiVodOgImagePath(names, variant),
  });
}
