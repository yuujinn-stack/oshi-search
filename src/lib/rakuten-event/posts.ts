// 楽天イベントの SNS 投稿文（X・Threads・Instagram フィード・Instagram ストーリーズ）を作る純粋関数。自動投稿はしない。
//
// 投稿の型（pattern）：
//   info  … 情報提供型：開催期間・参加条件・購入前の注意を伝える（商品は出さない）
//   oshi  … 推し別紹介型：選んだ人物・グループの、推しサーチに掲載中の商品一覧への案内とイベントを組み合わせる
//   deal  … お得速報型：特典を公式根拠つきで確認した商品（商品単体の特典＝A）だけを、根拠のある倍率・価格とともに紹介する
//
// 守ること：
// - 「最安値」「絶対お得」「今が一番安い」「値下げ中」等（BANNED_PHRASES）は生成しない。管理者の入力に含まれれば外して警告。
// - 要確認・対象外の商品について、特典が確認されたかのような表現をしない（商品名を出すときは「対象かは商品ページで確認」と添える）。
// - ショップ単位（B）・購入者条件（C）の特典を商品単体の割引として書かない。確認できていない情報（D）は載せない。
// - 価格は、楽天APIで取得した値（取得時刻つき）を「お得速報型」で確認済みの商品にだけ載せる（DB の保存価格は使わない）。
// - 冒頭で何の情報かを示し、購入を急かさない。PR 表記を入れる。リンクは推しサーチのページ（UTM 付き）だけで、
//   楽天アフィリエイトのURLは載せない（短縮・改変もしない）。
// - 終了したイベントは作らない。非公開・公式未確認・テスト用の名前のイベントは「プレビュー」扱い（公開用コピー不可）。
import {
  EVENT_TYPE_HASHTAG, INSTAGRAM_MAX, RECHECK_AFTER_MS, SITE_ORIGIN, THREADS_MAX, X_MAX,
  activePointRate, activeTimeSale, eventStatus, findBannedPhrases, formatJstPost, isOfficiallyConfirmed, xWeightedLength,
  type EventStatus, type ItemCheckInfo, type RakutenEvent, type RakutenEventProduct,
} from './core';

export const POST_PATTERNS = ['info', 'oshi', 'deal'] as const;
export type PostPattern = (typeof POST_PATTERNS)[number];
export const POST_PATTERN_LABEL: Record<PostPattern, string> = {
  info: '① 情報提供型（開催・参加条件・注意点）',
  oshi: '② 推し別紹介型（人物・グループの商品と組み合わせ）',
  deal: '③ お得速報型（特典を確認した商品だけ）',
};

export type PostChannel = 'x' | 'threads' | 'instagram_feed' | 'instagram_story';

export interface PostTarget {
  kind: 'person' | 'group';
  name: string;
  /** サイト内のパス（例 /person/<名前>・/groups/<slug>） */
  path: string;
}

/** 保存カテゴリ → 人物ページの商品タブ（src/lib/product-tabs.ts の #products-<slug>） */
const CATEGORY_TAB_SLUG: Record<string, string> = {
  写真集: 'photobook', '本・雑誌': 'photobook', CD: 'cd', 'Blu-ray・DVD': 'bluray', グッズ: 'goods', 中古: 'used',
};
const CATEGORY_WORD: Record<string, string> = {
  写真集: '写真集', '本・雑誌': '書籍・雑誌', CD: 'CD', 'Blu-ray・DVD': 'Blu-ray・DVD', グッズ: 'グッズ', 中古: '中古商品',
};

export const personPath = (name: string) => `/person/${encodeURIComponent(name)}`;

/**
 * 推しサーチのページへのリンク（SNS流入の計測用 UTM。GA4 が参照元として集計し、既存の affiliate_click と参照元別に比べられる。
 * 新しい計測は追加しない）。人物ページで1カテゴリだけなら、そのタブへのページ内リンクを付ける。canonical は UTM なしのため SEO に影響しない。
 */
