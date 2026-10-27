// 楽天イベント管理（/admin/rakuten-events）の純粋関数：入力の検証・日本時間の扱い・開催状態・SNS投稿文の生成。
// サーバー（API・ストア）とクライアント（画面）の両方から使うため、DB・Redis・Node の API に依存しない。
//
// 方針：
// - 日時は画面では日本時間（Asia/Tokyo・UTC+9固定）で入力・表示し、DB には timestamptz で保存する。
//   終了状態は保存せず、ends_at と現在時刻から毎回判定する（終了後に放置しても「開催中」と表示しない）。
// - 商品の「確認済み」は、楽天の公式ページ（https・楽天のドメイン。アフィリエイトの計測リンクは不可）を確認元URLとして
//   保存した場合だけ。確認状態は管理者の操作でだけ変わる（APIで取得できなくても自動で「対象外」にしない）。
// - 商品単体の特典（item）・ショップ単位（shop）・購入者の条件で変わる特典（buyer_condition：楽天カード・買いまわり等）・
//   イベント全体（event_general）を区別して保存し、投稿文でも混同しない（商品単体の特典として書くのは item だけ）。
// - 投稿文の生成は ./posts.ts、イベント候補（5と0のつく日のカレンダー等）は ./candidates.ts、
//   商品の紹介候補の優先度は ./priority.ts（いずれも純粋関数）。
// - 画像は扱わない（商品画像・写真集の表紙を SNS 素材に転用しない）。

import { parseAffiliateUrl } from '@/lib/rakuten-affiliate-link';

export const SITE_ORIGIN = 'https://oshi-search.jp';

// ── 選択肢 ──────────────────────────────────────────────────────────────────────

export const EVENT_TYPES = ['marathon', 'five_zero', 'super_sale', 'black_friday', 'coupon', 'other'] as const;
export type RakutenEventType = (typeof EVENT_TYPES)[number];
export const EVENT_TYPE_LABEL: Record<RakutenEventType, string> = {
  marathon: 'お買い物マラソン',
  five_zero: '5と0のつく日',
  super_sale: '楽天スーパーSALE',
  black_friday: 'ブラックフライデー',
  coupon: '期間限定クーポン',
  other: '楽天公式の期間限定イベント・その他',
};
/** 投稿文のハッシュタグ（種類ごと。その他は付けない） */
export const EVENT_TYPE_HASHTAG: Partial<Record<RakutenEventType, string>> = {
  marathon: '#楽天お買い物マラソン',
  five_zero: '#5と0のつく日',
  super_sale: '#楽天スーパーSALE',
  black_friday: '#楽天ブラックフライデー',
};

export const ENTRY_REQUIRED = ['required', 'not_required', 'unknown'] as const;
export type EntryRequired = (typeof ENTRY_REQUIRED)[number];
export const ENTRY_REQUIRED_LABEL: Record<EntryRequired, string> = {
  required: 'エントリー必要',
  not_required: 'エントリー不要',
  unknown: '未確認',
};

