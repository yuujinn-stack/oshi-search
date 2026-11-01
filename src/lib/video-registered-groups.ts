// 動画「登録グループ紹介」シリーズ（リール5種類・ストーリーズ5種類。templateCategory=registered_groups）の構成（純粋関数・'use client' 可）。
//
// ・主役は推しサーチの現在の登録状況。グループ名・件数はテンプレートに固定せず、ジョブ作成時にサーバーがDBから作り直す
//   （src/server/video-jobs/registered-target.ts。一覧はトップページ「グループで探す」と同じ getAllGroupsMerged、人物数は getAllPersonsMerged）。
// ・ジャンル（男性アイドル・女性アイドル・その他）はトップページの明示的な分類（src/lib/home-group-category.ts）だけを使う。
//   一覧に無いグループは「分類なし」とし、男性・女性・その他（アイドル以外）のどれにも入れない（名前・メンバーから推測しない）。
//   全グループの一覧（R1・S1）では「分類なし」の見出しで表示する。
// ・グループ名はナレーションで読み上げない（画面に表示するだけ。読み仮名を推測しない）。読むのは件数と固定の文だけ。
// ・1ジョブ=1本（person_name は「推しサーチ」）。管理画面で除外・並べ替えができ、件数は表示するグループの数と必ず一致させる。
// ・画面は「区間（ナレーション1文）」ごとに1ページ以上。一覧はページに分け、1ページは2列×5段（長い名前は1段を使う）。

import { findHomeGroupCategory } from './home-group-category';
import { countFollowMora, numberKana } from './video-follow-reel';

export const REGISTERED_TEMPLATE_CATEGORY = 'registered_groups' as const;
/** ジョブの person_name（人物・グループではなく推しサーチ全体の動画） */
export const REGISTERED_JOB_NAME = '推しサーチ';
export const REGISTERED_SITE_URL = 'https://oshi-search.jp/';

export const REGISTERED_REEL_IDS = [
  'registered_groups_all',
  'registered_groups_male',
  'registered_groups_female',
  'registered_groups_other',
  'registered_groups_progress',
] as const;
export const REGISTERED_STORY_IDS = [
  'story_registered_groups_all',
  'story_registered_groups_male',
  'story_registered_groups_female',
  'story_registered_groups_other',
  'story_registered_groups_future',
] as const;
export const REGISTERED_TEMPLATE_IDS = [...REGISTERED_REEL_IDS, ...REGISTERED_STORY_IDS] as const;
export type RegisteredReelId = (typeof REGISTERED_REEL_IDS)[number];
export type RegisteredStoryId = (typeof REGISTERED_STORY_IDS)[number];
export type RegisteredTemplateId = (typeof REGISTERED_TEMPLATE_IDS)[number];

export const isRegisteredTemplateId = (id: unknown): id is RegisteredTemplateId => typeof id === 'string' && (REGISTERED_TEMPLATE_IDS as readonly string[]).includes(id);
export const isRegisteredReelId = (id: unknown): id is RegisteredReelId => typeof id === 'string' && (REGISTERED_REEL_IDS as readonly string[]).includes(id);
export const isRegisteredStoryId = (id: unknown): id is RegisteredStoryId => typeof id === 'string' && (REGISTERED_STORY_IDS as readonly string[]).includes(id);

// ─── ジャンル ───────────────────────────────

export type RegisteredCategory = 'male' | 'female' | 'other' | 'unclassified';
export const REGISTERED_CATEGORIES: readonly RegisteredCategory[] = ['male', 'female', 'other', 'unclassified'];
/** 画面の見出し（male/female/other はトップページの分類。unclassified はトップページの一覧に無いグループ） */
export const REGISTERED_CATEGORY_LABEL: Record<RegisteredCategory, string> = {
  male: '男性アイドル',
  female: '女性アイドル',
  other: 'バンド・アーティスト・お笑いなど',
  unclassified: '分類なし',
};

export function registeredCategoryOf(name: string): RegisteredCategory {
  switch (findHomeGroupCategory(name)) {
    case 'maleIdol':
      return 'male';
    case 'femaleIdol':
      return 'female';
    case 'other':
      return 'other';
    default:
      return 'unclassified';
  }
}

