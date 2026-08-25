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
// カレンダー等が混入するため、タイトル側でも安全側に倒す）。
// 実データ確認（2026）で、CD/Blu-rayの音楽・映像商品（例:「是非に及ばず（初回仕様限定盤
// CD＋Blu-ray Type-A）」）がスキャン対象カテゴリ(CD等)に含まれていることを確認したため、
// 音楽・映像商品であることを示す語も除外語に追加した。
// マッチングは大文字小文字を区別しない（実データに"Type-A"と"TYPE-A"の両方の表記が存在するため）。
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
  // 音楽・映像商品の明確なシグナル（CD/Blu-ray/DVDの版・形態を表す語）
  '初回仕様限定盤', '初回限定盤', '通常盤',
  '完全生産限定盤', '期間生産限定盤',
  'Type-A', 'Type-B', 'Type-C', 'Type-D',
  'シングル', 'アルバム',
];

/** タイトルに肯定シグナル（写真集/フォトブック/PHOTO BOOK等）が含まれるか */
export function hasPhotobookPositiveSignal(title: string): boolean {
  if (!title) return false;
  return POSITIVE_PATTERNS.some((re) => re.test(title));
}

/** タイトルに誤判定しやすい除外語が含まれるか（大文字小文字を区別しない） */
export function hasPhotobookExcludeSignal(title: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return EXCLUDE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
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

// ── 重複統合（productId完全一致による人物またぎ統合） ─────────────────────────────
//
// 実データ確認（2026）で、グループ写真集（乃木撮/日向撮/櫻撮/M!LK写真集等）が
// 所属メンバー全員の商品データに独立して同一のRakuten商品IDで紐づいていることが判明した。
// 従来の重複キー（人物＋正規化タイトル）は人物名を含むため、同一商品でも人物が違うだけで
// 別グループとして扱われ、最大70件もの重複表示が発生していた。
//
// 統合は「独立した2ルール」として適用する（互いに連鎖(transitive)させない）:
//   ルールA（productId完全一致）: 同一productIdは人物を問わず常に統合する（絶対ルール）。
//     Rakuten商品IDが完全一致する場合、物理的に同一の商品リスティングであることが確定して
//     いるため、表紙違いが発生する余地がない。
//   ルールB（人物＋正規化タイトル、またはdedupGroupOverrideによる手動指定）:
//     productIdが異なる場合のみ、既存の安全なロジックで統合する。表紙違い（限定カバー等）
//     を誤って統合しないための安全策。
//
// 重要な安全策（2026再改訂）: ルールAで2人以上の人物にまたがる「確定グループ写真集」と
// 判定されたアイテム（productIdの同一集合サイズが2以上）は、ルールBによるタイトル統合の
// 対象から除外（凍結）する。これにより、
//   A --(productId一致)--> B --(人物+タイトル一致)--> C
// のようにAとCが直接一致条件を満たさないのに連鎖的に統合される事態を完全に防ぐ
// （実データ検証では危険な連鎖統合は0件だったが、将来のデータに対しても構造的に
// 安全であることを保証するため、ルールAとBを独立させる設計にした）。
// 「人物を無視してタイトルだけで全商品を統合する」処理は行わない（過剰統合の防止）。

export interface GroupableCandidate {
  personName: string;
  productId: string;
  title: string;
  dedupGroupOverride?: string | null;
}

function unionFind(n: number): { find: (x: number) => number; union: (a: number, b: number) => void; parent: number[] } {
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  return { find, union, parent };
}

/**
 * 写真集候補を重複統合グループへ分割する（Union-Find）。
 * 戻り値の各要素は「同一商品とみなすアイテム群」（元の配列内でのインデックス配列）。
 */
export function groupPhotobookCandidates<T extends GroupableCandidate>(items: readonly T[]): number[][] {
  const n = items.length;
  if (n === 0) return [];
  const uf = unionFind(n);

  // 第1段階: 同一productIdは常に統合（人物を問わない・絶対ルール）
  const byProductId = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const pid = items[i].productId;
    if (!byProductId.has(pid)) byProductId.set(pid, []);
    byProductId.get(pid)!.push(i);
  }
  for (const idxs of byProductId.values()) {
    for (let k = 1; k < idxs.length; k++) uf.union(idxs[0], idxs[k]);
  }

  // ルールAで2人以上にまたがった（＝確定グループ写真集と判定された）アイテムは、
  // ルールBの対象から凍結する。これによりルールA・ルールBが互いに連鎖(transitive)しない。
  const frozenByRuleA = new Set<number>();
  for (const idxs of byProductId.values()) {
    if (idxs.length >= 2) for (const i of idxs) frozenByRuleA.add(i);
  }

  // ルールB: productIdが異なり、かつルールAで凍結されていないアイテムのみ、
  // 人物＋正規化タイトル（または手動override）で統合する。
  const byPersonTitle = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (frozenByRuleA.has(i)) continue;
    const override = items[i].dedupGroupOverride?.trim();
    const key = override || computeDedupKey(items[i].personName, items[i].title);
    if (!byPersonTitle.has(key)) byPersonTitle.set(key, []);
    byPersonTitle.get(key)!.push(i);
  }
  for (const idxs of byPersonTitle.values()) {
    for (let k = 1; k < idxs.length; k++) uf.union(idxs[0], idxs[k]);
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }
  return [...groups.values()];
}

