/**
 * 人物の「今見たい作品3選」選定ロジック（movie/drama判定・VOD優先・新しい順・
 * 画像利用可否チェック）。
 *
 * 元々 generate-csv.ts（Canva一括作成ツール）にのみ定義されていたロジックを、
 * 他の場所（instagram-post-generator用の読み取り専用エクスポートスクリプト、
 * および将来的な管理画面のInstagram投稿機能）からも重複なく再利用できるよう、
 * 純粋なデータ選定部分のみをこのファイルへ切り出したもの。
 * ロジック・挙動は一切変更していない（generate-csv.tsからのコピー＆export化のみ）。
 *
 * 既存サイトのDB読み取り専用関数のみを使用する（INSERT/UPDATE/DELETEは一切行わない）。
 * このファイルはPlaywright/ExcelJS/sharp等の重い依存を一切importしない
 * （Next.jsのサーバーサイドバンドルから安全に使えるようにするため）。
 */
import { getPublishedWorks } from '@/lib/work-store';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { filterPublicVodProviders, getVodProviderDisplayInfo } from '@/lib/vod-dedup';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';
import { getDisplayWorkTypeTrace } from '@/lib/work-display-type';
import { VOD_TYPE_ORDER } from '@/lib/vod-cta';
import type { WorkRecord } from '@/types/work';
import type { VodProvider } from '@/types/vod';

// 「今見たい作品3選」の対象ジャンル。既存サイトの構造化分類（getDisplayWorkType）を
// タイトル文字列判定より優先して使う。ライブ・音楽番組・バラエティ・配信番組(Web)・
// アイドル番組・舞台・ドキュメンタリー・アニメ声優等（グループ主体のコンテンツを含む）は
// 意図的に対象外とする。
export const ELIGIBLE_DISPLAY_TYPES = new Set(['movie', 'drama']);

export const MAX_WORKS = 3;
export const MAX_VOD_SERVICES_PER_WORK = 2;

// ─── VOD表示文字列（サービス名のみ、最大2件を " / " で連結） ─────────────────────
export function buildVodDisplayString(providers: VodProvider[]): string {
  const sorted = [...providers].sort(
    (a, b) => (VOD_TYPE_ORDER[a.type] ?? 9) - (VOD_TYPE_ORDER[b.type] ?? 9),
  );
  const names: string[] = [];
  const seen = new Set<string>();
  for (const p of sorted) {
    const displayName = getVodProviderDisplayInfo(p.providerName).displayName;
    if (seen.has(displayName)) continue;
    seen.add(displayName);
    names.push(displayName);
    if (names.length >= MAX_VOD_SERVICES_PER_WORK) break;
  }
  return names.join(' / ');
}

// ─── Canva用画像URLの利用可否チェック ────────────────────────────────────────────
// 作品のランキング・選定順位（movie/drama判定・VOD優先・新しい順）には一切影響しない、
// 「選ばれた候補の画像が実際にCanvaで使えるか」だけを見る独立したチェック。
// ここで不適合と判定された作品は selected に入れず、次点の候補へ繰り上げる。

// 既知の「作品固有ではない汎用OGP画像」の完全一致デノリスト。
// 「監察医 朝顔2025新春スペシャル」調査で判明: FODサイト共通のロゴ画像で、
// 作品ごとに変わらず内容と無関係なため常に不採用とする。
const GENERIC_OGP_URL_DENYLIST = new Set<string>([
  'https://i.fod.fujitv.co.jp/img/ogp_img/ogp.jpg',
]);