export interface RegisteredGroup {
  /** 公式名・推しサーチの表示名（トップページと同じ文字列） */
  name: string;
  category: RegisteredCategory;
  /** 推しサーチのグループページのパス */
  href: string;
}

// ─── テンプレート ───────────────────────────────

export type RegisteredScreen = 'male' | 'female' | 'all';

export interface RegisteredTemplateSpec {
  kind: 'reel' | 'story';
  /** 一覧に入れるグループのジャンル（空=一覧なし） */
  categories: readonly RegisteredCategory[];
  /** 一覧をジャンルごとの見出しで分けるか */
  byCategory: boolean;
  /** 一覧は登録グループの一部（1ページ分）だけ */
  sampleOnly?: boolean;
  /** 実際のサイト画面（トップページ「グループで探す」。male/female はその絞り込み）を見せる区間 */
  screen?: RegisteredScreen;
  /** 登録人物数・グループ数の区間 */
  stats?: boolean;
  title: string;
  guide: string;
}

const ALL: readonly RegisteredCategory[] = REGISTERED_CATEGORIES;

export const REGISTERED_TEMPLATE_SPECS: Record<RegisteredTemplateId, RegisteredTemplateSpec> = {
  registered_groups_all: { kind: 'reel', categories: ALL, byCategory: true, title: '推しサーチの登録グループをご紹介！', guide: '現在登録されている全グループを、ジャンル別にページを分けて表示します（グループ名は画面表示のみ。読み上げは件数と案内だけ）。' },
  registered_groups_male: { kind: 'reel', categories: ['male'], byCategory: false, screen: 'male', title: '男性アイドル・グループも多数登録中！', guide: 'トップページの分類で「男性アイドル」のグループを一覧表示し、トップページ「グループで探す」（男性アイドル）の実画面を見せます。' },
  registered_groups_female: { kind: 'reel', categories: ['female'], byCategory: false, screen: 'female', title: '女性アイドルグループも登録しています！', guide: 'トップページの分類で「女性アイドル」のグループを一覧表示し、トップページ「グループで探す」（女性アイドル）の実画面を見せます。' },
  registered_groups_other: { kind: 'reel', categories: ['other'], byCategory: false, screen: 'all', title: 'アイドル以外のグループも登録中！', guide: 'トップページの分類で「その他（お笑い・バンド・俳優集団など）」に登録されたグループだけを一覧表示します（分類なしのグループは入れません）。実画面はトップページ「グループで探す」です。' },
  registered_groups_progress: { kind: 'reel', categories: [], byCategory: false, screen: 'all', stats: true, title: '推しサーチの現在の登録状況！', guide: '現在の登録人物数・グループ数と、トップページ「グループで探す」の実画面を見せます（グループの選択は不要）。' },
  story_registered_groups_all: { kind: 'story', categories: ALL, byCategory: true, title: '現在登録中の全グループ', guide: '全グループと登録グループ数を、ジャンル別にページを分けて表示します（音声なし）。' },
  story_registered_groups_male: { kind: 'story', categories: ['male'], byCategory: false, title: '男性アイドル 登録グループ', guide: 'トップページの分類で「男性アイドル」のグループを一覧表示します（音声なし）。' },
  story_registered_groups_female: { kind: 'story', categories: ['female'], byCategory: false, title: '女性アイドル 登録グループ', guide: 'トップページの分類で「女性アイドル」のグループを一覧表示します（音声なし）。' },
  story_registered_groups_other: { kind: 'story', categories: ['other'], byCategory: false, title: 'バンド・アーティスト・お笑いなど 登録グループ', guide: 'トップページの分類で「その他」に登録されたグループを大きく表示します（分類なしのグループは入れません。音声なし）。' },
  story_registered_groups_future: { kind: 'story', categories: ALL, byCategory: false, sampleOnly: true, stats: true, title: 'これからも登録を増やします', guide: '登録人物数・グループ数と、登録グループの一部（1ページ分）を表示します（音声なし）。' },
};

// ─── ページ分け ───────────────────────────────

