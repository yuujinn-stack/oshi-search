// 推し布教カードのURL（/oshi-card?p=...&w=...）を X・LINE に貼ったときのカード画像（og:image・1200×630）。
//   GET /oshi-card/og?p=人物&w=作品id[&w=…][&v=cute][&ph=フレーズ]
// - /oshi-card の generateMetadata が完成カードのURLにだけ指定する（/oshi-card 本体は静的OG）。
// - /api/ は robots.txt でクロール禁止のため、X 等のクローラーが取得できるこの場所から配信する。画像は noindex。
import type { NextRequest } from 'next/server';
import { buildOshiCardOgImagePath } from '@/lib/oshi-card/params';
import { respondOshiCardImage } from '@/server/oshi-card/image-response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return respondOshiCardImage(req, { fixedSize: 'og', noindex: true, buildPath: (sel) => buildOshiCardOgImagePath(sel) });
}
