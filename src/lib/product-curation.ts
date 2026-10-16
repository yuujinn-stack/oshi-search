/**
 * 公開ページの楽天商品「表示品質」用の純粋関数（DB / Redis 非依存・書き込みなし）。
 *
 * - classifyProductForDisplay: 表示セクション（写真集・書籍 / CD / Blu-ray・DVD / グッズ / その他）の判定
 * - isUsedListing:             グッズ等のカテゴリに混ざった【中古】出品の判定
 * - isBulkResaleSet:           【10枚セット】等の業者向けまとめ買い出品の判定（おすすめから外し、一覧の末尾へ）
 * - dedupeProducts:            同一商品の重複表示の除去（初回盤A/B・通常盤・特典違いは別商品として残す）
 * - stripPromoTags:            表示用タイトルから確認できない宣伝タグ（【予約】【即納】【最安値】等）を除く
 *
 * 判定の根拠は「取得元の楽天API（管理カテゴリ）」と「商品タイトルの明示的な語」だけ。
 * 根拠が無い商品は推測で振り分けず「その他」（needsReview=true）にする。商品は削除しない。
 * verdict（AI/手動判定）・relevanceScore・DB の値は一切変更しない。
 */

import type { ProductCategory, RakutenItem } from '@/types/rakuten';

export type DisplaySectionLabel = '写真集・書籍' | 'CD' | 'Blu-ray・DVD' | 'グッズ' | 'その他';

/** 判断できない商品の受け皿（公開ページでは「その他」タブ。おすすめ表示には出さない） */
export const REVIEW_SECTION_LABEL = 'その他' as const;

export interface ProductClassification {
  section: DisplaySectionLabel;
  /** true = 根拠が足りず自動判定できなかった（要確認） */
  needsReview: boolean;
}

// ── 正規化 ──────────────────────────────────────────────────────────────────

/** 全角英数・記号を半角へ寄せ、Blu−ray 等のダッシュ揺れを統一する（判定用。表示には使わない） */
function normalizeForMatch(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/[−‐-―－]/g, '-');
}

// ── キーワード ──────────────────────────────────────────────────────────────

// 書籍と判定する語（従来の人物ページ BOOK_TITLE_KEYWORDS と同じ語＋大文字小文字の揺れ）
const BOOK_RE = new RegExp(
  [
    '写真集', 'フォトブック', 'photo ?book', '\\bbooks?\\b',
    '書籍', '単行本', '文庫', '新書', '雑誌', 'ムック', 'ガイド', 'コミック', '漫画', 'マンガ',
    '楽譜', '小説', '図鑑', '絵本', 'エッセイ', 'スタイルブック', 'オフィシャルブック',
    '乃木撮', '日向撮', '櫻撮',
    'B\\.L\\.T\\.', 'BRODY', 'EX大衆', 'anan', 'アップトゥボーイ', 'UTB',
    'Platinum FLASH', 'BUBKA', '東京カレンダー', 'TRIANGLE',
  ].join('|'),
  'i',
);

// グッズの品目名。「（クリアファイル付き）」「ポスターなし」のような付属・特典の記述は品目とみなさない。
const GOODS_NOUNS = [
  'アクリルスタンド', 'アクスタ', 'アクリルキーホルダー', 'アクリル', '缶バッジ', 'バッジ',
  '生写真', 'ブロマイド', 'ポストカード', 'ポスター', 'トレカ', 'トレーディングカード',
  'トレーディング', 'コレクションカード', 'キーホルダー', 'キーチェーン', 'ストラップ',
  'マフラータオル', 'タオル', 'Tシャツ', 'ペンライト', 'スティックライト', 'クリアファイル',
  'ステッカー', 'シール', 'ぬいぐるみ', 'うちわ', 'フィギュア', 'カレンダー', 'calendar',
  'ポーチ', '巾着', 'ラバーバンド', 'リストバンド', 'パンフレット', 'パンフ', 'チェキ',
];
const GOODS_ITEM_RE = new RegExp(
  `(?:${GOODS_NOUNS.join('|')})(?!\\s*(?:付|つき|なし|無し|同梱|封入|入り))`,
  'i',
);

// 「[Blu-ray]」「【DVD】」のような括弧で明示された形式
const EXPLICIT_DISC_RE = /[\[【(（]\s*(?:blu-?ray|ブルーレイ|dvd|bd)(?:\s*disc)?\s*[\]】)）]/i;
const EXPLICIT_CD_RE = /[\[【(（]\s*\d*cd\s*[\]】)）]/i;
// 「(Blu-ray Disc付)」= 本体はCD
const DISC_ATTACHED_RE = /(?:blu-?ray|dvd)\s*(?:disc|ディスク)?\s*付/i;
const CD_RE = /(?:^|[^a-z])\d*CD(?![a-z])/i;
const DISC_RE = /blu-?ray|ブルーレイ|dvd/i;
const CD_WORD_RE = /シングル|アルバム|shop盤/i;
const GENERIC_GOODS_RE = /グッズ|goods/i;