export function isUsableCanvaImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;

  let hostname = '';
  try {
    hostname = new URL(trimmed).hostname.toLowerCase();
  } catch {
    return false; // URLとして解釈できない値は不採用
  }

  // Google画像検索のサムネイルプロキシ（例: encrypted-tbn0.gstatic.com）
  if (hostname === 'gstatic.com' || hostname.endsWith('.gstatic.com')) return false;

  // ホストに関わらず、Google画像検索サムネイル特有のURLパターン（tbn:/tbm=等）を含むものは不採用
  if (/[?&](q=tbn:|tbm=)/i.test(trimmed)) return false;

  // 既知の「作品固有ではない汎用OGP画像」を除外
  if (GENERIC_OGP_URL_DENYLIST.has(trimmed)) return false;

  return true;
}

// ─── 3作品の選定 ────────────────────────────────────────────────────────────────
// 優先順位: 0) 映画・ドラマ（配信ドラマ含む）のみを対象とし、それ以外
//              （ライブ・音楽番組・バラエティ・配信番組/Web・アイドル番組・舞台・
//              ドキュメンタリー・アニメ声優等）は除外する
//              （既存の getDisplayWorkType/getDisplayWorkTypeTrace による構造化分類を
//              タイトル文字列の独自判定より優先して利用する）
//           1) 現在有効なVOD配信先が確認できる作品を優先
//           2) releaseYearが新しい順
//           3) 同一タイトル（トリム後の完全一致）は重複除外し、先に選ばれた方を残す
export interface SelectedWork {
  work: WorkRecord;
  confirmedProviders: VodProvider[];
  displayType: string;
  displayTypeRule: string;
}

export interface SelectionResult {
  selected: SelectedWork[];
  /** 除外された作品のうち、releaseYearが新しい上位N件（レポート・デバッグ用） */
  excludedTop: SelectedWork[];
  /** movie/drama候補ではあったが、画像がCanvaで使えないため飛ばされた作品（ログ表示用） */
  imageRejected: SelectedWork[];
}

export async function selectTopWorks(personName: string): Promise<SelectionResult> {
  const [works, terminatedSlugs] = await Promise.all([
    getPublishedWorks(personName),
    getInactiveProviderSlugs(),
  ]);

  const withVodInfo = works.map((work) => {
    const trace = getDisplayWorkTypeTrace(work);
    return {
      work,
      confirmedProviders: filterPublicVodProviders(work.vodProviders ?? [], terminatedSlugs),
      displayType: trace.result,
      displayTypeRule: trace.rule,
    };
  });

  const eligible = withVodInfo.filter((item) => ELIGIBLE_DISPLAY_TYPES.has(item.displayType));
  const excluded = withVodInfo.filter((item) => !ELIGIBLE_DISPLAY_TYPES.has(item.displayType));

  const sortByVodThenYear = (a: SelectedWork, b: SelectedWork) => {
    const aHasVod = a.confirmedProviders.length > 0;
    const bHasVod = b.confirmedProviders.length > 0;
    if (aHasVod !== bHasVod) return aHasVod ? -1 : 1;
    const aYear = a.work.releaseYear ?? -1;
    const bYear = b.work.releaseYear ?? -1;
    return bYear - aYear;
  };

  eligible.sort(sortByVodThenYear);
  excluded.sort(sortByVodThenYear);

  // 順位付け（movie/drama判定・VOD優先・新しい順）は eligible の並び順としてすでに
  // 確定済み。ここでは並び順を変えず、先頭から順に見ていき、画像が使えない候補だけ
  // 読み飛ばして次点を繰り上げる（重複タイトル除外は既存のまま維持）。
  const seenTitles = new Set<string>();
  const selected: SelectedWork[] = [];
  const imageRejected: SelectedWork[] = [];
  for (const item of eligible) {
    const key = item.work.title.trim();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);

    const imageUrl = getRenderableWorkImageUrl(getWorkDisplayImage(item.work));
    if (!isUsableCanvaImageUrl(imageUrl)) {
      imageRejected.push(item);
      continue;
    }

    selected.push(item);
    if (selected.length >= MAX_WORKS) break;
  }

  return { selected, excludedTop: excluded.slice(0, 5), imageRejected };
}