/**
 * 1ページの一覧の置き方。標準は2列×5段。リールで標準だと一覧が4ページを超える（登録が多い）ときは3列×6段にする
 * （リールの長さに収めるため。ストーリーズは読みやすさを優先して常に2列×5段で、ページが増えれば長くする）。
 * 横幅の目安（太字。全角=1・英大文字=0.8・英小文字/数字=0.64・空白=0.3・記号=0.5。oshi-video-maker の描画と同じ）が wideEm より大きい名前、
 * または空白で区切った1語が wideWordEm より大きい名前は1段を使う（列のカードでは2行に収まらない・語の途中で折り返すため）
 */
export interface RegisteredGrid {
  columns: number;
  rows: number;
  wideEm: number;
  wideWordEm: number;
}
export const REGISTERED_GRID_STANDARD: RegisteredGrid = { columns: 2, rows: 5, wideEm: 11, wideWordEm: 9 };
export const REGISTERED_GRID_DENSE: RegisteredGrid = { columns: 3, rows: 6, wideEm: 7, wideWordEm: 6 };
/** リールでこれより多いページになるときは REGISTERED_GRID_DENSE にする */
export const REGISTERED_REEL_STANDARD_MAX_PAGES = 4;

export function nameEm(name: string): number {
  let em = 0;
  for (const ch of name) {
    if (ch.charCodeAt(0) >= 0x2000) em += 1;
    else if (/[A-Z]/.test(ch)) em += 0.8;
    else if (/[a-z0-9]/.test(ch)) em += 0.64;
    else if (ch === ' ') em += 0.3;
    else em += 0.5;
  }
  return Math.round(em * 100) / 100;
}

export function isWideName(name: string, grid: RegisteredGrid = REGISTERED_GRID_STANDARD): boolean {
  return nameEm(name) > grid.wideEm || name.split(/\s+/).some((w) => nameEm(w) > grid.wideWordEm);
}

export interface RegisteredPageItem {
  name: string;
  wide: boolean;
}

export interface RegisteredPage {
  /** ページの見出し（ジャンル名・「登録グループ」など） */
  heading: string;
  /** 見出しの件数（このジャンル・この一覧のグループ数） */
  count: number;
  /** 同じ見出しの中のページ番号（1始まり）と総数 */
  part: number;
  parts: number;
  /** 置き方（列・段） */
  columns: number;
  rows: number;
  items: RegisteredPageItem[];
}

/** 並べた順のまま列×段に置き、収まらなくなったら次のページ（長い名前は1段。前の段の右が空くことがある＝描画も同じ置き方） */
export function paginateRegistered(names: string[], grid: RegisteredGrid = REGISTERED_GRID_STANDARD): RegisteredPageItem[][] {
  const pages: RegisteredPageItem[][] = [];
  let cur: RegisteredPageItem[] = [];
  let row = 0;
  let col = 0;
  for (const name of names) {
    const wide = isWideName(name, grid);
    let r = row;
    let c = col;
    if (wide && c !== 0) {
      r++;
      c = 0;
    }
    if (r >= grid.rows) {
      pages.push(cur);
      cur = [];
      r = 0;
      c = 0;
    }
    cur.push({ name, wide });
    if (wide || c === grid.columns - 1) {
      row = r + 1;
      col = 0;
    } else {
      row = r;
      col = c + 1;
    }
  }
  if (cur.length > 0) pages.push(cur);
  return pages;
}

function pagesFor(heading: string, names: string[], grid: RegisteredGrid): RegisteredPage[] {
  const chunks = paginateRegistered(names, grid);
  return chunks.map((items, i) => ({ heading, count: names.length, part: i + 1, parts: chunks.length, columns: grid.columns, rows: grid.rows, items }));
}

// ─── 選択（除外・並べ替え） ───────────────────────────────

export interface RegisteredSelection {
  /** 表示順（グループ名。並べ替えたときだけ。null=トップページと同じ順） */
  order: string[] | null;
  /** 表示しないグループ名 */
  excluded: string[];
}
export const EMPTY_REGISTERED_SELECTION: RegisteredSelection = { order: null, excluded: [] };

