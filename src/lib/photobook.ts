// 写真集機能: ルールベース判定・重複判定・性別/ジャンル解決のための純粋関数群。
//
// 重要な設計方針（実装前に必ず維持すること）:
// - OpenAI API・その他外部AIは一切呼び出さない（呼び出し禁止）。
// - 判定は既存DBの情報（category / title / verdict / gender設定）だけを使う決定的ルールのみ。
// - 判定できない場合は「その他」「未分類」等の安全な扱いにし、推測で断定しない。
// - DB / Redis への書き込みはこのファイルでは行わない（純粋関数のみ）。

import type { RakutenItem } from '@/types/rakuten';

// ── 写真集タイトル判定 ────────────────────────────────────────────────────────

// 写真集であることを示す肯定シグナル（このいずれかを含まない場合は自動表示しない）
const POSITIVE_PATTERNS: RegExp[] = [
  /写真集/,
  /フォトブック/i,
  /photo\s*book/i,
  /photobook/i,
];

// 誤判定しやすいため除外する語（category='写真集'として取得された商品にも
// カレンダー等が混入するため、タイトル側でも安全側に倒す）
const EXCLUDE_KEYWORDS: string[] = [
  '雑誌',
  'Blu-ray', 'ブルーレイ', 'DVD', 'CD',
  'カレンダー',
  'ポスター',
  '生写真',
  'ブロマイド',
  '写真セット', '写真カード',
  'トレーディングカード', 'トレカ',
  'アクリルスタンド',
  'グッズ',
];

/** タイトルに肯定シグナル（写真集/フォトブック/PHOTO BOOK等）が含まれるか */
export function hasPhotobookPositiveSignal(title: string): boolean {
  if (!title) return false;
  return POSITIVE_PATTERNS.some((re) => re.test(title));
}

/** タイトルに誤判定しやすい除外語が含まれるか */
export function hasPhotobookExcludeSignal(title: string): boolean {
  if (!title) return false;
  return EXCLUDE_KEYWORDS.some((kw) => title.includes(kw));
}

/**
 * 商品が写真集として自動判定できるかを決定的ルールのみで判定する。
 * category は呼び出し側で '写真集' に絞り込み済みであることを前提とする
 * （カテゴリー情報をタイトル文字列より優先する方針のため、他カテゴリはここで判定しない）。
 */
export function isAutoDetectedPhotobook(item: Pick<RakutenItem, 'title' | 'isUsed'>): boolean {
  const title = item.title ?? '';
  if (!hasPhotobookPositiveSignal(title)) return false;
  if (hasPhotobookExcludeSignal(title)) return false;
  if (item.isUsed) return false;
  return true;
}

// ── タイトル正規化（重複判定用） ────────────────────────────────────────────────
// 表紙違い（通常版/限定版/Type A 等）を誤って統合しないよう、版・エディションを
// 表す語は正規化で取り除かない。送料無料等の明確なショップ側の付随文言のみ除去する。

// 除去対象: 明確にショップ側の販促文言・在庫状況であり、商品そのものの版を区別しないもの
// 実データ確認（2026）で、【】ブラケットを一律除去すると
// 「【楽天ブックス限定カバー＋限定特典付き】○○1st写真集」と「○○1st写真集」(無印) や
// 「【T限定】○○1st写真集」と「○○1st写真集」(無印) が同一キーに統合されてしまい、
// 表紙違いの可能性がある商品を誤って1件に統合する事故が判明した。
// 【】の中身には「限定カバー」「T限定」等、表紙・版を区別する情報が含まれることがあるため、
// ブラケットの中身は一切除去せず保持する。安全に除去してよいと確認できた語（購入方法・
// 在庫状況等、版を区別しない純粋なショップ側の付随情報）のみ、ブラケットの有無に関わらず
// 文字列として個別に除去する。
const NORMALIZE_STRIP_PATTERNS: RegExp[] = [
  /送料無料/g,
  /特典付き/g,
  /即納/g,
  /新品/g,
  /予約/g,
  /あす楽/g,
];

/** 全角/半角・大文字小文字・空白・ショップ装飾文言を安全な範囲で正規化する */
export function normalizePhotobookTitle(title: string): string {
  if (!title) return '';
  let t = title.normalize('NFKC').toLowerCase();
  for (const re of NORMALIZE_STRIP_PATTERNS) t = t.replace(re, '');
  // 上記の除去によって中身が空になった【】【】/()だけを取り除く（残った内容がある
  // ブラケットは版・表紙情報の可能性があるため一切触れない）。
  t = t.replace(/【】|\(\)|（）/g, '');
  t = t.replace(/[\s　]+/g, '').trim();
  return t;
}

/**
 * 重複グループキー（同一人物・同一版とみなす単位）。
 * 表紙画像そのものの一致は画像解析なしには判定できないため、
 * 「同一人物 + 正規化タイトルが完全一致」を実務上の同一版判定として採用する
 * （通常版/限定版等の版違いはタイトルに残るため別グループになる）。
 */
export function computeDedupKey(personName: string, title: string): string {
  return `${personName}::${normalizePhotobookTitle(title)}`;
}

