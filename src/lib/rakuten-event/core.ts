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
// - 投稿文に「最安値」「値下げ中」「今が絶対に買い時」などの表現は生成しない（根拠を保存する仕組みが無いため）。
//   管理者が入力した特典・条件の文にこれらが含まれる場合も、その項目は投稿文に入れず警告を出す。価格も投稿文に入れない。
// - 画像は扱わない（商品画像・写真集の表紙を SNS 素材に転用しない）。

export const SITE_ORIGIN = 'https://oshi-search.jp';

// ── 選択肢 ──────────────────────────────────────────────────────────────────────

export const EVENT_TYPES = ['marathon', 'five_zero', 'super_sale', 'coupon', 'other'] as const;
export type RakutenEventType = (typeof EVENT_TYPES)[number];
export const EVENT_TYPE_LABEL: Record<RakutenEventType, string> = {
  marathon: 'お買い物マラソン',
  five_zero: '5と0のつく日',
  super_sale: '楽天スーパーSALE',
  coupon: '期間限定クーポン',
  other: 'その他',
};
/** 投稿文のハッシュタグ（種類ごと。その他は付けない） */
const EVENT_TYPE_HASHTAG: Partial<Record<RakutenEventType, string>> = {
  marathon: '#楽天お買い物マラソン',
  five_zero: '#5と0のつく日',
  super_sale: '#楽天スーパーSALE',
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
  }
  if (r.checkStatus === 'excluded' && !note) {
    return { ok: false, error: '対象外にする理由をメモに入力してください（取得できなかっただけの場合は「要確認」のままにしてください）' };
  }
  return { ok: true, value: { checkStatus: r.checkStatus, benefitScope: r.benefitScope, benefitNote: benefitNote ?? null, sourceUrl: sourceUrl ?? null, checkedAt, note: note ?? null } };
}

// ── 投稿文 ──────────────────────────────────────────────────────────────────────

/** 根拠を保存する仕組みが無いため、投稿文に入れない表現 */
export const BANNED_PHRASES = ['最安値', '最安', '底値', '値下げ', '値下がり', '買い時', '今が絶対', '絶対', '激安', '今だけ', '史上最'];

export function findBannedPhrases(text: string): string[] {
  return BANNED_PHRASES.filter((p) => text.includes(p));
}

/** 保存カテゴリ → 人物ページの商品タブ（src/lib/product-tabs.ts の #products-<slug>） */
const CATEGORY_TAB_SLUG: Record<string, string> = {
  写真集: 'photobook', '本・雑誌': 'photobook', CD: 'cd', 'Blu-ray・DVD': 'bluray', グッズ: 'goods', 中古: 'used',
};
const CATEGORY_WORD: Record<string, string> = {
  写真集: '写真集', '本・雑誌': '書籍・雑誌', CD: 'CD', 'Blu-ray・DVD': 'Blu-ray・DVD', グッズ: 'グッズ', 中古: '中古商品',
};

export type PostChannel = 'x' | 'threads' | 'instagram_feed' | 'instagram_story';

/**
 * 推しサーチの人物ページへのリンク（SNS流入の計測用に UTM を付ける。GA4 が参照元として集計し、
 * 楽天商品のクリック〔既存の affiliate_click〕と同じ GA4 で参照元別に比べられる。新しい計測は追加しない）。
 * 人物ページは canonical が UTM なしのURLのため、SEO には影響しない。
 */
export function buildPersonLink(personName: string, opts: { eventId: number; channel: PostChannel; categories?: string[] }): string {
  const source = opts.channel === 'x' ? 'x' : opts.channel === 'threads' ? 'threads' : 'instagram';
  const params = new URLSearchParams({
    utm_source: source,
    utm_medium: 'social',
    utm_campaign: `rakuten_event_${opts.eventId}`,
  });
  if (opts.channel === 'instagram_story') params.set('utm_content', 'story');
  const tabs = [...new Set((opts.categories ?? []).map((c) => CATEGORY_TAB_SLUG[c]).filter(Boolean))];
  const hash = tabs.length === 1 ? `#products-${tabs[0]}` : '';
  return `${SITE_ORIGIN}/person/${encodeURIComponent(personName)}?${params.toString()}${hash}`;
}