/** 並べ替え・除外を当てたグループ（登録に無い名前があれば errors） */
export function applyRegisteredSelection(groups: RegisteredGroup[], selection: RegisteredSelection): { ordered: RegisteredGroup[]; shown: RegisteredGroup[]; errors: string[] } {
  const byName = new Map(groups.map((g) => [g.name, g]));
  const errors: string[] = [];
  const unknown = [...(selection.order ?? []), ...selection.excluded].filter((n) => !byName.has(n));
  if (unknown.length > 0) errors.push(`登録されていないグループが含まれています: ${[...new Set(unknown)].join('、')}（一覧を読み込み直してください）`);
  const seen = new Set<string>();
  const ordered: RegisteredGroup[] = [];
  for (const n of selection.order ?? []) {
    const g = byName.get(n);
    if (g && !seen.has(n)) {
      seen.add(n);
      ordered.push(g);
    }
  }
  for (const g of groups) if (!seen.has(g.name)) ordered.push(g);
  const excluded = new Set(selection.excluded);
  return { ordered, shown: ordered.filter((g) => !excluded.has(g.name)), errors };
}

// ─── 台本・区間 ───────────────────────────────

export type RegisteredSegmentKind = 'hook' | 'list' | 'screen' | 'stats' | 'message' | 'outro';

/** 1区間=ナレーション1文（ストーリーズはナレーションなし）。一覧の区間は1ページ以上 */
export interface RegisteredSegment {
  id: string;
  kind: RegisteredSegmentKind;
  slotSeconds: number;
  label?: string;
  title?: string;
  lines?: string[];
  pages?: RegisteredPage[];
  stats?: { persons: number; groups: number };
  screen?: RegisteredScreen;
}

export interface RegisteredLine {
  id: string;
  text: string;
  kana: string;
}

export interface RegisteredCounts {
  /** 登録人物数（トップページの「登録タレント」と同じ） */
  persons: number;
  /** 登録グループ数（トップページの「グループ対応」と同じ） */
  groups: number;
  /** この動画の一覧に表示するグループ数（一覧の無いテンプレートは 0） */
  shown: number;
  /** 一覧の対象ジャンルのうち除外したグループ数 */
  excluded: number;
}

export type RegisteredPlanResult =
  | {
      ok: true;
      segments: RegisteredSegment[];
      /** リールだけ（区間と同じ数・同じ順）。ストーリーズは空 */
      lines: RegisteredLine[];
      title: string;
      counts: RegisteredCounts;
      shownGroups: string[];
      warnings: string[];
    }
  | { ok: false; missing: string[] };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 「〇組」の読み */
export function kumiKana(n: number): string {
  if (n === 1) return 'ひとくみ';
  if (n === 2) return 'ふたくみ';
  return `${numberKana(n)}くみ`;
}

/** 「〇人」の読み */
export function ninKana(n: number): string {
  if (n === 1) return 'ひとり';
  if (n === 2) return 'ふたり';
  const k = numberKana(n);
  // 4人=よにん・14人=じゅうよにん（よん → よ）。7人は「ななにん」
  return `${k.endsWith('よん') ? k.slice(0, -1) : k}にん`;
}

const OUTRO_LINE: RegisteredLine = {
  id: '',
  text: 'これからも登録グループを増やしていきます！引き続き、推しサーチをよろしくお願いします！',
  kana: 'これからもとうろくぐるーぷをふやしていきます！ひきつづき、おしさーちをよろしくおねがいします！',
};

/** 一覧のジャンルの言い方（台本。表示するグループにあるジャンルだけ） */
function categoryPhrase(shown: RegisteredGroup[]): { text: string; kana: string } | null {
  const has = (c: RegisteredCategory) => shown.some((g) => g.category === c);
  const parts: Array<[string, string]> = [];
  if (has('male')) parts.push(['男性アイドル', 'だんせいあいどる']);
  if (has('female')) parts.push(['女性アイドル', 'じょせいあいどる']);
  if (has('other')) parts.push(['バンドやお笑い', 'ばんどやおわらい']);
  if (parts.length < 2) return null;
  return { text: `${parts.map((p) => p[0]).join('、')}など、いろいろなグループをチェックできます！`, kana: `${parts.map((p) => p[1]).join('、')}など、いろいろなぐるーぷをちぇっくできます！` };
}

