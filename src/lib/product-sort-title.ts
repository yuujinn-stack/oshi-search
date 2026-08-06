// /admin/product-check の商品一覧を「商品名順」で並べ替えるための、並び替え専用の
// 正規化文字列（sortTitle）を作る純粋関数。
//
// 目的: 同じ・似た商品（【先着特典】あり/なし等）を一覧上で近くに表示し、手動での
// 重複確認・非表示作業を効率化する。DBの商品名（title）そのものは一切変更しない。
// 画面表示・保存値は常に元のtitleを使い、この関数の戻り値は並び替え比較にのみ使う。

// 商品名の先頭に付く販促文言・販売条件（これだけを対象に除外する。商品名本体の
// 「初回盤」「通常盤」「限定版」「特典」等は絶対に削除しない＝先頭からのみ、
// リストに完全一致する語だけを繰り返し剥がす）
const PROMO_PHRASES = [
  '先着購入特典', '先着予約特典', '先着特典', '先着',
  '予約受付中', '予約商品', '予約受付', '予約',
  '数量限定商品', '数量限定',
  '期間限定',
  '限定特典', '限定',
  '初回特典',
  '購入特典',
  '店舗特典',
  'オリジナル特典',
  'メーカー特典',
  '楽天ブックス限定', '楽天ブックス特典', '楽天限定',
  '特典付き', '特典あり', '特典',
  '送料無料', '送料込み',
  '新品',
  'ポイントアップ',
  'お買い得',
  'セール', 'SALE',
  '早期予約', '早期購入',
]
  // 長い語ほど先に試す（「先着」が先に来て「先着特典」を途中半端に剥がすのを防ぐ）
  .sort((a, b) => b.length - a.length);

// 販促文言を囲む可能性がある括弧の組（開き・閉じ）
const BRACKET_PAIRS: Array<[string, string]> = [
  ['【', '】'], ['[', ']'], ['［', '］'], ['（', '）'], ['(', ')'],
  ['＜', '＞'], ['<', '>'], ['《', '》'], ['「', '」'], ['『', '』'],
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 「先着特典」「先着 特典」のような表記ゆれに対応するため、語の各文字の間に
// 任意の空白（0文字以上）を許容するパターンにする。先頭アンカー(^)で使う前提のため
// 文中の商品名本体には影響しない。
function toFuzzyPattern(phrase: string): string {
  return phrase.split('').map(escapeRegExp).join('\\s*');
}

const PROMO_ALTERNATION = PROMO_PHRASES.map(toFuzzyPattern).join('|');

// 「ポイント○倍」「ポイント5倍」等、数字を含む販促文言
const POINT_MULTIPLIER_RE = /^ポイント\s*\d+\s*倍/i;

// 括弧で囲まれた販促文言（例: 【先着特典】）を各括弧の組ごとに用意
// 英字を含む文言（SALE等）の大文字・小文字を区別しないよう i フラグを付ける
const BRACKETED_PROMO_RES = BRACKET_PAIRS.map(([open, close]) => {
  const o = escapeRegExp(open);
  const c = escapeRegExp(close);
  return new RegExp(`^${o}\\s*(?:${PROMO_ALTERNATION})\\s*${c}\\s*`, 'i');
});

// 括弧なしの販促文言（例: 予約受付中 SixTONES...）
const BARE_PROMO_RE = new RegExp(`^(?:${PROMO_ALTERNATION})\\s*`, 'i');

// 先頭の販促文言（表記ゆれ・括弧の有無を問わず）を、無くなるまで繰り返し1つずつ剥がす
function stripLeadingPromotionalLabels(text: string): string {
  let current = text;
  // 商品名自体が異常に長い/繰り返しパターンでも無限ループしないよう上限を設ける
  for (let i = 0; i < 20; i++) {
    let matched = false;

    if (POINT_MULTIPLIER_RE.test(current)) {
      current = current.replace(POINT_MULTIPLIER_RE, '');
      matched = true;
    } else {
      for (const re of BRACKETED_PROMO_RES) {
        if (re.test(current)) {
          current = current.replace(re, '');
          matched = true;
          break;
        }
      }
      if (!matched && BARE_PROMO_RE.test(current)) {
        current = current.replace(BARE_PROMO_RE, '');
        matched = true;
      }
    }

    if (!matched) break;
  }
  return current;
}

// 並び替え専用の正規化商品名（sortTitle）を作る。
// 元のtitleは一切変更しない。画面表示には使わず、比較にのみ使用する。
export function getProductSortTitle(title: string): string {
  const normalized = title
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return normalized;

  const withoutPromo = stripLeadingPromotionalLabels(normalized);
  // 販促文言除去後に先頭へ残った記号・区切り文字・空白を除去する
  const result = withoutPromo
    .replace(/^[\s:：・\-―—|｜]+/, '')
    .trim();

  // 販促文言の除去によって空文字になった場合は、正規化のみ行った文字列にフォールバックする
  // （並び替えキーが空のままにならないようにする）
  return result || normalized;
}

// 商品名順の比較関数。
// 1. 正規化後の商品名（getProductSortTitle）
// 2. 元の商品名（title）
// 3. 商品ID
// の優先順位で比較し、同名・同正規化名の商品でも表示順が画面更新のたびに変わらないよう
// 常に安定した結果を返す。
export function compareProductsByTitle<T extends { title: string; id: string }>(a: T, b: T): number {
  const sortTitleA = getProductSortTitle(a.title);
  const sortTitleB = getProductSortTitle(b.title);

  const sortTitleResult = sortTitleA.localeCompare(sortTitleB, 'ja-JP', { numeric: true, sensitivity: 'base' });
  if (sortTitleResult !== 0) return sortTitleResult;

  const originalTitleResult = a.title.localeCompare(b.title, 'ja-JP', { numeric: true, sensitivity: 'base' });
  if (originalTitleResult !== 0) return originalTitleResult;

  return String(a.id).localeCompare(String(b.id), 'ja-JP', { numeric: true, sensitivity: 'base' });
}
