// 推しに合うサブスク診断の結果画像（PNG）。
//   GET /api/oshi-vod/image?p=人物名&p=人物名[&size=feed|story|og][&v=cool|cute]
// - 結果ページのプレビュー・画像保存・端末の共有で使う。X・LINE のカード画像は /oshi-vod/og（同じ処理）。
// - v はデザイン（かっこいい／可愛い）。見た目だけが変わり、載せる情報・数値は同じ。
// - 計算は結果ページと同じ loadOshiVodDiagnosis（core.ts）を使うため、ページと数値が一致する。
// - 入力検証・正規化・キャッシュ・アクセス上限は server/oshi-vod/image-response.ts。
// - /api/ 配下のため robots.txt で既にクロール対象外。
import type { NextRequest } from 'next/server';
import { buildOshiVodImagePath } from '@/lib/oshi-vod/params';
import { respondOshiVodImage } from '@/server/oshi-vod/image-response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return respondOshiVodImage(req, { buildPath: ({ names, size, variant }) => buildOshiVodImagePath(names, size, variant) });
}