/**
 * 区間と台本（既定の文）を作る。groups はトップページと同じ順の現在の登録グループ（ジャンルつき）。
 * 一覧のジャンルにグループが無い・除外で0件になる場合は作らない（不足を返す）
 */
export function buildRegisteredPlan(opts: {
  templateId: RegisteredTemplateId;
  groups: RegisteredGroup[];
  personCount: number;
  selection: RegisteredSelection;
}): RegisteredPlanResult {
  const { templateId, groups, personCount, selection } = opts;
  const spec = REGISTERED_TEMPLATE_SPECS[templateId];
  const { ordered, shown: shownAll, errors } = applyRegisteredSelection(groups, selection);
  const missing = [...errors];
  const target = ordered.filter((g) => spec.categories.includes(g.category));
  let shown = shownAll.filter((g) => spec.categories.includes(g.category));
  if (spec.categories.length > 0 && target.length === 0) missing.push(`対象のジャンル（${spec.categories.map((c) => REGISTERED_CATEGORY_LABEL[c]).join('・')}）に登録グループがありません`);
  else if (spec.categories.length > 0 && shown.length === 0) missing.push('表示するグループがありません（すべて除外されています）');
  if (groups.length === 0) missing.push('登録グループを読み込めません');
  if (missing.length > 0) return { ok: false, missing };

  const warnings: string[] = [];
  if (spec.sampleOnly) shown = paginateRegistered(shown.map((g) => g.name), REGISTERED_GRID_STANDARD)[0].map((it) => shown.find((g) => g.name === it.name)!);
  const counts: RegisteredCounts = { persons: personCount, groups: groups.length, shown: spec.categories.length > 0 ? shown.length : 0, excluded: target.length - shownAll.filter((g) => spec.categories.includes(g.category)).length };

  // 一覧のページ（リールで標準の置き方だと4ページを超えるときは3列×6段）
  const buildPages = (grid: RegisteredGrid): RegisteredPage[] => {
    if (spec.byCategory) {
      return REGISTERED_CATEGORIES.flatMap((c) => {
        const names = shown.filter((g) => g.category === c).map((g) => g.name);
        return names.length > 0 ? pagesFor(REGISTERED_CATEGORY_LABEL[c], names, grid) : [];
      });
    }
    if (spec.categories.length === 0) return [];
    const heading = spec.sampleOnly ? '登録グループの一部' : spec.categories.length === 1 ? REGISTERED_CATEGORY_LABEL[spec.categories[0]] : '登録グループ';
    return pagesFor(heading, shown.map((g) => g.name), grid);
  };
  let pages = buildPages(REGISTERED_GRID_STANDARD);
  if (spec.kind === 'reel' && pages.length > REGISTERED_REEL_STANDARD_MAX_PAGES) {
    pages = buildPages(REGISTERED_GRID_DENSE);
    warnings.push(`登録グループが多いため、一覧を3列×6段の${pages.length}ページにしました（リールの長さが目安の15〜18秒を超えることがあります。${REGISTERED_REEL_LONG_MAX_SECONDS}秒まで）`);
  }
  const unclassified = shown.filter((g) => g.category === 'unclassified').map((g) => g.name);
  if (unclassified.length > 0) warnings.push(`トップページの分類が無いグループ（${unclassified.join('、')}）は「分類なし」の見出しで表示します（男性・女性・その他の動画には入りません）`);

  type Draft = Omit<RegisteredSegment, 'id' | 'slotSeconds'> & { line?: Omit<RegisteredLine, 'id'> };
  const d: Draft[] = [];
  const n = counts.shown;
  const shownNote = counts.excluded > 0 ? `（登録 ${target.length}組のうち）` : '';
  switch (templateId) {
    case 'registered_groups_all': {
      const phrase = categoryPhrase(shown);
      d.push({ kind: 'hook', label: '推しサーチ', title: '登録グループを\nご紹介！', lines: [`${counts.excluded > 0 ? '紹介' : '登録'}グループ ${n}組${shownNote}`], line: { text: '推しサーチの登録グループをご紹介！', kana: 'おしさーちのとうろくぐるーぷをごしょうかい！' } });
      d.push({
        kind: 'list',
        pages,
        line: {
          text: `現在はこんなグループが登録されています。${phrase?.text ?? 'ぜひチェックしてください！'}`,
          kana: `げんざいはこんなぐるーぷがとうろくされています。${phrase?.kana ?? 'ぜひちぇっくしてください！'}`,
        },
      });
      d.push({ kind: 'outro', title: 'これからも登録グループを\n増やしていきます！', lines: ['引き続き、推しサーチをよろしくお願いします！'], line: OUTRO_LINE });
      break;
    }
    case 'registered_groups_male':
    case 'registered_groups_female':
    case 'registered_groups_other': {
      const c = spec.categories[0];
      const hook =
        c === 'male'
          ? { title: '男性アイドル・グループも\n多数登録中！', line: { text: '男性アイドル・グループも多数登録中！', kana: 'だんせいあいどる・ぐるーぷもたすうとうろくちゅう！' } }
          : c === 'female'
            ? { title: '女性アイドルグループも\n登録しています！', line: { text: '女性アイドルグループも登録しています！', kana: 'じょせいあいどるぐるーぷもとうろくしています！' } }
            : { title: 'アイドル以外の\nグループも登録中！', line: { text: 'アイドル以外のグループも登録中！', kana: 'あいどるいがいのぐるーぷもとうろくちゅう！' } };
      d.push({ kind: 'hook', label: '推しサーチ', title: hook.title, line: hook.line });
      d.push({
        kind: 'list',
        pages,
        line:
          c === 'other'
            ? { text: `バンドやアーティスト、お笑いなど${n}組を紹介します！`, kana: `ばんどやあーてぃすと、おわらいなど${kumiKana(n)}をしょうかいします！` }
            : { text: `現在登録中のグループはこちら！${n}組を紹介します。`, kana: `げんざいとうろくちゅうのぐるーぷはこちら！${kumiKana(n)}をしょうかいします。` },
      });
      d.push({
        kind: 'screen',
        screen: spec.screen,
        label: '実際のサイト画面',
        title: 'トップページ「グループで探す」',
        line: { text: 'トップページからグループ別にチェックできます！', kana: 'とっぷぺーじからぐるーぷべつにちぇっくできます！' },
      });
      d.push({ kind: 'outro', title: 'これからも登録グループを\n増やしていきます！', lines: ['引き続き、推しサーチをよろしくお願いします！'], line: OUTRO_LINE });
      break;
    }
    case 'registered_groups_progress': {
      d.push({ kind: 'hook', label: '推しサーチ', title: '現在の登録状況！', line: { text: '推しサーチの現在の登録状況！', kana: 'おしさーちのげんざいのとうろくじょうきょう！' } });
      d.push({
        kind: 'stats',
        stats: { persons: counts.persons, groups: counts.groups },
        line: { text: `人物${counts.persons}人、グループ${counts.groups}組が登録中！`, kana: `じんぶつ${ninKana(counts.persons)}、ぐるーぷ${kumiKana(counts.groups)}がとうろくちゅう！` },
      });
      d.push({
        kind: 'screen',
        screen: 'all',
        label: '実際のサイト画面',
        title: 'トップページ「グループで探す」',
        line: { text: 'トップページからグループ別にチェックできます！', kana: 'とっぷぺーじからぐるーぷべつにちぇっくできます！' },
      });
      d.push({ kind: 'message', title: 'これからも人物や出演作品の\n情報を増やしていきます', line: { text: 'これからも人物や出演作品の情報を増やしていきます！', kana: 'これからもじんぶつやしゅつえんさくひんのじょうほうをふやしていきます！' } });
      d.push({ kind: 'outro', title: '引き続き\nよろしくお願いします！', line: { text: '引き続き、推しサーチをよろしくお願いします！', kana: 'ひきつづき、おしさーちをよろしくおねがいします！' } });
      break;
    }
    case 'story_registered_groups_all':
      d.push({ kind: 'hook', label: '推しサーチ', title: '現在登録中の\n全グループ', lines: [`${counts.excluded > 0 ? '紹介' : '登録'}グループ ${n}組${shownNote}`] });
      d.push({ kind: 'list', pages });
      d.push({ kind: 'outro', title: 'これからも\n追加していきます！',  });
      break;
    case 'story_registered_groups_male':
    case 'story_registered_groups_female':
    case 'story_registered_groups_other': {
      const c = spec.categories[0];
      d.push({ kind: 'hook', label: REGISTERED_CATEGORY_LABEL[c], title: '現在登録中の\nグループはこちら！', lines: [`${n}組${shownNote}`] });
      d.push({ kind: 'list', pages });
      d.push({ kind: 'outro', title: 'これからも登録グループを\n増やしていきます！',  });
      break;
    }
    case 'story_registered_groups_future':
      d.push({ kind: 'stats', label: '推しサーチの登録状況', stats: { persons: counts.persons, groups: counts.groups } });
      d.push({ kind: 'list', pages });
      d.push({ kind: 'outro', title: 'これからも登録する\n人物・グループを\n増やしていきます！', lines: ['引き続き推しサーチをよろしくお願いします！'] });
      break;
  }

  const segments: RegisteredSegment[] = d.map(({ line: _line, ...s }, i) => ({ ...s, id: `${pad2(i + 1)}-${s.kind}`, slotSeconds: 0 }));
  const lines: RegisteredLine[] = spec.kind === 'reel' ? d.map((x, i) => ({ id: segments[i].id, text: x.line!.text, kana: x.line!.kana })) : [];
  const slots = allocateRegisteredSlots(spec.kind, segments, lines);
  const totalSeconds = slots.reduce((a, b) => a + b, 0);
  if (spec.kind === 'story' && totalSeconds > REGISTERED_STORY_MAX_SECONDS + 1e-9) {
    // 1本に収まらないときは文字を小さくしたり切り替えを速めたりせず、グループを省略もしない（除外で分けて複数のストーリーズにする）
    return { ok: false, missing: [`ストーリーズ1本（${REGISTERED_STORY_MAX_SECONDS}秒まで）に収まりません（${totalSeconds.toFixed(1)}秒・${shown.length}組）。グループを除外して2本以上に分けて作成してください`] };
  }
  return { ok: true, segments: segments.map((s, i) => ({ ...s, slotSeconds: slots[i] })), lines, title: spec.title, counts, shownGroups: shown.map((g) => g.name), warnings };
}

