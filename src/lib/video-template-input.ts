// 動画生成ジョブのテンプレート固有入力（video_generation_jobs.template_input）。DB非依存（'use client' からも import 可）。
//
// 従来のテンプレート（1ジョブ=1人物）は template_input を使わない（NULL のまま）。
// 複数人物を1本の動画にするテンプレートだけが、Workerの報告するテンプレート情報の templateInputKind で
// 入力の種類を宣言し、ジョブ作成時にここで検証した値を template_input に保存する。
// 人物の識別子は推しサーチDBの人物slug（personVideoSlug: 'p-' + sha256(人物名)の先頭12桁）を正本にする。

import { FOLLOW_TEMPLATE_CATEGORY, type FollowFact, type FollowFactKind, type FollowLine, type FollowScene, type FollowTargetType } from './video-follow-reel';

/** 推しでサブスク比較（3人の推しに合うサブスク診断）: 人物3人 */
export const OSHI_VOD_COMPARE_INPUT_KIND = 'oshi-vod-compare-persons' as const;
export const OSHI_VOD_COMPARE_PERSON_COUNT = 3;

/**
 * 推し布教カード紹介: 1ジョブ=1人物のまま、おすすめ作品（1〜3件・選んだ順）とデザインを保存する。
 * 作品がその人物の公開作品かどうかは、ジョブ作成時にサーバーで確認する（src/server/video-jobs/job-store.ts）
 */
export const OSHI_CARD_SELECTION_INPUT_KIND = 'oshi-card-selection' as const;
export const OSHI_CARD_VIDEO_MAX_WORKS = 3;

/**
 * 推し活で損してるかも？: 1ジョブ=人物1人 または グループ1つ（グループのときは person_name にグループ名）。
 * 人物・グループの存在確認と、撮影するページのパス（pagePath）は、ジョブ作成時にサーバーで行う（src/server/video-jobs/sonkamo-target.ts）
 */
export const OSHI_SONKAMO_INPUT_KIND = 'oshi-sonkamo-target' as const;
/** 敬称（読みにもそのまま使えるひらがなだけ。空=なし）。正本は oshi-video-maker の SONKAMO_HONORIFICS（Workerが雛形と一緒に報告） */
export const OSHI_SONKAMO_HONORIFICS = ['', 'くん', 'ちゃん', 'さん'] as const;
export const OSHI_SONKAMO_LINE_IDS = ['01-hook', '02-works', '03-vod', '04-goods', '05-cta'] as const;
const SONKAMO_TEXT_MAX = 60;
const SONKAMO_KANA_MAX = 90;

/**
 * フォロー獲得リール（10種類・templateCategory=follow_growth）: 1ジョブ=人物1人 または グループ1つ（person_name に名前）。
 * 画面で選んだ作品・入力した確認済みの事実・確認した台本を保存し、シーン（画面の文字）はジョブ作成時にサーバーがDBから作り直す
 * （src/server/video-jobs/follow-target.ts。台本と構成は src/lib/video-follow-reel.ts）
 */
export const OSHI_FOLLOW_INPUT_KIND = 'oshi-follow-reel' as const;
const FOLLOW_TEXT_MAX = 70;
const FOLLOW_KANA_MAX = 110;
const FOLLOW_MAX_LINES = 8;

export type TemplateInputKind = typeof OSHI_VOD_COMPARE_INPUT_KIND | typeof OSHI_CARD_SELECTION_INPUT_KIND | typeof OSHI_SONKAMO_INPUT_KIND | typeof OSHI_FOLLOW_INPUT_KIND;
export const TEMPLATE_INPUT_KINDS: readonly TemplateInputKind[] = [OSHI_VOD_COMPARE_INPUT_KIND, OSHI_CARD_SELECTION_INPUT_KIND, OSHI_SONKAMO_INPUT_KIND, OSHI_FOLLOW_INPUT_KIND];

export interface OshiVodCompareTemplateInput {
  version: 1;
  /** 選択順（人物1→人物3）。動画内の表示順・診断の人物順になる */
  personSlugs: [string, string, string];
}