// ── 代表商品の選定 ────────────────────────────────────────────────────────────

/**
 * 同一重複グループ内の代表商品を1件選ぶ。
 * 優先順位: 画像あり > 商品URLあり > 価格あり(0より大) > 価格が安い方 > id昇順(安定化)
 * 「現在購入可能」を示す在庫フラグは既存RakutenItem型に存在しないため判定に含めない。
 */
export function selectRepresentative<T extends Pick<RakutenItem, 'id' | 'imageUrl' | 'itemUrl' | 'affiliateUrl' | 'price'>>(
  items: readonly T[],
): T {
  if (items.length === 0) throw new Error('selectRepresentative: items is empty');
  const sorted = [...items].sort((a, b) => {
    const aImg = a.imageUrl ? 0 : 1;
    const bImg = b.imageUrl ? 0 : 1;
    if (aImg !== bImg) return aImg - bImg;

    const aUrl = (a.affiliateUrl || a.itemUrl) ? 0 : 1;
    const bUrl = (b.affiliateUrl || b.itemUrl) ? 0 : 1;
    if (aUrl !== bUrl) return aUrl - bUrl;

    const aPrice = Number(a.price) > 0 ? 0 : 1;
    const bPrice = Number(b.price) > 0 ? 0 : 1;
    if (aPrice !== bPrice) return aPrice - bPrice;

    const priceDiff = (Number(a.price) || Infinity) - (Number(b.price) || Infinity);
    if (priceDiff !== 0) return priceDiff;

    return a.id.localeCompare(b.id);
  });
  return sorted[0];
}

// ── 性別解決 ──────────────────────────────────────────────────────────────────

export type PhotobookGender = 'female' | 'male';

function normalizeGenderValue(v: string | null | undefined): PhotobookGender | null {
  return v === 'female' || v === 'male' ? v : null;
}

/**
 * 人物の性別を解決する。優先順位: personMeta.gender(個人上書き) > groupMeta.gender(所属グループ) > 未分類。
 * AI推測・グループ名からの自動推測は一切行わない。どちらも未設定ならnull（未分類）を返す。
 */
export function resolvePersonGender(
  personGender: string | null | undefined,
  groupGender: string | null | undefined,
): PhotobookGender | null {
  return normalizeGenderValue(personGender) ?? normalizeGenderValue(groupGender) ?? null;
}

// ── ジャンル優先度バケット（表示優先順位用） ───────────────────────────────────

export type PhotobookGenreBucket = '女優' | 'アイドル' | '俳優' | 'その他';

/**
 * 表示優先順位のためのジャンルバケット分け。
 * 女性: 女優 > アイドル > その他 / 男性: 俳優 > アイドル > その他
 * 既存の genre / primaryGenre / genres のいずれかにバケット名と一致する値があれば採用する。
 * ハードコードで特定人物名を列挙しない・推測しない（一致しなければ「その他」）。
 */
export function resolveGenreBucket(
  gender: PhotobookGender | null,
  genreValues: readonly (string | null | undefined)[],
): PhotobookGenreBucket {
  const set = new Set(genreValues.filter((v): v is string => !!v));
  if (gender === 'female') {
    if (set.has('女優')) return '女優';
    if (set.has('アイドル') || set.has('坂道')) return 'アイドル';
    return 'その他';
  }
  if (gender === 'male') {
    if (set.has('俳優')) return '俳優';
    if (set.has('アイドル')) return 'アイドル';
    return 'その他';
  }
  return 'その他';
}

const BUCKET_ORDER_FEMALE: Record<PhotobookGenreBucket, number> = { '女優': 0, 'アイドル': 1, '俳優': 2, 'その他': 3 };
const BUCKET_ORDER_MALE: Record<PhotobookGenreBucket, number> = { '俳優': 0, 'アイドル': 1, '女優': 2, 'その他': 3 };

export function genreBucketOrder(gender: PhotobookGender | null, bucket: PhotobookGenreBucket): number {
  return (gender === 'male' ? BUCKET_ORDER_MALE : BUCKET_ORDER_FEMALE)[bucket];
}

// ── ホーム表示: 同一人物の連続を避ける分散並び替え ─────────────────────────────

export interface DistributableItem {
  personName: string;
}

/**
 * 同一人物の商品が連続しすぎないよう分散させる（ラウンドロビン）。
 * 入力の並び順（優先度順）はできるだけ尊重しつつ、人物単位でバケツに分けて
 * ラウンドロビンで取り出す。手動固定（pinned）はこの関数の対象外
 * （呼び出し側で固定枠を除いた「自動枠」だけを渡すこと）。
 */
export function distributeAvoidingConsecutivePerson<T extends DistributableItem>(items: readonly T[]): T[] {
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  for (const item of items) {
    if (!buckets.has(item.personName)) {
      buckets.set(item.personName, []);
      order.push(item.personName);
    }
    buckets.get(item.personName)!.push(item);
  }
  const result: T[] = [];
  let remaining = items.length;
  while (remaining > 0) {
    for (const name of order) {
      const bucket = buckets.get(name)!;
      if (bucket.length === 0) continue;
      result.push(bucket.shift()!);
      remaining--;
    }
  }
  return result;
}