/** X の文字数（全角は2・URLは23として数える。上限280） */
export function xWeightedLength(text: string): number {
  const urlRe = /https?:\/\/\S+/g;
  const urls = text.match(urlRe) ?? [];
  const rest = text.replace(urlRe, '');
  let n = urls.length * 23;
  for (const ch of rest) {
    const c = ch.codePointAt(0) ?? 0;
    n += (c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037)) ? 1 : 2;
  }
  return n;
}
export const X_MAX = 280;
export const THREADS_MAX = 500;
export const INSTAGRAM_MAX = 2200;

export interface PostInput {
  event: RakutenEvent;
  personName: string;
  /** 投稿に使う紐付け済み商品（確認済み・商品単体またはショップ単位のものだけを商品名として載せる） */
  products: RakutenEventProduct[];
  nowMs: number;
}

export interface GeneratedPosts {
  status: EventStatus;
  x: string;
  threads: string;
  instagramFeed: string;
  instagramStory: string;
  /** 画面に出す注意（投稿前に確認する点） */
  warnings: string[];
  /** 生成しなかった理由（終了したイベントなど）。このときの投稿文は空 */
  blocked: string | null;
}

const hashtagOf = (s: string) => `#${s.replace(/[\s#・、。,.!！?？()（）「」『』【】&＆'’"”-]/g, '')}`;

/**
 * SNS投稿文を作る（X・Threads・Instagram フィード・Instagram ストーリーズ）。自動投稿はしない（画面でコピーして手動で投稿する）。
 * 価格・「最安値」等は入れない。商品の特典は、確認済みで範囲が商品単体／ショップ単位のものだけ、その範囲を明記して載せる。
 * 購入者の条件で変わる特典（買いまわり・楽天カード等）は、商品の特典ではなくイベントの条件として書く。
 */