export interface OshiCardSelectionTemplateInput {
  version: 1;
  /** works.id（選んだ順にカードへ載る。公式の順位ではない） */
  workIds: string[];
  /** cool＝ノーマル・cute＝デコ（布教カードの共有URLの v と同じ値） */
  variant: 'cool' | 'cute';
}

export interface OshiSonkamoTemplateInput {
  version: 1;
  target: 'person' | 'group';
  /** 撮影する推しサーチのページ（/person/… または /groups/…）。サーバーがDBの人物・グループから決める（画面からの値は使わない） */
  pagePath?: string;
  honorific: string;
  /** グループだけ: 出演作品・配信先を見せるメンバー（null=メンバー一覧の上から、配信中の作品があるメンバー） */
  memberName: string | null;
  /** 管理画面で確認・編集したナレーション（5文。null=テンプレートの既定文） */
  lines: Array<{ id: string; text: string; kana: string }> | null;
  /**
   * CapCut 音声付きのジョブだけ: 元の音声なし動画のジョブと、そのジョブ用にアップロードした WAV・SRT（Vercel Blob）。
   * sourceOutDir（元のジョブの撮影データの場所）と原稿は、サーバーが元のジョブから付け直す（画面からの値は使わない）
   */
  audio?: OshiSonkamoAudio;
}

export interface OshiFollowTemplateInput {
  version: 1;
  templateCategory: typeof FOLLOW_TEMPLATE_CATEGORY;
  targetType: FollowTargetType;
  /** 選んだ作品（works.id・選んだ順） */
  selectedWorkIds: string[];
  /** 公式情報で確認した事実（出演予定・新作・配信開始・配信終了予定。出典URL・確認日時つき） */
  facts: FollowFact[];
  periodStart: string | null;
  pickWorkId: string | null;
  /** 管理画面で確認・編集した台本（字幕・読み。シーンと同じ数・同じ順） */
  lines: FollowLine[];
  // ここから下はサーバーがジョブ作成時に付ける（画面からの値は使わない）
  /** 動画に出す人物（人物のときは本人、グループのときはメンバー） */
  personNames?: string[];
  scenes?: FollowScene[];
  title?: string;
  /** 推しサーチの人物ページ・グループページ（投稿文のリンク） */
  pagePath?: string;
  sourceUrls?: string[];
  sourceCheckedAt?: string | null;
  resolvedAt?: string;
  /** CapCut 音声付きのジョブだけ（推し活で損してるかも？と同じ形。シーン・台本は元のジョブから付け直す） */
  audio?: OshiSonkamoAudio;
}

export interface OshiSonkamoAudio {
  sourceJobId: string;
  wavUrl: string;
  srtUrl: string;
  sourceOutDir?: string | null;
}

const VIDEO_JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** CapCut 音声のファイルの URL: 元のジョブ専用の Blob のパス（video-jobs/{元のジョブ}/capcut-….wav / .srt）だけを受け付ける */
export function isSonkamoAudioUrl(value: unknown, sourceJobId: string, ext: '.wav' | '.srt'): value is string {
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com') && u.pathname.startsWith(`/video-jobs/${sourceJobId}/capcut-`) && u.pathname.endsWith(ext);
  } catch {
    return false;
  }
}

function parseSonkamoAudio(raw: unknown): OshiSonkamoAudio {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TemplateInputError('CapCut 音声の指定がありません。');
  const o = raw as Record<string, unknown>;
  if (typeof o.sourceJobId !== 'string' || !VIDEO_JOB_ID_PATTERN.test(o.sourceJobId)) throw new TemplateInputError('元の動画のジョブの指定が不正です。');
  if (!isSonkamoAudioUrl(o.wavUrl, o.sourceJobId, '.wav')) throw new TemplateInputError('WAV はこの動画用にアップロードしたファイルだけ使えます。');
  if (!isSonkamoAudioUrl(o.srtUrl, o.sourceJobId, '.srt')) throw new TemplateInputError('SRT はこの動画用にアップロードしたファイルだけ使えます。');
  return { sourceJobId: o.sourceJobId, wavUrl: o.wavUrl, srtUrl: o.srtUrl, ...(typeof o.sourceOutDir === 'string' ? { sourceOutDir: o.sourceOutDir } : {}) };
}

