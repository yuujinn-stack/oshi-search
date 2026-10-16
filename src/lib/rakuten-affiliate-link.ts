// 楽天商品リンク（アフィリエイトURL・通常URL・短縮URL）の判定と、手動登録時の affiliateUrl の決め方（純粋関数・DB非依存）。
//
// 方針（手動登録の通常URL 130件問題の再発防止。docs/development-log.md Task 97・Phase 3 参照）:
// - affiliateUrl には「確認できた正規のアフィリエイトURL」だけを入れる。確認できない場合は空にして「要確認」とする
//   （公開ページのカードは affiliateUrl || itemUrl でリンクするため、空でもリンク自体は従来どおり機能する）。
// - 通常URL・短縮URLをアフィリエイトURLと誤判定しない。URLを推測で組み立てない。短縮URLは展開・変換しない。
// - 既存DBの正規URLを流用するのは、同じ商品（楽天ブックスは商品番号、楽天市場は店舗＋商品コード）で、
//   商品名と盤種・特典表記が一致し、流用元のURLが1種類に決まる場合だけ。

export type RakutenLinkKind = 'affiliate' | 'books_plain' | 'ichiba_plain' | 'short' | 'empty' | 'other';

/** 商品の同一性キー。楽天ブックス＝商品番号、楽天市場＝店舗＋商品コード（同じ店舗の別商品は別キー） */
export type RakutenProductKey =
  | { source: 'books'; productNumber: string }
  | { source: 'ichiba'; shop: string; itemCode: string };

const AFFILIATE_HOST = 'hb.afl.rakuten.co.jp';
const SHORT_HOSTS = new Set(['a.r10.to', 'r10.to']);