// ── 統合グループの代表表示名の決定 ────────────────────────────────────────────────

export interface DisplayLabelResult {
  mode: 'group' | 'person';
  displayName: string;
  groupName?: string;
}

/**
 * 統合グループの代表表示名を決定する。
 * 紐づく人物が2人以上いて、かつ全員が同一の空でないグループに所属している場合のみ
 * グループ名を代表表示する（例: 乃木撮 → "乃木坂46"）。
 * それ以外（単独人物の場合、または複数人物でもグループが一致しない/空のグループを
 * 含む場合）は、代表人物名をそのまま使う（誤解を招く代表表示を避ける安全策）。
 * グループ名からの性別・ジャンル等の推測は一切行わない（表示名の決定のみ）。
 */
export function resolveDisplayLabel(
  linkedPersonNames: readonly string[],
  personGroupMap: ReadonlyMap<string, string>,
  representativePersonName: string,
): DisplayLabelResult {
  const uniqueNames = [...new Set(linkedPersonNames)];
  if (uniqueNames.length >= 2) {
    const groups = new Set(uniqueNames.map((n) => personGroupMap.get(n) ?? ''));
    if (groups.size === 1) {
      const [onlyGroup] = groups;
      if (onlyGroup) {
        return { mode: 'group', displayName: onlyGroup, groupName: onlyGroup };
      }
    }
  }
  return { mode: 'person', displayName: representativePersonName };
}

// ── 統合グループの設定集約（manual操作の一貫性担保） ────────────────────────────────
//
// photobook_settingsは(personName, productId)単位で保存されるが、同一productIdが
// 複数人物に紐づく場合、そのうち1人物分だけ設定変更しても残りの人物経由で同じ商品が
// 復活しないよう、読み取り時にグループ内の全設定行を安全側（除外・非公開・非表示を
// 優先）に集約する。書き込み時は呼び出し側（store層）がグループ内の全(personName,
// productId)組へ同じ設定を反映する（fan-out）ため、通常はこの集約が効く場面は少ないが、
// fan-out漏れ（新規メンバー追加等）に対する保険として機能する。

export interface AggregatableSettings {
  status: 'auto' | 'manual_include' | 'manual_exclude';
  published: boolean;
  homeState: 'auto' | 'pinned' | 'hidden';
  homePinnedPosition: number | null;
  sortOrder: number | null;
}

export function aggregatePhotobookSettings<T extends AggregatableSettings>(rows: readonly T[]): AggregatableSettings {
  const hasExclude = rows.some((r) => r.status === 'manual_exclude');
  const hasInclude = rows.some((r) => r.status === 'manual_include');
  const status: AggregatableSettings['status'] = hasExclude ? 'manual_exclude' : hasInclude ? 'manual_include' : 'auto';

  const published = !rows.some((r) => !r.published);

  const hasHidden = rows.some((r) => r.homeState === 'hidden');
  const hasPinned = rows.some((r) => r.homeState === 'pinned');
  const homeState: AggregatableSettings['homeState'] = hasHidden ? 'hidden' : hasPinned ? 'pinned' : 'auto';
  const pinnedRow = rows.find((r) => r.homeState === 'pinned' && r.homePinnedPosition !== null);
  const homePinnedPosition = homeState === 'pinned' ? (pinnedRow?.homePinnedPosition ?? null) : null;

  const sortOrderRow = rows.find((r) => r.sortOrder !== null);
  const sortOrder = sortOrderRow?.sortOrder ?? null;

  return { status, published, homeState, homePinnedPosition, sortOrder };
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
