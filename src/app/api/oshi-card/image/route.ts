// 推し布教カードの画像（PNG）。
//   GET /api/oshi-card/image?p=人物&w=作品id&w=作品id[&v=cute][&ph=フレーズ][&size=story|og]
// - 作成画面のプレビュー・画像保存・端末の共有で使う。X・LINE のカード画像は /oshi-card/og（同じ処理）。
// - 入力検証・正規化・キャッシュ・アクセス上限は server/oshi-card/image-response.ts。
// - /api/ 配下のため robots.txt で既にクロール対象外。
import type { NextRequest } from 'next/server';
import { buildOshiCardImagePath } from '@/lib/oshi-card/params';
import { respondOshiCardImage } from '@/server/oshi-card/image-response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return respondOshiCardImage(req, { buildPath: (sel, size) => buildOshiCardImagePath(sel, size) });
}