export function buildSiteLink(path: string, opts: { eventId: number; channel: PostChannel; pattern?: PostPattern; categories?: string[] }): string {
  const source = opts.channel === 'x' ? 'x' : opts.channel === 'threads' ? 'threads' : 'instagram';
  const params = new URLSearchParams({ utm_source: source, utm_medium: 'social', utm_campaign: `rakuten_event_${opts.eventId}` });
  const content = [opts.channel === 'instagram_story' ? 'story' : null, opts.pattern ?? null].filter(Boolean).join('_');
  if (content) params.set('utm_content', content);
  const tabs = path.startsWith('/person/') ? [...new Set((opts.categories ?? []).map((c) => CATEGORY_TAB_SLUG[c]).filter(Boolean))] : [];
  const hash = tabs.length === 1 ? `#products-${tabs[0]}` : '';
  return `${SITE_ORIGIN}${path}?${params.toString()}${hash}`;
}

/** Phase 1 互換：人物ページへのリンク */
export function buildPersonLink(personName: string, opts: { eventId: number; channel: PostChannel; categories?: string[] }): string {
  return buildSiteLink(personPath(personName), opts);
}

/** Threads の文字数（Threads の仕様：上限500字。絵文字は UTF-8 のバイト数で数える） */
export function threadsLength(text: string): number {
  let n = 0;
  for (const ch of text) n += /\p{Extended_Pictographic}|\p{Regional_Indicator}|[‍️]/u.test(ch) ? new TextEncoder().encode(ch).length : 1;
  return n;
}

// ── 投稿してよいか（誤投稿の防止） ──────────────────────────────────────────────────

const TEST_NAME_RE = /テスト|動作確認|削除予定|ダミー|\btest\b|サンプル/i;

export interface Readiness {
  status: EventStatus;
  /** 公開用のコピーができない理由（1つでもあればプレビュー扱い） */
  blockers: string[];
  /** 投稿前に確認する点（コピーはできる） */
  warnings: string[];
}

export function postReadiness(e: RakutenEvent, nowMs: number): Readiness {
  const status = eventStatus(e, nowMs);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (status === 'ended') blockers.push('このイベントは終了しています');
  if (e.visibility !== 'published') blockers.push('イベントが「非公開（下書き）」です。公式情報を確認してから「公開」にしてください');
  if (!isOfficiallyConfirmed(e)) blockers.push('公式情報で未確認のイベントです（公式情報URLと最終確認日時を入力してください）');
  if (TEST_NAME_RE.test(e.name)) blockers.push('イベント名にテスト用の語（テスト・動作確認など）が含まれています');
  if (status !== 'ended') {
    if (e.lastCheckedAt != null && nowMs - e.lastCheckedAt > RECHECK_AFTER_MS) warnings.push('最終確認から24時間以上経っています。投稿前に公式情報を再確認してください');
    if (e.entryRequired === 'unknown') warnings.push('エントリーの必要性が未確認です（投稿文では「公式ページでご確認ください」と書きます）');
    if (status === 'active' && e.endsAt - nowMs < 3 * 60 * 60 * 1000) warnings.push('終了まで3時間を切っています。投稿が終了後に読まれる可能性があります');
  }
  return { status, blockers, warnings };
}

// ── 投稿文 ──────────────────────────────────────────────────────────────────────

export interface PostInput {
  event: RakutenEvent;
  pattern: PostPattern;
  /** info では省略可（省略時はトップページへ案内） */
  target: PostTarget | null;
  /** イベントに紐付けた商品（対象の人物・グループの商品だけを使う） */
  products: RakutenEventProduct[];
  /** グループのとき、対象に含める人物名 */
  memberNames?: string[];
  /** 紐付けた商品の楽天APIの確認結果（紐付けID → 情報。24時間以内のキャッシュ） */
  apiInfo?: Record<number, ItemCheckInfo | undefined>;
  nowMs: number;
}

export interface GeneratedPosts {
  readiness: Readiness;
  /** 生成しなかった理由（終了・お得速報型の根拠なし など）。このときの投稿文は空 */
  blocked: string | null;
  x: string;
  threads: string;
  instagramFeed: string;
  /** ストーリーズに載せる短い文（URL は含めない） */
  instagramStory: string;
  /** ストーリーズのリンクスタンプ用URL（文とは別にコピーする） */
  storyLinkUrl: string;
  warnings: string[];
}

