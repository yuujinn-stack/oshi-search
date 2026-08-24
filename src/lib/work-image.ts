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
//
// ── 候補選択とレンダリング用URL変換は別の関数に分離する ──────────────────────────
// getWorkDisplayImage(work)         : どのフィールドの値を採用するか（優先順位・妥当性チェック込み）
// getRenderableWorkImageUrl(url)    : 選ばれたDB上の生URLを、そのままブラウザへ渡してよい形へ整える
// （HTMLエンティティの誤混入を復元するのみ。プロキシ経由にする必要が生じた場合もこの1箇所を
//   変更すればよいよう、意図的に分離してある）
export type WorkImageSource = 'manual' | 'tmdb' | 'auto' | 'none';

export interface WorkImageInput {
  manualImageUrl?: string;
  posterUrl?: string;
  ogImageUrl?: string;
}

// 画像URLとして許容できる形式か（http/https の絶対URLのみ）。
export function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// 公式配信サービスのCDNなど、実際には有効な画像だが無許諾転載を避けるため公開ページの
// 画像として使用しない発信元。ogImageUrl（各作品のsourceUrl/officialUrlページから自動取得した
// og:image）や manualImageUrl（管理者が手動入力したURL）が、配信サービス自身の公式ページの
// og:imageをそのまま指してしまうケースへの対策。TMDb画像（image.tmdb.org）は対象外。
// Disney+のみが対象（bamgrid.comはDisney Streaming／Disney+の配信基盤CDN）。他社のCDNを
// 追加する場合も、必ずその会社の画像利用ポリシーを確認した上でここに追記すること。
const RESTRICTED_IMAGE_HOSTNAME_SUFFIXES = ['bamgrid.com'];

function isRestrictedOfficialCdnUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return RESTRICTED_IMAGE_HOSTNAME_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

// 「形式は正しいURLだが、画像候補として採用すべきでないもの」を除外する。
// 実際に発生した事例: Google画像検索の結果一覧からブラウザで「画像アドレスをコピー」した際、
// 直接の画像URL（imgurlパラメータの値）ではなく検索結果ページ自体（/imgres?...）のURLが
// コピーされてしまい、そのまま手動画像URLとして保存されるケースがあった。/imgres はHTML
// ページを返すため<img>には表示できない。DBの値自体は変更せず、表示時にこの候補をスキップして
// 次の優先順位（TMDb画像・自動取得OG画像）へフォールバックすることで解決する。
// 同様に、配信サービス公式CDN（RESTRICTED_IMAGE_HOSTNAME_SUFFIXES）のURLも、画像としては
// 有効だが無許諾転載を避けるためここでスキップし、次点（TMDb画像・画像なし）へフォールバックする。
export function isPlausibleImageUrl(url: string): boolean {
  if (!isValidImageUrl(url)) return false;
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.toLowerCase();
    if ((host === 'google.com' || host.endsWith('.google.com')) &&
        (pathname === '/imgres' || pathname.startsWith('/search'))) {
      return false;
    }
    if ((host === 'bing.com' || host.endsWith('.bing.com')) && pathname.startsWith('/images/search')) {
      return false;
    }
  } catch {
    return false;
  }
  if (isRestrictedOfficialCdnUrl(url)) return false;
  return true;
}

// 優先順位に沿って候補を順に評価し、実際に画像として表示できる見込みのある最初の候補を返す。
// 「値は入っているが検索結果ページ等で画像として使えない」候補はスキップし、次点へフォールバック
// する（DBの値そのものは一切変更しない。表示時の選択をスキップするだけ）。
export function getWorkDisplayImage(work: WorkImageInput): string | undefined {
  const candidates = [work.manualImageUrl, work.posterUrl, work.ogImageUrl];
  for (const c of candidates) {
    if (c && isPlausibleImageUrl(c)) return c;
  }
  return undefined;
}

export function getWorkDisplayImageSource(work: WorkImageInput): WorkImageSource {
  if (work.manualImageUrl && isPlausibleImageUrl(work.manualImageUrl)) return 'manual';
  if (work.posterUrl && isPlausibleImageUrl(work.posterUrl)) return 'tmdb';
  if (work.ogImageUrl && isPlausibleImageUrl(work.ogImageUrl)) return 'auto';
  return 'none';
}

// getWorkDisplayImage() が選んだ生のDB値を、<img src>・OGタグへそのまま渡せる形へ整える。
// CSV取り込み等で混入したHTMLエンティティ（&amp; 等）をデコードするのみで、それ以外は
// DBの値をそのまま使う（プロキシは経由しない。将来必要になった場合もこの関数の内部実装を
// 差し替えるだけで済むよう、候補選択（getWorkDisplayImage）とは意図的に分離している）。
const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

export function getRenderableWorkImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/&amp;|&quot;|&#39;|&apos;|&lt;|&gt;/g, (m) => HTML_ENTITY_MAP[m]);
}