// ── 分類 ────────────────────────────────────────────────────────────────────

/**
 * 表示セクションを判定する。
 *
 * - CD / Blu-ray・DVD（楽天ブックスCD・DVD検索）: 取得元APIが形式を保証するため管理カテゴリをそのまま使う。
 *   ただし楽天市場の一般ショップの出品（手動登録等）は、商品名に形式（CD / Blu-ray・DVD）が明示されていればそれに従う
 * - 写真集 / 本・雑誌（楽天ブックス書籍検索）: 書籍。タイトルが明らかにグッズ（カレンダー・トレカ等）の場合のみグッズ
 * - グッズ / 中古（楽天市場検索）: タイトルの明示的な語で判定。根拠が無いものは「その他」（要確認）
 *
 * @param itemUrl 商品URL（アフィリエイトURL可）。楽天市場の一般ショップ出品かどうかの判別に使う
 */
export function classifyProductForDisplay(
  title: string,
  adminCat: ProductCategory,
  itemUrl = '',
): ProductClassification {
  if (adminCat === 'CD' || adminCat === 'Blu-ray・DVD') {
    if (isShopListingUrl(itemUrl)) {
      const t = normalizeForMatch(title ?? '');
      if (EXPLICIT_DISC_RE.test(t)) return { section: 'Blu-ray・DVD', needsReview: false };
      if (EXPLICIT_CD_RE.test(t) || DISC_ATTACHED_RE.test(t) || CD_RE.test(t)) return { section: 'CD', needsReview: false };
      if (DISC_RE.test(t)) return { section: 'Blu-ray・DVD', needsReview: false };
    }
    return { section: adminCat, needsReview: false };
  }

  const t = normalizeForMatch(title ?? '');

  if (adminCat === '写真集' || adminCat === '本・雑誌') {
    // 括弧内は特典・付属品の記述（「(限定絵柄ポストカード1枚)」等）なので品目の判定に使わない
    const core = t.replace(/【[^】]*】|\([^)]*\)|\[[^\]]*\]/g, ' ');
    if (!BOOK_RE.test(t) && GOODS_ITEM_RE.test(core)) return { section: 'グッズ', needsReview: false };
    return { section: '写真集・書籍', needsReview: false };
  }

  // 楽天市場（グッズ・中古）
  if (EXPLICIT_DISC_RE.test(t)) return { section: 'Blu-ray・DVD', needsReview: false };
  if (EXPLICIT_CD_RE.test(t)) return { section: 'CD', needsReview: false };
  if (GOODS_ITEM_RE.test(t)) return { section: 'グッズ', needsReview: false };
  if (DISC_ATTACHED_RE.test(t) || CD_RE.test(t)) return { section: 'CD', needsReview: false };
  if (DISC_RE.test(t)) return { section: 'Blu-ray・DVD', needsReview: false };
  if (CD_WORD_RE.test(t)) return { section: 'CD', needsReview: false };
  if (BOOK_RE.test(t)) return { section: '写真集・書籍', needsReview: false };
  if (GENERIC_GOODS_RE.test(t)) return { section: 'グッズ', needsReview: false };
  return { section: REVIEW_SECTION_LABEL, needsReview: true };
}

// ── 中古・まとめ買い ────────────────────────────────────────────────────────

/** 楽天市場の出品タイトルが中古品であることを明示しているか（【中古】・中古品 等） */
export function isUsedListing(title: string): boolean {
  return /中古/.test(title ?? '');
}

/**
 * 【10枚セット】【100枚セット】「各25枚セット」のような業者向けまとめ買い出品か。
 * 「A＋B＋C＋Dセット」（全形態1枚ずつ）や「2冊セット（通常カバー+限定カバー）」は対象外。
 */