// ─── 長さ ───────────────────────────────

export const REGISTERED_MORA_PER_SECOND = 8;
/** リールの目安（15〜18秒）。音声なしは読み上げの見積もりから約16秒に伸ばす */
export const REGISTERED_REEL_TARGET_SECONDS = 16;
export const REGISTERED_REEL_SOFT_MAX_SECONDS = 18;
/** リールの上限（CapCut 音声に合わせた動画と同じ21秒）。超える台本はジョブを作らない */
export const REGISTERED_REEL_MAX_SECONDS = 21;
/** 登録が多く一覧が4ページを超えるリールの上限（一覧を最後まで見せるため。oshi-video-maker の CapCut 音声の配分も同じ） */
export const REGISTERED_REEL_LONG_MAX_SECONDS = 30;
/** 一覧の1ページを見せる最短の長さ（音声なし。4ページを超えるときは1.8秒。CapCut 音声付きは oshi-video-maker で1.5秒以上を確かめる） */
export const REGISTERED_REEL_PAGE_SECONDS = 2.2;
export const REGISTERED_REEL_DENSE_PAGE_SECONDS = 1.8;

/** このリールの長さの上限（一覧が4ページを超えるときは30秒） */
export function registeredReelMaxSeconds(segments: Array<Pick<RegisteredSegment, 'pages'>>): number {
  const pages = segments.reduce((a, s) => a + (s.pages?.length ?? 0), 0);
  return pages > REGISTERED_REEL_STANDARD_MAX_PAGES ? REGISTERED_REEL_LONG_MAX_SECONDS : REGISTERED_REEL_MAX_SECONDS;
}
/** ストーリーズ: 一覧の1ページの長さ（読みやすさを優先。ページが多ければ12秒を超えてよい） */
export const REGISTERED_STORY_PAGE_SECONDS = 3.0;
export const REGISTERED_STORY_MIN_SECONDS = 7;
/** ストーリーズ1本の上限（Instagram のストーリーズ1枚の動画の長さ。超える一覧は1本にしない） */
export const REGISTERED_STORY_MAX_SECONDS = 60;
/** 1区間の長さの上限（oshi-video-maker の入力の検証と同じ） */
export const REGISTERED_SEGMENT_MAX_SECONDS = 60;

