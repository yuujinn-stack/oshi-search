// VOD配信情報CSV取り込み時の安全装置：Prime Video 追加チャンネルの誤登録検出（純粋関数・DB非依存）。
//
// 背景: VOD調査の対象が主要14サービスに限定されていたため、Prime Video 内の追加チャンネル
// （NHKオンデマンド・FODチャンネル・TELASA・Leminoセレクト等。プライム会員費とは別料金）で
// 配信されている作品が「Prime Video」として登録され、Prime Video 本体の見放題として
// 集計されていた（2026-10 調査で157行を確認）。
//
// ルール:
// - provider が Prime Video 本体（normalizeProviderName === 'primevideo'）なのに、note / sourceUrl に
//   追加チャンネル・別契約を示す記述がある行は「追加チャンネルの可能性あり」として取り込みを保留する。
// - note の内容から provider を自動で書き換えることはしない（人間の確認を促すだけ）。
//   追加チャンネルで確定した場合は「NHK On Demand Amazon Channel」等の正式名で CSV を直して再取り込みする。
import { normalizeProviderName } from '@/lib/vod-dedup';
import type { VodProvider } from '@/types/vod';

/** note に含まれていたら追加チャンネル・別契約の可能性がある語 */
const CHANNEL_HINT_RE =
  /チャンネル|channel|別途|追加契約|追加の?チャンネル|追加料金|別料金|追加登録|追加の?サブスクリプション|for\s*prime\s*video|会員特典(単体)?(では|の見放題では)(ない|なく)/i;

/** sourceUrl が Prime Video の追加チャンネルのページ */
const CHANNEL_URL_RE = /(primevideo\.com|amazon\.co\.jp)\/(.*\/)?(gp\/video\/)?channel\//i;

export const PRIME_CHANNEL_SUSPECT_WARNING =
  '追加チャンネルの可能性があります（Prime Video本体として取り込まず保留しました）。' +
  'プライム会員だけで追加料金なしに視聴できる場合のみ「Prime Video」、' +
  '追加チャンネル経由の場合は「NHK On Demand Amazon Channel」「FOD Channel Amazon Channel」等の正式名で登録してください。';

export interface VodRowLike {
  providerName: string;
  note?: string | null;
  sourceUrl?: string | null;
}

/**
 * 否定形の記述（「追加料金なし」「チャンネル契約不要」「追加チャンネルではない」等）。
 * 以前は CHANNEL_HINT_RE が否定形にもヒットし、プライム会員見放題の作品を「チャンネル疑い」として
 * 保留していた（誤検知）。判定前にこれらを取り除く。
 * 「会員特典ではない」（＝チャンネル側の証拠）はここでは除去しない。
 */
const NEGATED_CHANNEL_RE = new RegExp(
  '(?:' +
    '(?:追加の?|別途の?|別の?)?(?:Amazon\\s*)?(?:チャンネル|サブスクリプション)?(?:の|への)?(?:追加の?|別途の?)?(?:契約|登録|料金|費用|課金|加入)' +
    '|追加の?チャンネル|チャンネル' +
  ')' +
  '\\s*(?:は|が|も|の)?\\s*' +
  '(?:不要|なし|無し|いらない|かからない|かかりません|ありません|必要(?:ない|なし|ありません))',
  'g',
);
const NOT_CHANNEL_RE = /(?:追加の?)?チャンネル(?:経由|作品|対象|配信)?\s*(?:では|じゃ)(?:ない|なく|ありません)/g;

/** プライム会員料金だけで見られることを示す記述（「Prime Video」という語だけでは根拠にしない） */
const PRIME_INCLUDED_RE =
  /プライム(?:会員|特典|対象)|prime\s*(?:会員|特典|対象|members?)|included\s+with\s+prime|追加料金(?:なし|無し|不要|はかから|がかから)/i;
/** 見放題の根拠を打ち消す記述（＝プライム会員特典ではない） */
const PRIME_NOT_INCLUDED_RE =
  /(?:プライム|prime)?\s*会員特典(?:単体)?(?:の見放題)?\s*(?:では|じゃ|の対象では)(?:ない|なく|ありません)|(?:プライム|prime)\s*(?:会員特典|特典|会員)?\s*(?:の)?対象外/i;