export const VISIBILITIES = ['published', 'hidden'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_LABEL: Record<Visibility, string> = {
  published: '公開（投稿に使用可）',
  hidden: '非公開（下書き）',
};

export const CHECK_STATUSES = ['confirmed', 'needs_check', 'excluded'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  confirmed: '確認済み',
  needs_check: '要確認',
  excluded: '対象外',
};

export const BENEFIT_SCOPES = ['item', 'shop', 'buyer_condition', 'event_general', 'unknown'] as const;
export type BenefitScope = (typeof BENEFIT_SCOPES)[number];
export const BENEFIT_SCOPE_LABEL: Record<BenefitScope, string> = {
  item: '商品単体の特典（商品限定の割引・ポイント倍率など）',
  shop: 'ショップ単位の特典（ショップのクーポン・倍率）',
  buyer_condition: '購入者の条件で変わる特典（楽天カード・買いまわり等）',
  event_general: 'イベント全体の特典（商品の確定特典ではない）',
  unknown: '未分類',
};
export const BENEFIT_SCOPE_SHORT: Record<BenefitScope, string> = {
  item: '商品単体',
  shop: 'ショップ単位',
  buyer_condition: '購入者条件',
  event_general: 'イベント全体',
  unknown: '未分類',
};

// ── 型 ──────────────────────────────────────────────────────────────────────────

export interface RakutenEvent {
  id: number;
  name: string;
  eventType: RakutenEventType;
  /** epoch ms */
  startsAt: number;
  endsAt: number;
  officialUrl: string | null;
  entryRequired: EntryRequired;
  entryUrl: string | null;
  conditions: string | null;
  benefit: string | null;
  benefitConditions: string | null;
  lastCheckedAt: number | null;
  visibility: Visibility;
  note: string | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RakutenEventProduct {
  id: number;
  eventId: number;
  personName: string;
  category: string;
  productId: string;
  productTitle: string | null;
  checkStatus: CheckStatus;
  benefitScope: BenefitScope;
  benefitNote: string | null;
  sourceUrl: string | null;
  checkedAt: number | null;
  checkedBy: string | null;
  note: string | null;
  updatedAt: number;
}

export type EventStatus = 'upcoming' | 'active' | 'ended';
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = { upcoming: '開催前', active: '開催中', ended: '終了' };

/** 開催状態（終了日時ちょうど以降は終了） */
export function eventStatus(e: Pick<RakutenEvent, 'startsAt' | 'endsAt'>, nowMs: number): EventStatus {
  if (nowMs >= e.endsAt) return 'ended';
  if (nowMs < e.startsAt) return 'upcoming';
  return 'active';
}

/**
 * 公式情報で確認済みのイベントか（公式情報URLと最終確認日時の両方がある）。
 * イベント候補から登録した直後は最終確認日時が空のため「未確認（開催候補）」になる。
 */
export function isOfficiallyConfirmed(e: Pick<RakutenEvent, 'officialUrl' | 'lastCheckedAt'>): boolean {
  return !!e.officialUrl && e.lastCheckedAt != null;
}

/** 最終確認からこの時間を超えたら、投稿前に再確認を促す */
export const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

// ── 日本時間 ────────────────────────────────────────────────────────────────────

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** <input type="datetime-local"> の値（"YYYY-MM-DDTHH:mm"）を日本時間の壁時計時刻として解釈する。不正なら null */
export function parseJstDateTimeLocal(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi) - JST_OFFSET_MS;
  // 2月30日などの存在しない日付を弾く（繰り上がった日付と一致しない）
  const back = new Date(ms + JST_OFFSET_MS);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

function jstParts(ms: number) {
  const d = new Date(ms + JST_OFFSET_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() };
}
const pad = (n: number) => String(n).padStart(2, '0');

/** epoch ms → <input type="datetime-local"> の値（日本時間） */
export function toJstDateTimeLocal(ms: number): string {
  const p = jstParts(ms);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** 管理画面の表示用（例: 2026/11/11(火) 01:59） */
export function formatJstAdmin(ms: number): string {
  const p = jstParts(ms);
  return `${p.y}/${pad(p.mo)}/${pad(p.d)}(${WEEKDAYS[p.wd]}) ${pad(p.h)}:${pad(p.mi)}`;
}

/** 投稿文用（例: 11月11日(火) 1:59）。年が現在と違うときは年も付ける */
export function formatJstPost(ms: number, nowMs: number): string {
  const p = jstParts(ms);
  const year = p.y !== jstParts(nowMs).y ? `${p.y}年` : '';
  return `${year}${p.mo}月${p.d}日(${WEEKDAYS[p.wd]}) ${p.h}:${pad(p.mi)}`;
}

// ── URL ─────────────────────────────────────────────────────────────────────────

/** アフィリエイトの計測・短縮リンク（確認元URLにはしない） */
const AFFILIATE_HOSTS = ['hb.afl.rakuten.co.jp', 'afl.rakuten.co.jp', 'a.r10.to', 'r10.to'];

/** 楽天の公式ページか（https・rakuten.co.jp / rakuten.ne.jp とそのサブドメイン。アフィリエイトの計測リンクは除く） */
export function isOfficialRakutenUrl(v: unknown): boolean {
  if (typeof v !== 'string' || v.length > 2000) return false;
  let u: URL;
  try { u = new URL(v.trim()); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (AFFILIATE_HOSTS.includes(host)) return false;
  return ['rakuten.co.jp', 'rakuten.ne.jp'].some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * 楽天の商品ページか（商品単体の特典の根拠にできるURL）。楽天市場の商品ページ（item.rakuten.co.jp/<店舗>/<商品>）と
 * 楽天ブックスの商品ページ（books.rakuten.co.jp/rb/<番号>）。イベントの告知ページ（event.rakuten.co.jp）は商品単位の根拠にしない。
 */
export function isRakutenProductPageUrl(v: unknown): boolean {
  if (!isOfficialRakutenUrl(v)) return false;
  const u = new URL(String(v).trim());
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'item.rakuten.co.jp') return parts.length >= 2;
  if (host === 'books.rakuten.co.jp') return parts[0] === 'rb' && parts.length >= 2;
  return false;
}

/**
 * 管理画面で開く・確認元にする商品ページURL。保存された商品URLが楽天アフィリエイトの計測リンク（hb.afl…?pc=<商品ページ>）の場合は
 * 既存の parseAffiliateUrl で遷移先の商品ページを取り出す（管理者の確認でアフィリエイトのクリックを発生させないため）。
 * 商品ページが分からなければ null（推測で作らない）。
 */
export function productPageUrlOf(url: string | null | undefined): string | null {
  if (!url) return null;
  if (isRakutenProductPageUrl(url)) return url;
  const page = parseAffiliateUrl(url)?.pageUrl ?? null;
  return page && isRakutenProductPageUrl(page) ? page : null;
}

// ── 入力の検証 ──────────────────────────────────────────────────────────────────

export const MAX_NAME = 100;
export const MAX_TEXT = 1000;
export const MAX_OPERATOR = 50;

export interface EventInput {
  name: string;
  eventType: RakutenEventType;
  startsAt: number;
  endsAt: number;
  officialUrl: string | null;
  entryRequired: EntryRequired;
  entryUrl: string | null;
  conditions: string | null;
  benefit: string | null;
  benefitConditions: string | null;
  lastCheckedAt: number | null;
  visibility: Visibility;
  note: string | null;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const optText = (v: unknown, max: number): string | null | undefined => {
  if (v == null) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return null;
  return s.length <= max ? s : undefined;
};
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * イベントの入力（画面のフォームの値）を検証する。日時は "YYYY-MM-DDTHH:mm"（日本時間）。
 * 公式情報URL・エントリーURLは楽天の公式ページ（https）だけ。公開にするには公式情報URLと最終確認日時が必要。
 */
export function validateEventInput(raw: unknown): Result<EventInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = optText(r.name, MAX_NAME);
  if (!name) return { ok: false, error: `イベント名を${MAX_NAME}文字以内で入力してください` };
  if (!oneOf(EVENT_TYPES, r.eventType)) return { ok: false, error: 'イベントの種類を選んでください' };
  const startsAt = parseJstDateTimeLocal(r.startsAt);
  const endsAt = parseJstDateTimeLocal(r.endsAt);
  if (startsAt == null) return { ok: false, error: '開催開始日時を入力してください（日本時間）' };
  if (endsAt == null) return { ok: false, error: '開催終了日時を入力してください（日本時間）' };
  if (endsAt <= startsAt) return { ok: false, error: '終了日時は開始日時より後にしてください' };
  const officialUrl = optText(r.officialUrl, 2000);
  if (officialUrl === undefined || (officialUrl && !isOfficialRakutenUrl(officialUrl))) {
    return { ok: false, error: '公式情報URLは楽天の公式ページ（https://…rakuten.co.jp 等）を入力してください（アフィリエイトリンクは不可）' };
  }
  if (!oneOf(ENTRY_REQUIRED, r.entryRequired)) return { ok: false, error: 'エントリーの必要性を選んでください' };
  const entryUrl = optText(r.entryUrl, 2000);
  if (entryUrl === undefined || (entryUrl && !isOfficialRakutenUrl(entryUrl))) {
    return { ok: false, error: 'エントリーページのURLは楽天の公式ページを入力してください' };
  }
  const conditions = optText(r.conditions, MAX_TEXT);
  const benefit = optText(r.benefit, MAX_TEXT);
  const benefitConditions = optText(r.benefitConditions, MAX_TEXT);
  const note = optText(r.note, MAX_TEXT);
  if ([conditions, benefit, benefitConditions, note].some((v) => v === undefined)) {
    return { ok: false, error: `参加条件・特典・メモは${MAX_TEXT}文字以内で入力してください` };
  }
  let lastCheckedAt: number | null = null;
  if (r.lastCheckedAt != null && r.lastCheckedAt !== '') {
    lastCheckedAt = parseJstDateTimeLocal(r.lastCheckedAt);
    if (lastCheckedAt == null) return { ok: false, error: '最終確認日時の形式が正しくありません' };
  }
  if (!oneOf(VISIBILITIES, r.visibility)) return { ok: false, error: '公開・非公開を選んでください' };
  if (r.visibility === 'published' && (!officialUrl || lastCheckedAt == null)) {
    return { ok: false, error: '公開にするには公式情報URLと最終確認日時を入力してください' };
  }
  return {
    ok: true,
    value: {
      name, eventType: r.eventType, startsAt, endsAt, officialUrl, entryRequired: r.entryRequired, entryUrl,
      conditions: conditions ?? null, benefit: benefit ?? null, benefitConditions: benefitConditions ?? null,
      lastCheckedAt, visibility: r.visibility, note: note ?? null,
    },
  };
}

export function validateOperator(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= MAX_OPERATOR ? s : null;
}

export interface LinkUpdateInput {
  checkStatus: CheckStatus;
  benefitScope: BenefitScope;
  benefitNote: string | null;
  sourceUrl: string | null;
  checkedAt: number | null;
  note: string | null;
}

/**
 * 紐付けた商品の確認状態の更新を検証する。
 * - 確認済み：楽天の公式ページの確認元URL・確認日時・特典の範囲（未分類は不可）が必要。
 *   商品単体の特典（item）として確認済みにするのは、その商品の特典を公式情報で確認できた場合だけ（画面で注意書き）。
 * - 対象外：理由（メモ）が必要（取得できなかっただけで対象外にしない）。
 */
export function validateLinkUpdate(raw: unknown): Result<LinkUpdateInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!oneOf(CHECK_STATUSES, r.checkStatus)) return { ok: false, error: '確認状態を選んでください' };
  if (!oneOf(BENEFIT_SCOPES, r.benefitScope)) return { ok: false, error: '特典の範囲を選んでください' };
  const benefitNote = optText(r.benefitNote, 200);
  const note = optText(r.note, MAX_TEXT);
  const sourceUrl = optText(r.sourceUrl, 2000);
  if (benefitNote === undefined) return { ok: false, error: '特典の内容は200文字以内で入力してください' };
  if (note === undefined) return { ok: false, error: `メモは${MAX_TEXT}文字以内で入力してください` };
  if (sourceUrl === undefined || (sourceUrl && !isOfficialRakutenUrl(sourceUrl))) {
    return { ok: false, error: '確認元URLは楽天の公式ページ（https）を入力してください（アフィリエイトリンクは不可）' };
  }
  let checkedAt: number | null = null;
  if (r.checkedAt != null && r.checkedAt !== '') {
    checkedAt = parseJstDateTimeLocal(r.checkedAt);
    if (checkedAt == null) return { ok: false, error: '確認日時の形式が正しくありません' };
  }
  if (r.checkStatus === 'confirmed') {
    if (!sourceUrl) return { ok: false, error: '確認済みにするには、公式情報の確認元URLを入力してください' };
    if (checkedAt == null) return { ok: false, error: '確認済みにするには、確認日時を入力してください' };
    if (r.benefitScope === 'unknown') return { ok: false, error: '確認済みにするには、特典の範囲（商品単体・ショップ単位・購入者条件・イベント全体）を選んでください' };
    if (r.benefitScope === 'item' && !isRakutenProductPageUrl(sourceUrl)) {
      return { ok: false, error: '商品単体の特典として確認済みにするには、その商品の楽天の商品ページ（item.rakuten.co.jp / books.rakuten.co.jp/rb/）を確認元URLにしてください（イベントの告知ページは商品単位の根拠になりません）' };
    }
  }
  if (r.checkStatus === 'excluded' && !note) {
    return { ok: false, error: '対象外にする理由をメモに入力してください（取得できなかっただけの場合は「要確認」のままにしてください）' };
  }
  return { ok: true, value: { checkStatus: r.checkStatus, benefitScope: r.benefitScope, benefitNote: benefitNote ?? null, sourceUrl: sourceUrl ?? null, checkedAt, note: note ?? null } };
}

// ── 投稿文 ──────────────────────────────────────────────────────────────────────

/** 根拠なく購入を急かす・価格を断定する表現（投稿文に入れない。管理者の入力に含まれていればその項目を外す） */
export const BANNED_PHRASES = ['最安値', '最安', '底値', '値下げ', '値下がり', '買い時', '今が絶対', '絶対', '激安', '今だけ', '史上最', '一番安い', '最もお得', '最もおトク', 'お得すぎ', '買わなきゃ損', '急いで', '在庫わずか', '残りわずか'];

export function findBannedPhrases(text: string): string[] {
  return BANNED_PHRASES.filter((p) => text.includes(p));
}

/** X の文字数（X の仕様：URL は t.co 換算で23、指定範囲〔ラテン文字等〕は1、それ以外〔日本語・絵文字等〕は2。上限280）。
 * 絵文字の結合（ZWJ 等）は X では1つの絵文字として2と数えるが、ここでは構成する文字ごとに数える（多めに数える＝上限を超えない側）。 */
export function xWeightedLength(text: string): number {
  const urlRe = /https?:\/\/\S+/g;
  const urls = text.match(urlRe) ?? [];
  const rest = text.normalize('NFC').replace(urlRe, '');
  let n = urls.length * 23;
  for (const ch of rest) {
    const c = ch.codePointAt(0) ?? 0;
    n += (c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037)) ? 1 : 2;
  }
  return n;
}
export const X_MAX = 280;
/** Threads の本文の上限（文字数。UTF-16 の長さで数える＝絵文字を多めに数える） */
export const THREADS_MAX = 500;
export const INSTAGRAM_MAX = 2200;

// ── 楽天APIで確認した商品の情報（表示用・保存しない。./item-check.ts が取得し Redis に24時間だけ保持） ──

export interface ItemCheckInfo {
  itemCode: string;
  itemName: string;
  itemPrice: number | null;
  /** 1=在庫あり・0=在庫なし（API の値。無ければ null） */
  availability: number | null;
  /** 商品別のポイント倍率（1 や無しは倍付けなし。24時間以内に終わる倍付けは API が返さない） */
  pointRate: number | null;
  pointRateStartTime: string | null;
  pointRateEndTime: string | null;
  /** タイムセール（期間限定価格）の期間。設定されている商品だけ */
  saleStartTime: string | null;
  saleEndTime: string | null;
  shopName: string | null;
  fetchedAt: number;
}

/** 楽天APIの日時（"YYYY-MM-DD HH:MM"・日本時間）を epoch ms に。不正なら null */
export function parseRakutenApiTime(v: string | null | undefined): number | null {
  const m = (v ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? parseJstDateTimeLocal(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`) : null;
}

/** 楽天APIで確認できた、現在有効な商品別のポイント倍率（2倍以上・期間内）。無ければ null */
export function activePointRate(info: ItemCheckInfo | null | undefined, nowMs: number): { rate: number; endsAt: number | null } | null {
  if (!info || info.pointRate == null || info.pointRate < 2) return null;
  const start = parseRakutenApiTime(info.pointRateStartTime);
  const end = parseRakutenApiTime(info.pointRateEndTime);
  if (start != null && nowMs < start) return null;
  if (end != null && nowMs >= end) return null;
  return { rate: info.pointRate, endsAt: end };
}

/** 楽天APIで確認できた、現在有効なタイムセールの期間。無ければ null */
export function activeTimeSale(info: ItemCheckInfo | null | undefined, nowMs: number): { endsAt: number | null } | null {
  if (!info || (!info.saleStartTime && !info.saleEndTime)) return null;
  const start = parseRakutenApiTime(info.saleStartTime);
  const end = parseRakutenApiTime(info.saleEndTime);
  if (start != null && nowMs < start) return null;
  if (end != null && nowMs >= end) return null;
  return { endsAt: end };
}