export type VideoTemplateInput = OshiVodCompareTemplateInput | OshiCardSelectionTemplateInput | OshiSonkamoTemplateInput | OshiFollowTemplateInput;

/** personVideoSlug の形式 */
const PERSON_SLUG_PATTERN = /^p-[0-9a-f]{12}$/;

export function isTemplateInputKind(value: unknown): value is TemplateInputKind {
  return typeof value === 'string' && (TEMPLATE_INPUT_KINDS as readonly string[]).includes(value);
}

export class TemplateInputError extends Error {}

/**
 * 推しでサブスク比較の入力を検証して正規化する（3人ちょうど・重複なし・slug形式・順番を保持）。
 * DBに存在するかどうかは呼び出し側（サーバー）で確認する。
 */
export function parseOshiVodCompareInput(raw: unknown): OshiVodCompareTemplateInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TemplateInputError('人物3人の指定がありません。');
  const obj = raw as Record<string, unknown>;
  if (obj.version !== undefined && obj.version !== 1) throw new TemplateInputError('未対応の入力形式です。');
  const slugs = obj.personSlugs;
  if (!Array.isArray(slugs)) throw new TemplateInputError('人物3人の指定がありません。');
  if (slugs.length !== OSHI_VOD_COMPARE_PERSON_COUNT) {
    throw new TemplateInputError(`人物は${OSHI_VOD_COMPARE_PERSON_COUNT}人ちょうど選んでください（指定: ${slugs.length}人）。`);
  }
  for (const s of slugs) {
    if (typeof s !== 'string' || !PERSON_SLUG_PATTERN.test(s)) throw new TemplateInputError('不正な人物の指定があります。');
  }
  if (new Set(slugs).size !== slugs.length) throw new TemplateInputError('同じ人物が重複して選ばれています。');
  return { version: 1, personSlugs: [slugs[0], slugs[1], slugs[2]] as [string, string, string] };
}

const WORK_ID_MAX_LENGTH = 200;

/** 推し布教カード紹介の入力を検証して正規化する（1〜3件・重複なし・順番を保持・デザインは cool / cute） */
export function parseOshiCardSelectionInput(raw: unknown): OshiCardSelectionTemplateInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TemplateInputError('おすすめ作品とデザインの指定がありません。');
  const obj = raw as Record<string, unknown>;
  if (obj.version !== undefined && obj.version !== 1) throw new TemplateInputError('未対応の入力形式です。');
  const ids = obj.workIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > OSHI_CARD_VIDEO_MAX_WORKS) {
    throw new TemplateInputError(`おすすめ作品は1〜${OSHI_CARD_VIDEO_MAX_WORKS}件選んでください。`);
  }
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim() || id.length > WORK_ID_MAX_LENGTH) throw new TemplateInputError('不正な作品の指定があります。');
  }
  if (new Set(ids).size !== ids.length) throw new TemplateInputError('同じ作品が重複して選ばれています。');
  if (obj.variant !== 'cool' && obj.variant !== 'cute') throw new TemplateInputError('デザインはノーマルかデコを選んでください。');
  return { version: 1, workIds: [...(ids as string[])], variant: obj.variant };
}