export function generatePosts(input: PostInput): GeneratedPosts {
  const { event: e, personName, nowMs } = input;
  const status = eventStatus(e, nowMs);
  const empty = { x: '', threads: '', instagramFeed: '', instagramStory: '' };
  if (status === 'ended') {
    return { status, ...empty, warnings: [], blocked: 'このイベントは終了しています（終了したイベントの投稿文は作りません）' };
  }
  const warnings: string[] = [];
  if (e.visibility !== 'published') warnings.push('イベントが「非公開（下書き）」です。内容を確認してから公開にしてください');
  if (!e.officialUrl) warnings.push('公式情報URLが未入力です');
  if (e.lastCheckedAt == null) warnings.push('最終確認日時が未入力です。公式情報で日時・条件を確認してください');
  else if (nowMs - e.lastCheckedAt > RECHECK_AFTER_MS) warnings.push('最終確認から24時間以上経っています。投稿前に公式情報を再確認してください');
  if (e.entryRequired === 'unknown') warnings.push('エントリーの必要性が未確認です（投稿文では「公式ページでご確認ください」と書きます）');

  // 管理者が入力した文のうち、根拠の無い価格表現を含むものは使わない
  const safe = (label: string, v: string | null): string | null => {
    if (!v) return null;
    const hit = findBannedPhrases(v);
    if (hit.length) { warnings.push(`${label}に「${hit.join('」「')}」が含まれるため、投稿文に入れていません`); return null; }
    return v.replace(/\s+/g, ' ').trim();
  };
  const benefit = safe('ポイント倍率・割引内容', e.benefit);
  const benefitConditions = safe('特典の適用条件', e.benefitConditions);
  const conditions = safe('参加条件', e.conditions);

  const own = input.products.filter((p) => p.personName === personName && p.eventId === e.id);
  const featured = own.filter((p) => p.checkStatus === 'confirmed' && (p.benefitScope === 'item' || p.benefitScope === 'shop'));
  const others = own.filter((p) => !featured.includes(p));
  if (own.some((p) => p.checkStatus === 'needs_check')) warnings.push('「要確認」の商品は投稿文で対象商品として扱っていません');
  if (others.some((p) => p.checkStatus === 'confirmed')) warnings.push('購入者の条件・イベント全体の特典として確認した商品は、商品の特典としては書いていません');
  const featuredLines: string[] = [];
  for (const p of featured) {
    const title = safe(`商品名（${p.productId}）`, (p.productTitle ?? '').slice(0, 40)) ?? null;
    if (!title) continue;
    const note = safe(`商品の特典（${p.productId}）`, p.benefitNote);
    const scope = p.benefitScope === 'item' ? '商品の特典' : 'ショップの特典';
    featuredLines.push(`・${title}${note ? `（${scope}：${note}）` : ''}`);
  }
  const categories = own.filter((p) => p.checkStatus !== 'excluded').map((p) => p.category);
  const words = [...new Set(categories.map((c) => CATEGORY_WORD[c]).filter(Boolean))];
  const goodsWord = words.length ? words.slice(0, 3).join('・') : '関連商品';

  const when = status === 'upcoming'
    ? `${formatJstPost(e.startsAt, nowMs)}スタート〜${formatJstPost(e.endsAt, nowMs)}まで`
    : `開催中｜${formatJstPost(e.endsAt, nowMs)}まで`;
  const entry = e.entryRequired === 'required' ? '※事前のエントリーが必要です'
    : e.entryRequired === 'not_required' ? '※エントリー不要'
      : '※エントリーの要否は楽天の公式ページでご確認ください';
  const benefitLine = benefit ? `${benefit}${benefitConditions ? `（${benefitConditions}）` : ''}` : null;
  const typeTag = EVENT_TYPE_HASHTAG[e.eventType];
  const tags = [typeTag, hashtagOf(personName), '#推しサーチ', '#PR'].filter(Boolean).join(' ');
  const prLine = '※楽天アフィリエイトを利用しています';
  const conditionNote = '※特典の内容・ポイント倍率は購入者の条件（楽天カードの利用・買いまわり等）によって変わります。最新の条件は楽天の公式ページでご確認ください';

  // X：文字数（280）に収まるよう、任意の行から落とす
  const xLink = buildPersonLink(personName, { eventId: e.id, channel: 'x', categories });
  const xRequired = [`【PR】${e.name}`, when, entry];
  const xOptional = [
    benefitLine,
    featuredLines.length ? `公式で確認済みの対象商品：${featured.length}件` : null,
  ].filter((s): s is string => !!s);
  const xTail = [`${personName}の${goodsWord}は推しサーチでまとめてチェック👇`, xLink, tags];
  let xLines = [...xRequired, ...xOptional, ...xTail];
  while (xWeightedLength(xLines.join('\n')) > X_MAX && xOptional.length) {
    xOptional.pop();
    xLines = [...xRequired, ...xOptional, ...xTail];
  }
  const x = xLines.join('\n');
  if (xWeightedLength(x) > X_MAX) warnings.push(`X の文字数が上限（${X_MAX}）を超えています（${xWeightedLength(x)}）。イベント名を短くしてください`);

  const body = (channel: PostChannel) => {
    const link = buildPersonLink(personName, { eventId: e.id, channel, categories });
    return [
      `【PR】${e.name}`,
      when,
      entry,
      ...(conditions ? [`参加条件：${conditions}`] : []),
      ...(benefitLine ? [`特典：${benefitLine}`] : []),
      ...(featuredLines.length ? ['', '公式情報で確認済みの対象商品', ...featuredLines] : []),
      '',
      `${personName}の${goodsWord}は推しサーチでまとめてチェックできます`,
      channel === 'instagram_feed' ? 'プロフィールのリンク（推しサーチ）から人物ページへどうぞ' : link,
      '',
      conditionNote,
      prLine,
      ...(e.officialUrl && channel !== 'instagram_feed' ? [`イベントの詳細（楽天公式）：${e.officialUrl}`] : []),
      '',
      tags,
    ].join('\n');
  };
  const threads = body('threads');
  if (threads.length > THREADS_MAX) warnings.push(`Threads の文字数が上限（${THREADS_MAX}）を超えています（${threads.length}）`);
  const instagramFeed = body('instagram_feed');
  if (instagramFeed.length > INSTAGRAM_MAX) warnings.push(`Instagram の文字数が上限（${INSTAGRAM_MAX}）を超えています`);

  // ストーリーズ：画像の上に載せる短い文言と、リンクスタンプに貼るURL（画像は作らない）
  const instagramStory = [
    '【PR】',
    e.name,
    when,
    entry,
    `${personName}の${goodsWord}は推しサーチで👆`,
    '',
    '--- リンクスタンプのURL ---',
    buildPersonLink(personName, { eventId: e.id, channel: 'instagram_story', categories }),
    '',
    '※ストーリーズにも「PR」の表記と、楽天アフィリエイトを利用している旨を入れてください',
  ].join('\n');

  return { status, x, threads, instagramFeed, instagramStory, warnings: [...new Set(warnings)], blocked: null };
}