export const estimateRegisteredSeconds = (kana: string) => Math.round((countFollowMora(kana) / REGISTERED_MORA_PER_SECOND) * 100) / 100;

const pageCount = (s: Pick<RegisteredSegment, 'pages'>) => s.pages?.length ?? 0;

/**
 * 区間の長さ。リール: 読み上げの見積もり+0.3秒（一覧はページ数×2.2秒以上）を、合計が約16秒になるよう伸ばす（冒頭は伸ばさない）。
 * ストーリーズ: 冒頭1.8秒・一覧はページ数×3秒・数字2.8秒・締め2.4秒（合計7秒未満なら一覧・締めを伸ばす）
 */
export function allocateRegisteredSlots(kind: 'reel' | 'story', segments: Array<Pick<RegisteredSegment, 'kind' | 'pages'>>, lines: Array<Pick<RegisteredLine, 'kana'>>): number[] {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  if (kind === 'story') {
    const base = segments.map((s) => (s.kind === 'hook' ? 1.8 : s.kind === 'list' ? Math.max(1, pageCount(s)) * REGISTERED_STORY_PAGE_SECONDS : s.kind === 'stats' ? 2.8 : 2.4));
    const sum = base.reduce((a, b) => a + b, 0);
    if (sum >= REGISTERED_STORY_MIN_SECONDS) return base.map(r1);
    const ratio = (REGISTERED_STORY_MIN_SECONDS - base.reduce((a, b, i) => a + (segments[i].kind === 'hook' ? b : 0), 0)) / base.reduce((a, b, i) => a + (segments[i].kind === 'hook' ? 0 : b), 0);
    return base.map((b, i) => r1(segments[i].kind === 'hook' ? b : b * ratio));
  }
  const base = segments.map((s, i) => {
    const est = estimateRegisteredSeconds(lines[i]?.kana ?? '') + 0.3;
    const perPage = pageCount(s) > REGISTERED_REEL_STANDARD_MAX_PAGES ? REGISTERED_REEL_DENSE_PAGE_SECONDS : REGISTERED_REEL_PAGE_SECONDS;
    const min = s.kind === 'hook' ? 2.0 : s.kind === 'list' ? Math.max(1, pageCount(s)) * perPage : s.kind === 'outro' ? 2.4 : 2.0;
    return Math.min(REGISTERED_SEGMENT_MAX_SECONDS, Math.max(min, est));
  });
  const sum = base.reduce((a, b) => a + b, 0);
  if (sum >= REGISTERED_REEL_TARGET_SECONDS) return base.map(r1);
  const fixed = base.reduce((a, b, i) => a + (segments[i].kind === 'hook' ? b : 0), 0);
  const ratio = (REGISTERED_REEL_TARGET_SECONDS - fixed) / (sum - fixed);
  const out = base.map((b, i) => r1(segments[i].kind === 'hook' ? b : b * ratio));
  out[out.length - 1] = r1(out[out.length - 1] + (REGISTERED_REEL_TARGET_SECONDS - out.reduce((a, b) => a + b, 0)));
  return out;
}

export interface RegisteredLineCheck {
  id: string;
  estimateSeconds: number;
  slotSeconds: number;
  overlong: boolean;
}

export function checkRegisteredLines(segments: RegisteredSegment[], lines: RegisteredLine[]): RegisteredLineCheck[] {
  return lines.map((l) => {
    const slot = segments.find((s) => s.id === l.id)?.slotSeconds ?? 0;
    const estimate = estimateRegisteredSeconds(l.kana);
    return { id: l.id, estimateSeconds: estimate, slotSeconds: slot, overlong: estimate > slot };
  });
}

/** ストーリーズのリンクスタンプに設定するURL（推奨。リンクスタンプは Instagram 側で手動で付ける） */
export function registeredStoryLinkUrl(templateId: RegisteredTemplateId): string | null {
  return REGISTERED_TEMPLATE_SPECS[templateId].kind === 'story' ? REGISTERED_SITE_URL : null;
}