/** レンタル・購入のみを示す記述 */
const RENTAL_HINT_RE = /レンタル|購入|個別課金|都度課金|有料配信|\brent(?:al)?\b|\bbuy\b|\bpurchase\b/i;
const NEGATED_RENTAL_RE = /(?:レンタル|購入|個別課金)\s*(?:は|も|の)?\s*(?:不要|なし|無し|せずに?)/g;

/**
 * Prime Video 本体名義の行の分類（CSV取り込み用）。
 * - not_prime : Prime Video 本体ではない（判定対象外）
 * - included  : A. プライム会員料金だけで視聴可能（根拠あり）→ 登録可
 * - no_evidence: 根拠も反証も無い（note 無し等）→ 従来どおり登録可（CSV の種別を採用）
 * - rental_typed: 種別が rent / buy の行（見放題として登録しないので保留不要）
 * - channel   : B. 追加チャンネル契約が必要 → Prime Video 本体として登録しない（保留）
 * - rental    : C. 種別 flatrate だが根拠はレンタル・購入のみ → 見放題として登録しない（保留）
 * - ambiguous : D. 見放題の根拠とチャンネル／レンタルの記述が混在して判定不能 → 保留
 */
export type PrimeRowCategory = 'not_prime' | 'included' | 'no_evidence' | 'rental_typed' | 'channel' | 'rental' | 'ambiguous';

export const PRIME_HELD_CATEGORIES: ReadonlySet<PrimeRowCategory> = new Set(['channel', 'rental', 'ambiguous']);

export const PRIME_CATEGORY_DETAIL: Record<PrimeRowCategory, string> = {
  not_prime: '',
  included: 'プライム会員料金だけで視聴可能との記述あり',
  no_evidence: '',
  rental_typed: '',
  channel: '追加チャンネル・別契約の記述があります',
  rental: '種別は見放題ですが、記述はレンタル・購入のみです',
  ambiguous: 'プライム会員見放題の記述と、追加チャンネル／レンタルの記述が混在しています（判定不能）',
};

export interface PrimeRowClassification {
  category: PrimeRowCategory;
  detail: string;
}

function stripNegatedChannelPhrases(text: string): string {
  return text.replace(NEGATED_CHANNEL_RE, ' ').replace(NOT_CHANNEL_RE, ' ');
}

/**
 * Prime Video 本体名義の行を A〜D に分類する（純粋関数）。
 * availabilityType は TYPE_MAP で正規化済みの値（'flatrate' | 'rent' | 'buy' | ...）。省略時は flatrate 扱い。
 * 判定できないものを「見放題」に倒すことはしない（自動承認禁止）。
 */
export function classifyPrimeVideoRow(row: VodRowLike & { availabilityType?: string | null }): PrimeRowClassification {
  const make = (category: PrimeRowCategory, detail = PRIME_CATEGORY_DETAIL[category]) => ({ category, detail });
  if (normalizeProviderName(row.providerName ?? '') !== 'primevideo') return make('not_prime');
  if (row.sourceUrl && CHANNEL_URL_RE.test(row.sourceUrl)) {
    return make('channel', 'sourceUrl が Prime Video の追加チャンネルのページです');
  }
  const type = (row.availabilityType ?? 'flatrate') || 'flatrate';
  const note = (row.note ?? '').trim();

  const channelHint = !!note && CHANNEL_HINT_RE.test(stripNegatedChannelPhrases(note));
  const notIncluded = !!note && PRIME_NOT_INCLUDED_RE.test(note);
  const includedHint = !!note && !notIncluded && PRIME_INCLUDED_RE.test(note);

  if (type === 'rent' || type === 'buy') {
    // 見放題として登録しない行。チャンネル記述があっても Prime Video 本体のレンタル・購入として扱う
    return make('rental_typed');
  }
  const rentalHint = RENTAL_HINT_RE.test(note.replace(NEGATED_RENTAL_RE, ' '));
  if (channelHint) return make(includedHint ? 'ambiguous' : 'channel');
  // 「プライム会員特典ではない／対象外」＋レンタル記述 → レンタル・購入のみ。それ以外は従来どおりチャンネル扱い
  if (notIncluded) return make(type === 'flatrate' && rentalHint ? 'rental' : 'channel');
  if (type === 'flatrate' && rentalHint) return make(includedHint ? 'ambiguous' : 'rental');
  return make(includedHint ? 'included' : 'no_evidence');
}