/** 推し活で損してるかも？の入力を検証して正規化する（人物・グループの存在とページのパスはサーバーで確認する） */
export function parseOshiSonkamoInput(raw: unknown): OshiSonkamoTemplateInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TemplateInputError('人物かグループの指定がありません。');
  const obj = raw as Record<string, unknown>;
  if (obj.version !== undefined && obj.version !== 1) throw new TemplateInputError('未対応の入力形式です。');
  if (obj.target !== 'person' && obj.target !== 'group') throw new TemplateInputError('人物かグループかを選んでください。');
  const honorific = obj.honorific ?? '';
  if (typeof honorific !== 'string' || !(OSHI_SONKAMO_HONORIFICS as readonly string[]).includes(honorific)) {
    throw new TemplateInputError('敬称は「なし・くん・ちゃん・さん」から選んでください。');
  }
  let memberName: string | null = null;
  if (obj.memberName !== undefined && obj.memberName !== null && obj.memberName !== '') {
    if (obj.target !== 'group') throw new TemplateInputError('紹介するメンバーはグループのときだけ選べます。');
    if (typeof obj.memberName !== 'string' || !obj.memberName.trim() || obj.memberName.length > 100) throw new TemplateInputError('紹介するメンバーの指定が不正です。');
    memberName = obj.memberName.trim();
  }
  let lines: OshiSonkamoTemplateInput['lines'] = null;
  if (obj.lines !== undefined && obj.lines !== null) {
    if (!Array.isArray(obj.lines) || obj.lines.length !== OSHI_SONKAMO_LINE_IDS.length) {
      throw new TemplateInputError(`ナレーションは${OSHI_SONKAMO_LINE_IDS.length}文すべてを指定してください。`);
    }
    lines = OSHI_SONKAMO_LINE_IDS.map((id, i) => {
      const l = (obj.lines as unknown[])[i] as Record<string, unknown> | null;
      if (!l || typeof l !== 'object' || l.id !== id) throw new TemplateInputError(`ナレーションの順番が違います（${i + 1}文目）。`);
      const text = typeof l.text === 'string' ? l.text.trim() : '';
      const kana = typeof l.kana === 'string' ? l.kana.trim() : '';
      if (!text || Array.from(text).length > SONKAMO_TEXT_MAX) throw new TemplateInputError(`${i + 1}文目の字幕は1〜${SONKAMO_TEXT_MAX}文字にしてください。`);
      if (!kana || Array.from(kana).length > SONKAMO_KANA_MAX) throw new TemplateInputError(`${i + 1}文目の読みは1〜${SONKAMO_KANA_MAX}文字にしてください。`);
      return { id, text, kana };
    });
  }
  const pagePath = typeof obj.pagePath === 'string' ? obj.pagePath : undefined;
  const audio = obj.audio !== undefined && obj.audio !== null ? parseSonkamoAudio(obj.audio) : undefined;
  return { version: 1, target: obj.target, ...(pagePath ? { pagePath } : {}), honorific, memberName, lines, ...(audio ? { audio } : {}) };
}

const FOLLOW_FACT_KINDS: readonly FollowFactKind[] = ['schedule', 'release', 'streamStart', 'streamEnd'];
const optStr = (v: unknown, max: number, label: string): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > max) throw new TemplateInputError(`${label}の指定が不正です。`);
  return v.trim();
};

/**
 * フォロー獲得リールの入力の形を検証して正規化する（作品が公開作品か・事実の日付や出典・台本とシーンの対応は
 * サーバーで確認する）。サーバーが付ける項目（シーン等）は画面から受け取らない
 */
