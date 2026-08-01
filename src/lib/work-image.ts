// 作品のメイン画像（サムネイル・OG画像）をどのソースから使うか決める共通ロジック（純粋関数）。
// 公開ページ（WorkCard.tsx・/work/[workId]）・管理画面（work-check）のすべてがこの1関数を
// 使うことで、優先順位が画面ごとに食い違うことを防ぐ。
//
// 優先順位:
//   1. manualImageUrl（管理者が手動設定した画像URL）
//   2. posterUrl（TMDbから取得したposter_path/backdrop_path）
//   3. ogImageUrl（既存の自動取得画像。YouTube/公式ページ等から scrape したog:image）
//   4. なし（呼び出し側が作品種別ごとのプレースホルダーを表示する）
//
// VODプロバイダーのロゴ（logoPath）はここでは一切扱わない。ロゴは配信バッジ専用
// （ProviderLogoコンポーネント）であり、作品のメイン画像・OG画像としては使用しない。
export type WorkImageSource = 'manual' | 'tmdb' | 'auto' | 'none';

export interface WorkImageInput {
  manualImageUrl?: string;
  posterUrl?: string;
  ogImageUrl?: string;
}

export function getWorkDisplayImage(work: WorkImageInput): string | undefined {
  return work.manualImageUrl || work.posterUrl || work.ogImageUrl || undefined;
}

export function getWorkDisplayImageSource(work: WorkImageInput): WorkImageSource {
  if (work.manualImageUrl) return 'manual';
  if (work.posterUrl) return 'tmdb';
  if (work.ogImageUrl) return 'auto';
  return 'none';
}

// 画像URLとして許容できる形式か（http/https の絶対URLのみ）。
// 画像として実際に読み込めるかどうか（Content-Type等）はここでは検証しない
// （保存時にネットワーク往復を発生させないため。壊れた画像は表示側の onError で判別される）。
export function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