/** Prime Video 本体名義だが追加チャンネルの可能性がある行か（否定形の記述は除外して判定） */
export function isSuspectedPrimeChannelRow(row: VodRowLike): boolean {
  if (normalizeProviderName(row.providerName ?? '') !== 'primevideo') return false;
  if (row.sourceUrl && CHANNEL_URL_RE.test(row.sourceUrl)) return true;
  if (!row.note) return false;
  return CHANNEL_HINT_RE.test(stripNegatedChannelPhrases(row.note)) || PRIME_NOT_INCLUDED_RE.test(row.note);
}

/** URL が Prime Video の追加チャンネルページか（承認時の参照URL検証用） */
export function isPrimeChannelUrl(url: string): boolean {
  return CHANNEL_URL_RE.test(url);
}

/** 保留行を手動承認するときの入力の上限・下限 */
export const APPROVAL_REASON_MIN = 5;
export const APPROVAL_REASON_MAX = 500;
export const APPROVAL_URL_MAX = 500;

/**
 * 「Prime Video本体の見放題として承認」の入力検証（管理画面・サーバーで共通）。
 * 問題がなければ null、あればエラーメッセージを返す。
 */
export function validateApprovalFields(officialUrl: unknown, reason: unknown): string | null {
  if (typeof officialUrl !== 'string' || typeof reason !== 'string') return '参照URLと確認理由が必要です';
  const url = officialUrl.trim();
  const why = reason.trim();
  if (!url) return '公式情報のURLを入力してください';
  if (url.length > APPROVAL_URL_MAX) return `URLが長すぎます（${APPROVAL_URL_MAX}文字以内）`;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'URLの形式が正しくありません'; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'URLは http(s):// で始まるものを入力してください';
  if (isPrimeChannelUrl(url)) return 'Prime Video の追加チャンネルのページは、本体見放題の根拠になりません';
  if (why.length < APPROVAL_REASON_MIN) return `確認理由を${APPROVAL_REASON_MIN}文字以上で入力してください`;
  if (why.length > APPROVAL_REASON_MAX) return `確認理由が長すぎます（${APPROVAL_REASON_MAX}文字以内）`;
  return null;
}


/** 保留理由の1行説明（プレビュー・結果表示用） */
export function describeSuspectedPrimeChannelRow(row: VodRowLike & { workId?: string; workTitle?: string | null }): string {
  const target = row.workTitle ?? row.workId ?? '';
  const note = (row.note ?? '').trim();
  return `${target ? `${target}: ` : ''}${row.providerName}${note ? `（note: ${note.slice(0, 60)}${note.length > 60 ? '…' : ''}）` : ''}`;
}

/**
 * AI Web検索補完の結果から「Prime Video 本体名義だが追加チャンネルの可能性がある」provider を除外する。
 * AI の note / reason / officialUrl に追加チャンネルの記述があるものは採用しない（provider 名の自動書き換えはしない）。
 */
export function partitionSuspectedPrimeChannelProviders(providers: VodProvider[]): { kept: VodProvider[]; held: VodProvider[] } {
  const kept: VodProvider[] = [];
  const held: VodProvider[] = [];
  for (const p of providers) {
    const note = [p.note, p.reason].filter(Boolean).join(' ');
    const suspected = isSuspectedPrimeChannelRow({ providerName: p.providerName, note, sourceUrl: p.officialUrl ?? p.sourceUrl })
      || (!!p.sourceUrl && p.sourceUrl !== p.officialUrl && isSuspectedPrimeChannelRow({ providerName: p.providerName, sourceUrl: p.sourceUrl }));
    (suspected ? held : kept).push(p);
  }
  return { kept, held };
}