function parseUrl(url: string | undefined | null): URL | null {
  if (!url) return null;
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

/** 楽天の商品ページURL（楽天ブックス / 楽天市場）から同一性キーを取り出す。それ以外は null */
export function productKeyFromPageUrl(url: string | undefined | null): RakutenProductKey | null {
  const u = parseUrl(url);
  if (!u || !/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  if (host === 'books.rakuten.co.jp') {
    const m = /^\/rb\/(\d+)\/?$/.exec(u.pathname);
    return m ? { source: 'books', productNumber: m[1] } : null;
  }
  if (host === 'item.rakuten.co.jp') {
    const m = /^\/([a-z0-9_-]+)\/([a-z0-9_.-]+)\/?$/i.exec(u.pathname);
    if (!m) return null;
    // 楽天ブックスは楽天市場上でも店舗 "book"・商品コード＝商品番号で出品されている（同じ商品）
    if (m[1].toLowerCase() === 'book' && /^\d+$/.test(m[2])) return { source: 'books', productNumber: m[2] };
    return { source: 'ichiba', shop: m[1].toLowerCase(), itemCode: m[2].toLowerCase() };
  }
  return null;
}

export function productKeyString(key: RakutenProductKey | null): string {
  if (!key) return '';
  return key.source === 'books' ? `books:${key.productNumber}` : `ichiba:${key.shop}/${key.itemCode}`;
}

/**
 * 楽天アフィリエイトURL（https?://hb.afl.rakuten.co.jp/hgc/<識別子>/?pc=<楽天の商品ページURL>）を分解する。
 * ホストが hb.afl.rakuten.co.jp でない URL（クエリ等に文字列が含まれるだけのもの）や、遷移先が楽天の商品ページでないものは null。
 */
export function parseAffiliateUrl(url: string | undefined | null): { hgc: string; pageUrl: string; key: RakutenProductKey } | null {
  const u = parseUrl(url);
  if (!u || !/^https?:$/.test(u.protocol) || u.hostname.toLowerCase() !== AFFILIATE_HOST) return null;
  const m = /^\/hgc\/([^/]+)\/?$/.exec(u.pathname);
  const pc = u.searchParams.get('pc');
  if (!m || !pc) return null;
  const key = productKeyFromPageUrl(pc);
  return key ? { hgc: m[1], pageUrl: pc, key } : null;
}

export function classifyRakutenLink(url: string | undefined | null): RakutenLinkKind {
  if (!url || !url.trim()) return 'empty';
  if (parseAffiliateUrl(url)) return 'affiliate';
  const u = parseUrl(url);
  if (!u) return 'other';
  if (SHORT_HOSTS.has(u.hostname.toLowerCase())) return 'short';
  const key = productKeyFromPageUrl(url);
  if (key) return key.source === 'books' ? 'books_plain' : 'ichiba_plain';
  return 'other';
}

/** 商品リンクから同一性キー（アフィリエイトURLなら遷移先、通常URLならそのURL）を取り出す */
export function productKeyOfLink(url: string | undefined | null): RakutenProductKey | null {
  return parseAffiliateUrl(url)?.key ?? productKeyFromPageUrl(url);
}

// ── 管理画面向けのリンク状態 ─────────────────────────────────────────────────

export type AffiliateLinkStatus = 'verified' | 'plain_needs_review' | 'short_needs_review' | 'unverified_affiliate' | 'missing';

// 「確認済み」は、楽天アフィリエイトURLの形式であることと、遷移先が商品URLと同じ商品であることの確認。
// 成果がどのアカウントに計上されるか（成果帰属）は確認していないため、表示でもそれが分かる文言にする。
export const AFFILIATE_LINK_STATUS_LABEL: Record<AffiliateLinkStatus, string> = {
  verified: 'アフィリエイトURL（形式・遷移先確認済み）',
  plain_needs_review: '通常URLのため要確認',
  short_needs_review: '短縮URLのため要確認',
  unverified_affiliate: '発行元未確認のため要確認',
  missing: 'URL未設定',
};

/**
 * 保存済み商品のリンク状態（既存データから判定。DBカラムは追加しない）。
 * affiliateUrl が楽天アフィリエイトURLの形式で、遷移先が itemUrl と同じ商品（または itemUrl 自体がその URL）なら確認済み。
 * それ以外は、実際にリンクされる URL（affiliateUrl || itemUrl）の種類で要確認・未設定を返す。
 */
export function affiliateLinkStatusOf(item: { itemUrl?: string; affiliateUrl?: string }): AffiliateLinkStatus {
  const aff = item.affiliateUrl?.trim() ?? '';
  const itemUrl = item.itemUrl?.trim() ?? '';
  const parsed = parseAffiliateUrl(aff);
  if (parsed) {
    if (!itemUrl || itemUrl === aff) return 'verified';
    const itemKey = productKeyOfLink(itemUrl);
    // itemUrl が短縮URL等で商品を特定できない場合は、遷移先の一致を確認できないので要確認
    if (itemKey && productKeyString(itemKey) === productKeyString(parsed.key)) return 'verified';
    return 'unverified_affiliate';
  }
  const linked = aff || itemUrl;
  switch (classifyRakutenLink(linked)) {
    case 'empty': return 'missing';
    case 'short': return 'short_needs_review';
    case 'affiliate': return 'unverified_affiliate';
    default: return 'plain_needs_review';
  }
}

// ── 同一商品の確認（商品名・盤種・特典表記） ─────────────────────────────────

/** 商品名の比較用正規化（全半角・空白・【…】の付記の違いだけを吸収する） */
export function normalizeProductTitle(s: string | undefined | null): string {
  return (s ?? '').normalize('NFKC').replace(/【[^】]*】/g, '').replace(/\s+/g, '').toLowerCase();
}

const VARIANT_RE = /(type[-\s]?[a-z0-9]+|初回[^\s()（）]*|通常盤|限定盤|限定版|特装[^\s()（）]*|豪華版|特典[^\s()（）]*|限定カバー|cdのみ|cd[＋+][^\s()（）]*|blu-?ray|dvd|[a-z]盤)/gi;

/** 盤種・特典・形式の表記（Type A・初回限定盤・通常盤・CD＋DVD 等）。違えば別商品として扱う */
export function variantSignature(s: string | undefined | null): string {
  return [...new Set((s ?? '').normalize('NFKC').toLowerCase().match(VARIANT_RE) ?? [])].sort().join('|');
}

/** 同じ商品の名前か（正規化後に完全一致し、盤種・特典表記も一致） */
export function isSameProductTitle(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = normalizeProductTitle(a);
  return x.length > 0 && x === normalizeProductTitle(b) && variantSignature(a) === variantSignature(b);
}

// ── 手動登録時の affiliateUrl の決定 ─────────────────────────────────────────

/** 既存DBの流用候補（楽天APIが発行して保存しているアフィリエイトURL） */
export interface AffiliateCandidate {
  id: string;
  title: string;
  affiliateUrl: string;
}

export interface ManualAffiliateInput {
  title: string;
  itemUrl: string;
  /** 楽天API（管理画面の楽天検索）がこの商品に返した affiliateUrl。ある場合は最優先 */
  apiAffiliateUrl?: string;
  /** itemUrl と同じ商品の、既存DBの流用候補（呼び出し側で同一性キーで絞り込み済み） */
  candidates: AffiliateCandidate[];
  /** 楽天APIが発行したアフィリエイトURLの識別部分（既存DBにあるもの）。貼り付けられたアフィリエイトURLの発行元確認に使う */
  knownIssuerHgcs: ReadonlySet<string>;
}

export type ManualAffiliateSource = 'api' | 'pasted_affiliate' | 'existing_db' | 'none';

export interface ManualAffiliateDecision {
  affiliateUrl: string; // 確認できない場合は ''
  status: AffiliateLinkStatus;
  source: ManualAffiliateSource;
  message: string;
}

const sameDestination = (a: RakutenProductKey, b: RakutenProductKey | null) => !!b && productKeyString(a) === productKeyString(b);

export function decideManualAffiliateUrl(input: ManualAffiliateInput): ManualAffiliateDecision {
  const itemUrl = input.itemUrl.trim();
  const itemKind = classifyRakutenLink(itemUrl);
  const itemKey = productKeyOfLink(itemUrl);

  // ① 楽天APIが返した正規の affiliateUrl（遷移先が itemUrl と同じ商品の場合だけ）
  const api = parseAffiliateUrl(input.apiAffiliateUrl);
  if (api && sameDestination(api.key, itemKey)) {
    return { affiliateUrl: input.apiAffiliateUrl!.trim(), status: 'verified', source: 'api', message: '楽天APIが返したアフィリエイトURLを使用' };
  }

  if (itemKind === 'empty') return { affiliateUrl: '', status: 'missing', source: 'none', message: '商品URLが未設定' };
  if (itemKind === 'short') {
    return { affiliateUrl: '', status: 'short_needs_review', source: 'none', message: '短縮URLは発行元・遷移先を確認できないため変換しない' };
  }

  // 貼り付けられた URL 自体がアフィリエイトURL：既存DBに同じ識別部分（推しサーチのアカウントで楽天APIが発行したもの）がある場合だけ確認済み
  if (itemKind === 'affiliate') {
    const parsed = parseAffiliateUrl(itemUrl)!;
    if (input.knownIssuerHgcs.has(parsed.hgc)) {
      return { affiliateUrl: itemUrl, status: 'verified', source: 'pasted_affiliate', message: '推しサーチの楽天API発行URLと同じ発行元のアフィリエイトURL' };
    }
    return { affiliateUrl: '', status: 'unverified_affiliate', source: 'none', message: 'アフィリエイトURLの発行元を確認できない' };
  }

  if (itemKind !== 'books_plain' && itemKind !== 'ichiba_plain') {
    return { affiliateUrl: '', status: 'plain_needs_review', source: 'none', message: '楽天の商品ページURLではない' };
  }

  // ② 既存DBの正規URL（同じ商品キー・同じ販売元、商品名と盤種・特典表記が一致、URLが1種類に決まる場合だけ）
  const sameItem = input.candidates.filter((c) => {
    const p = parseAffiliateUrl(c.affiliateUrl);
    return p && sameDestination(p.key, itemKey) && isSameProductTitle(c.title, input.title);
  });
  const distinct = new Map<string, string>(); // hgc|key → URL（http/https の違いだけなら https を優先）
  for (const c of sameItem) {
    const p = parseAffiliateUrl(c.affiliateUrl)!;
    const k = `${p.hgc}|${productKeyString(p.key)}`;
    const cur = distinct.get(k);
    if (!cur || (!cur.startsWith('https:') && c.affiliateUrl.startsWith('https:'))) distinct.set(k, c.affiliateUrl);
  }
  if (distinct.size === 1) {
    return { affiliateUrl: [...distinct.values()][0], status: 'verified', source: 'existing_db', message: '同じ商品の既存の正規アフィリエイトURLを使用' };
  }

  // ③ 確認できない：URLは組み立てず要確認
  return {
    affiliateUrl: '',
    status: 'plain_needs_review',
    source: 'none',
    message: distinct.size > 1 ? '同じ商品に異なるアフィリエイトURLがあり決められない' : '同じ商品の正規アフィリエイトURLを確認できない',
  };
}

/** 手動登録フォームで、保存前に入力URLの扱いを案内する文言（判定はサーバー側で行う。ここでは誤解されない説明だけ） */
export function describeLinkBeforeSave(url: string): { tone: 'ok' | 'warn' | 'none'; text: string } {
  switch (classifyRakutenLink(url)) {
    case 'empty':
      return { tone: 'none', text: '' };
    case 'affiliate':
      return { tone: 'ok', text: '楽天アフィリエイトURLの形式です。保存時に、推しサーチの楽天API発行URLと同じ発行元か確認します。' };
    case 'books_plain':
    case 'ichiba_plain':
      return { tone: 'warn', text: '通常の楽天商品URLです。保存時に、同じ商品の正規アフィリエイトURLを既存データから探します（見つからなければ「要確認」）。楽天検索から追加すると正規URLが自動で付きます。' };
    case 'short':
      return { tone: 'warn', text: '短縮URLは発行元・遷移先を確認できないため、自動変換しません（「要確認」として保存）。楽天検索からの追加がおすすめです。' };
    default:
      return { tone: 'warn', text: '楽天の商品ページURLではありません（「要確認」として保存）。' };
  }
}