const hashtagOf = (s: string) => `#${s.replace(/[\s#・、。,.!！?？()（）「」『』【】&＆'’"”-]/g, '')}`;
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
function jstShort(ms: number): string {
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** お得速報型に載せられる根拠（確認済み・商品単体・商品ページの確認元URLがあり、API の倍率・タイムセール・価格または管理者が確認した特典の内容がある） */
export function dealEvidence(p: RakutenEventProduct, info: ItemCheckInfo | undefined, nowMs: number): string[] | null {
  if (p.checkStatus !== 'confirmed' || p.benefitScope !== 'item' || !p.sourceUrl) return null;
  const parts: string[] = [];
  const pr = activePointRate(info, nowMs);
  if (pr) parts.push(`ポイント${pr.rate}倍${pr.endsAt ? `（${jstShort(pr.endsAt)}まで）` : ''}`);
  const sale = activeTimeSale(info, nowMs);
  if (sale) parts.push(`期間限定価格${sale.endsAt ? `（${jstShort(sale.endsAt)}まで）` : ''}`);
  if (info?.itemPrice != null && info.itemPrice > 0 && (pr || sale)) parts.push(`${yen(info.itemPrice)}（${jstShort(info.fetchedAt)}時点）`);
  if (p.benefitNote && !findBannedPhrases(p.benefitNote).length) parts.push(p.benefitNote.replace(/\s+/g, ' ').trim());
  return parts.length ? parts : null;
}

export function generatePosts(input: PostInput): GeneratedPosts {
  const { event: e, pattern, target, nowMs } = input;
  const readiness = postReadiness(e, nowMs);
  const empty = { x: '', threads: '', instagramFeed: '', instagramStory: '', storyLinkUrl: '' };
  if (readiness.status === 'ended') return { readiness, blocked: 'このイベントは終了しています（終了したイベントの投稿文は作りません）', ...empty, warnings: [] };
  if (pattern !== 'info' && !target) return { readiness, blocked: '投稿する人物またはグループを選んでください', ...empty, warnings: [] };
  const warnings: string[] = [...readiness.warnings];

  const safe = (label: string, v: string | null): string | null => {
    if (!v) return null;
    const hit = findBannedPhrases(v);
    if (hit.length) { warnings.push(`${label}に「${hit.join('」「')}」が含まれるため、投稿文に入れていません`); return null; }
    return v.replace(/\s+/g, ' ').trim();
  };
  const benefit = safe('ポイント倍率・割引内容', e.benefit);
  const benefitConditions = safe('特典の適用条件', e.benefitConditions);
  const conditions = safe('参加条件', e.conditions);

  // 対象の商品：人物はその人物、グループはメンバーの商品。対象外は使わない
  const names = new Set(target ? (target.kind === 'person' ? [target.name] : input.memberNames ?? []) : []);
  const own = input.products.filter((p) => p.eventId === e.id && names.has(p.personName) && p.checkStatus !== 'excluded');
  const categories = own.map((p) => p.category);
  const words = [...new Set(categories.map((c) => CATEGORY_WORD[c]).filter(Boolean))];
  const goodsWord = words.length ? words.slice(0, 3).join('・') : '関連商品';

  const deals = own
    .map((p) => ({ p, ev: dealEvidence(p, input.apiInfo?.[p.id], nowMs) }))
    .filter((d): d is { p: RakutenEventProduct; ev: string[] } => !!d.ev);
  if (pattern === 'deal' && !deals.length) {
    return {
      readiness, ...empty, warnings,
      blocked: 'お得速報型を作れる商品がありません。商品単体の特典（A）として、商品ページの確認元URLつきで「確認済み」にした商品が必要です（楽天APIで倍率・タイムセールを確認するか、確認した特典の内容を入力してください）',
    };
  }
  if (own.some((p) => p.checkStatus === 'needs_check')) warnings.push('「要確認」の商品は、特典の対象として扱っていません');
  if (own.some((p) => p.checkStatus === 'confirmed' && (p.benefitScope === 'shop' || p.benefitScope === 'buyer_condition' || p.benefitScope === 'event_general'))) {
    warnings.push('ショップ単位・購入者条件・イベント全体の特典として確認した商品は、商品の割引としては書いていません');
  }

  const when = readiness.status === 'upcoming'
    ? `${formatJstPost(e.startsAt, nowMs)}〜${formatJstPost(e.endsAt, nowMs)}`
    : `開催中・${formatJstPost(e.endsAt, nowMs)}まで`;
  const entry = e.entryRequired === 'required' ? '事前のエントリーが必要です'
    : e.entryRequired === 'not_required' ? 'エントリーは不要です'
      : 'エントリーの要否は楽天の公式ページでご確認ください';
  const benefitLine = benefit ? `${benefit}${benefitConditions ? `（${benefitConditions}）` : ''}` : null;
  const typeTag = EVENT_TYPE_HASHTAG[e.eventType];
  const targetTag = target ? hashtagOf(target.name) : null;
  const tagsShort = [typeTag, targetTag, '#PR'].filter(Boolean).join(' ');
  const tagsLong = [typeTag, targetTag, '#推し活', '#推しサーチ', '#PR'].filter(Boolean).join(' ');
  const prLine = '※楽天アフィリエイトを利用しています（PR）';
  const conditionNote = '※ポイント倍率・特典は購入者の条件（楽天カードの利用・買いまわり等）で変わります。最新の条件は楽天の公式ページでご確認ください';
  const calmNote = '※買う前に、予算と本当に欲しいものを一度整理しておくと安心です';
  const linkPath = target?.path ?? '/';
  const link = (channel: PostChannel) => buildSiteLink(linkPath, { eventId: e.id, channel, pattern, categories });
  const subject = target?.name ?? '';

  // 冒頭（何の情報かを最初に示す）
  const head = pattern === 'info' ? `【PR】${e.name}の参加前チェック`
    : pattern === 'oshi' ? `【PR】${subject}を応援している方へ｜${e.name}`
      : `【PR】${subject}の商品で確認できた${e.name}の特典`;

  const dealLinesOf = (maxTitle: number) => deals.slice(0, 3).map(({ p, ev }) => {
    const full = p.productTitle ?? '';
    const title = safe(`商品名（${p.productId}）`, full.length > maxTitle ? `${full.slice(0, maxTitle)}…` : full) ?? '';
    return `・${title}：${ev.join('／')}`;
  }).filter((l) => !l.startsWith('・：'));
  const dealLines = dealLinesOf(40);
  if (pattern === 'deal') warnings.push('価格・倍率は楽天APIまたは確認元ページで確認した時点の情報です。投稿直前にもう一度ご確認ください');

  // 本文の部品（必須 → 任意の順。文字数を超えたら任意の行を後ろから落とす）
  type Lines = { required: string[]; optional: string[]; tail: string[] };
  // X は文字数が少ないため短い言い回しにする（PR は冒頭の【PR】と #PR で必ず示し、アフィリエイト利用の一文は入る範囲で入れる）
  const entryShort = e.entryRequired === 'required' ? '要エントリー' : e.entryRequired === 'not_required' ? 'エントリー不要' : 'エントリー要否は公式で確認';
  const prShort = '（楽天アフィリエイト利用）';
  const build = (channel: PostChannel): Lines => {
    const isFeed = channel === 'instagram_feed';
    const isX = channel === 'x';
    const goTo = isFeed
      ? `推しサーチのプロフィールのリンクから${subject ? `「${subject}」の` : ''}ページをご覧ください`
      : link(channel);
    const tags = isFeed || channel === 'threads' ? tagsLong : tagsShort;
    if (pattern === 'info') {
      return {
        required: [head, `期間：${when}`, isX ? entryShort : `エントリー：${entry}`],
        optional: [
          ...(isX ? [prShort] : []),
          ...(benefitLine ? [`特典：${benefitLine}`] : []),
          ...(conditions && !isX ? [`参加条件：${conditions}`] : []),
          ...(isX ? [] : [conditionNote, calmNote]),
          ...(e.officialUrl && !isFeed && !isX ? [`公式ページ：${e.officialUrl}`] : []),
        ],
        tail: [
          isX ? `${subject ? `${subject}の` : '推しの'}関連商品は推しサーチで👇` : subject ? `${subject}の${goodsWord}は推しサーチでまとめて見られます` : '推しの関連商品は推しサーチでまとめて見られます',
          goTo, ...(isX ? [] : [prLine]), tags,
        ],
      };
    }
    if (pattern === 'oshi') {
      return {
        required: [head, `期間：${when}／${isX ? entryShort : entry}`],
        optional: [
          ...(isX ? [prShort] : []),
          ...(benefitLine ? [`特典：${benefitLine}`] : []),
          ...(isX ? [] : [conditionNote, calmNote]),
        ],
        tail: [
          isX ? `${subject}の${goodsWord}は推しサーチで一覧に👇（対象かは各商品ページで確認を）` : `${subject}の${goodsWord}を推しサーチで一覧にしています。イベントの対象かは各商品ページでご確認ください`,
          goTo, ...(isX ? [] : [prLine]), tags,
        ],
      };
    }
    // お得速報型も期間（終了日時）は必ず入れる。X は商品名を短くする
    const lines = isX ? dealLinesOf(20) : dealLines;
    return {
      required: [head, `期間：${when}`, ...lines.slice(0, 1)],
      optional: [...(isX ? [prShort] : []), isX ? entryShort : `エントリー：${entry}`, ...lines.slice(1), ...(isX ? [] : [conditionNote])],
      tail: [isX ? '確認時点の情報です👇' : '価格・倍率は確認時点の情報で、変わることがあります', goTo, ...(isX ? [] : [prLine]), tags],
    };
  };
  const fit = (channel: PostChannel, len: (s: string) => number, max: number): string => {
    const { required, optional, tail } = build(channel);
    const opt = [...optional];
    const text = () => [...required, ...opt, ...tail].join('\n');
    // 後ろの任意の行から落とす（X では先頭のアフィリエイト利用の一文を最後まで残す）
    while (len(text()) > max && opt.length) opt.pop();
    const t = text();
    if (len(t) > max) warnings.push(`${channel === 'x' ? 'X' : channel === 'threads' ? 'Threads' : 'Instagram'} の文字数が上限（${max}）を超えています（${len(t)}）。イベント名・人物名を短くしてください`);
    return t;
  };

  const x = fit('x', xWeightedLength, X_MAX);
  const threads = fit('threads', threadsLength, THREADS_MAX);
  const instagramFeed = fit('instagram_feed', (s) => s.length, INSTAGRAM_MAX);
  const storyLines = pattern === 'deal'
    ? [`PR｜${e.name}`, `${subject}の商品で確認できた特典`, ...dealLines.slice(0, 2), '確認時点の情報です']
    : [`PR｜${e.name}`, when, entry, subject ? `${subject}の${goodsWord}は推しサーチで👆` : '推しの関連商品は推しサーチで👆'];
  const instagramStory = [...storyLines, '※楽天アフィリエイトを利用しています'].join('\n');

  // 生成した文に禁止表現が無いことを最後に確かめる（入力由来の混入の防止）
  const all = [x, threads, instagramFeed, instagramStory].join('\n');
  const hit = findBannedPhrases(all);
  if (hit.length) return { readiness, ...empty, warnings, blocked: `投稿文に使えない表現（${hit.join('・')}）が含まれるため作成しませんでした。商品名・特典の内容を確認してください` };

  return { readiness, blocked: null, x, threads, instagramFeed, instagramStory, storyLinkUrl: link('instagram_story'), warnings: [...new Set(warnings)] };
}

/** プレビュー（公開用にできない）としてコピーするときの先頭の印 */
export const PREVIEW_MARK = '【プレビュー・投稿しないでください】';