export function isBulkResaleSet(title: string): boolean {
  const t = normalizeForMatch(title ?? '');
  for (const m of t.matchAll(/(?:^|[【\[(\s各×x])(\d+)\s*枚\s*セット/g)) {
    if (Number(m[1]) >= 5) return true;
  }
  return /×\s*\d{2,}\s*枚/.test(t);
}

/** まとめ買い出品を（削除せず）末尾へ移す。それ以外の並び順は保つ */
export function demoteBulkResaleSets<T extends RakutenItem>(products: readonly T[]): T[] {
  const normal: T[] = [];
  const bulk: T[] = [];
  for (const p of products) (isBulkResaleSet(p.title) ? bulk : normal).push(p);
  return [...normal, ...bulk];
}

// ── 重複除去 ────────────────────────────────────────────────────────────────

/** 重複判定キー（表記ゆれ: 全半角・空白・大文字小文字だけを吸収。盤種・特典の違いは残る） */
export function productTitleKey(title: string): string {
  return normalizeForMatch(title ?? '').replace(/\s+/g, '').toLowerCase();
}

/**
 * 商品ページの実URL。itemUrl がアフィリエイト経由（hb.afl.rakuten.co.jp/…?pc=実URL）の場合は
 * pc パラメータを取り出す（アフィリエイトURLのホスト+パスは全商品で同一になるため、そのままでは比較できない）。
 */
function resolveProductPageUrl(url: string): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'hb.afl.rakuten.co.jp') {
      const pc = u.searchParams.get('pc');
      return pc ? new URL(pc) : null;
    }
    return u;
  } catch {
    return null;
  }
}

/** 楽天市場の一般ショップの出品か（楽天ブックスの商品ではない） */
function isShopListingUrl(itemUrl: string): boolean {
  const page = resolveProductPageUrl(itemUrl);
  return !!page && page.hostname === 'item.rakuten.co.jp' && !page.pathname.startsWith('/book/');
}

/**
 * 同一商品の重複を除く（先に出現したものを残す＝呼び出し側の並び順を優先）。
 *
 * 同一とみなす条件:
 *   - 商品ページの実URL（ホスト+パス）が同じ。実URLが取れない場合のみ商品IDが同じ
 *     （楽天市場の商品IDは src/lib/rakuten.ts の stableId がアフィリエイトURLから作るため、
 *      同じショップの別商品が同じIDになる既知の不具合がある。IDだけで同一とはみなさない）
 *   - 楽天市場の一般ショップの出品どうしで、タイトル（表記ゆれ吸収後）が完全一致（別ショップの同名出品）
 * 楽天ブックスの商品はタイトル・価格が同じでも商品番号（URL）が違えば別商品として残す
 * （先着特典の再登録など、同名で別の商品番号が実在するため）。
 * 初回盤A/B・通常盤・特典違いはタイトルとURLが異なるため別商品として残る。
 */
export function dedupeProducts<T extends RakutenItem>(products: readonly T[]): T[] {
  const seenKeys = new Set<string>();
  const seenTitles = new Set<string>();
  const result: T[] = [];
  for (const p of products) {
    const page = resolveProductPageUrl(p.itemUrl);
    const key = page
      ? `u:${(page.hostname + page.pathname).toLowerCase().replace(/\/$/, '')}`
      : `id:${p.id}`;
    if (seenKeys.has(key)) continue;
    const titleKey = isShopListingUrl(p.itemUrl) ? productTitleKey(p.title) : '';
    const tk = titleKey ? `i:${titleKey}` : '';
    if (tk && seenTitles.has(tk)) continue;
    seenKeys.add(key);
    if (tk) seenTitles.add(tk);
    result.push(p);
  }
  return result;
}

// ── 表示用タイトル ──────────────────────────────────────────────────────────

// 取得時点のショップの宣伝文句で、表示時点では確認できないもの（予約受付・在庫・最安値・送料・ポイント等）
const PROMO_TAG_RE =
  /【[^【】]*(?:予約|即納|在庫|最安|送料無料|送料込|あす楽|ポイント|クーポン|セール|SALE|新品|入荷|発売中|最新|オリコン加盟店|割引|%OFF|％OFF|配達|発送|出荷)[^【】]*】/gi;

// 括弧の外に書かれた割引率（「★10％OFF■」等）
const INLINE_DISCOUNT_RE = /\d+\s*[%％]\s*OFF/gi;

/**
 * 表示用タイトルから【予約】【即納】【最安値挑戦】【送料無料】等の宣伝タグだけを除く。
 * 【中古】【楽天ブックス限定特典】など商品の区別に必要な情報は残す。DB の値は変更しない。
 * 除去で空になる場合は元のタイトルを返す。
 */
export function stripPromoTags(title: string): string {
  if (!title) return title;
  const stripped = title
    .replace(PROMO_TAG_RE, (m) => (/中古|特典|限定盤|限定版/.test(m) ? m : ''))
    .replace(INLINE_DISCOUNT_RE, '')
    .replace(/^[\s　]+/, '');
  return stripped.trim() ? stripped : title;
}
