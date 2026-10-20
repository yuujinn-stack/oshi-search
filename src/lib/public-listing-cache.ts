// トップ・ジャンル一覧・写真集のキャッシュ（1時間）を、元データの変更時に即時に無効化する。
//
// トップ（/）・ジャンル（/genre/[genre]）は revalidate=3600、写真集の集計結果は unstable_cache（3600秒）。
// 管理画面・自動更新から人物・人物メタ・グループ・作品（配信）・商品・判定・写真集設定を書き込んだときに
// src/db/write.ts 等の書き込み関数から呼ばれ、次の表示で最新の内容に作り直させる
// （以前の60秒ごとの作り直しと同じく、変更は速やかに反映される）。
//
// Next.js のリクエスト外（GitHub Actions の価格更新・ローカルのスクリプト・テスト）や、
// 再検証を呼べない場面では何もしない（例外を握りつぶし、書き込み処理そのものは失敗させない）。
// 同じリクエスト内で何度呼んでも、Next.js 側で重複は1回にまとめられる。
import { revalidatePath, revalidateTag } from 'next/cache';

export const PUBLIC_LISTING_CACHE_TAG = 'public-listing';

/** トップ・ジャンル一覧・写真集のキャッシュの保持時間（秒） */
export const PUBLIC_LISTING_REVALIDATE_SECONDS = 3600;

export function revalidatePublicListings(): void {
  try {
    revalidateTag(PUBLIC_LISTING_CACHE_TAG, { expire: 0 });
    revalidatePath('/');
    revalidatePath('/genre/[genre]', 'page');
  } catch {
    // リクエスト外・描画中など、再検証できない場面では何もしない
  }
}