export function parseOshiFollowInput(raw: unknown): OshiFollowTemplateInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TemplateInputError('人物かグループの指定がありません。');
  const obj = raw as Record<string, unknown>;
  if (obj.version !== undefined && obj.version !== 1) throw new TemplateInputError('未対応の入力形式です。');
  if (obj.targetType !== 'person' && obj.targetType !== 'group') throw new TemplateInputError('人物かグループかを選んでください。');
  const ids = obj.selectedWorkIds ?? [];
  if (!Array.isArray(ids) || ids.length > 5 || ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > WORK_ID_MAX_LENGTH)) {
    throw new TemplateInputError('作品の指定が不正です。');
  }
  const rawFacts = obj.facts ?? [];
  if (!Array.isArray(rawFacts) || rawFacts.length > 3) throw new TemplateInputError('確認済みの情報は3件までです。');
  const facts: FollowFact[] = rawFacts.map((f, i) => {
    const o = (f ?? {}) as Record<string, unknown>;
    if (!FOLLOW_FACT_KINDS.includes(o.kind as FollowFactKind)) throw new TemplateInputError(`${i + 1}件目の情報の種類が不正です。`);
    const date = optStr(o.date, 10, '日付') ?? '';
    const sourceUrl = optStr(o.sourceUrl, 500, '出典URL') ?? '';
    const checkedAt = optStr(o.checkedAt, 16, '確認日時') ?? '';
    const fact: FollowFact = { kind: o.kind as FollowFactKind, date, sourceUrl, checkedAt };
    const workId = optStr(o.workId, WORK_ID_MAX_LENGTH, '作品');
    const title = optStr(o.title, 40, '番組名・作品名');
    const provider = optStr(o.provider, 30, '配信サービス');
    const media = optStr(o.media, 20, '放送局・配信先');
    const releaseKind = optStr(o.releaseKind, 4, '放送・公開・配信');
    const time = optStr(o.time, 5, '時刻');
    return { ...fact, ...(workId ? { workId } : {}), ...(title ? { title } : {}), ...(provider ? { provider } : {}), ...(media ? { media } : {}), ...(releaseKind ? { releaseKind } : {}), ...(time ? { time } : {}) };
  });
  const periodStart = optStr(obj.periodStart, 10, '対象期間') ?? null;
  const pickWorkId = optStr(obj.pickWorkId, WORK_ID_MAX_LENGTH, '最後に勧める作品') ?? null;
  const audio = obj.audio !== undefined && obj.audio !== null ? parseSonkamoAudio(obj.audio) : undefined;
  // CapCut 音声付きのジョブは、台本を元のジョブから付け直す（画面からは送らなくてよい）
  const rawLines = audio && (obj.lines === undefined || obj.lines === null) ? [] : obj.lines;
  if (!Array.isArray(rawLines) || (!audio && rawLines.length < 2) || rawLines.length > FOLLOW_MAX_LINES) throw new TemplateInputError('台本を生成してからジョブを作ってください。');
  const lines: FollowLine[] = rawLines.map((l, i) => {
    const o = (l ?? {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' && /^\d{2}-[a-z]+$/.test(o.id) ? o.id : null;
    const text = typeof o.text === 'string' ? o.text.trim() : '';
    const kana = typeof o.kana === 'string' ? o.kana.trim() : '';
    if (!id) throw new TemplateInputError(`台本の${i + 1}文目の指定が不正です。`);
    if (!text || Array.from(text).length > FOLLOW_TEXT_MAX) throw new TemplateInputError(`${i + 1}文目の字幕は1〜${FOLLOW_TEXT_MAX}文字にしてください。`);
    if (!kana || Array.from(kana).length > FOLLOW_KANA_MAX) throw new TemplateInputError(`${i + 1}文目の読みは1〜${FOLLOW_KANA_MAX}文字にしてください。`);
    return { id, text, kana };
  });
  return {
    version: 1,
    templateCategory: FOLLOW_TEMPLATE_CATEGORY,
    targetType: obj.targetType,
    selectedWorkIds: (ids as string[]).map((id) => id.trim()),
    facts,
    periodStart,
    pickWorkId,
    lines,
    ...(audio ? { audio } : {}),
  };
}

/** テンプレートの入力種別に応じて検証する */
export function parseTemplateInput(kind: TemplateInputKind, raw: unknown): VideoTemplateInput {
  switch (kind) {
    case OSHI_VOD_COMPARE_INPUT_KIND:
      return parseOshiVodCompareInput(raw);
    case OSHI_CARD_SELECTION_INPUT_KIND:
      return parseOshiCardSelectionInput(raw);
    case OSHI_SONKAMO_INPUT_KIND:
      return parseOshiSonkamoInput(raw);
    case OSHI_FOLLOW_INPUT_KIND:
      return parseOshiFollowInput(raw);
  }
}
