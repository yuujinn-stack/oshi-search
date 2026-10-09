// /oshi-vod の URL パラメータ解析・組み立て（DB非依存。'use client' からも import 可）。
//
// 人物の識別子は既存システムの正式な一意キーである personName（persons テーブルの主キー。
// 人物ページURL /person/{name} と同じ）をそのまま使う。表示名の別名（aliases）は識別子に使わない。
//
// - p      … 診断する人物（結果ページ）。最大12人
// - with   … 人物ページ・グループページからの導線で、選択済みにしておく人物（入口ページ）
// - group  … メンバー選択パネルを開いておくグループ名（12人超のグループ導線）
// - size   … 診断結果画像のサイズ（feed / story）

export const OSHI_VOD_PATH = '/oshi-vod';
export const OSHI_VOD_MAX_PERSONS = 12;
/** 異常に長い値を無視するための上限（人物名として十分な長さ） */
const MAX_NAME_LENGTH = 60;

export type OshiVodImageSize = 'feed' | 'story';
export const OSHI_VOD_IMAGE_SIZES: Record<OshiVodImageSize, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

type RawParam = string | string[] | undefined;

function toList(raw: RawParam): string[] {
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** 前後空白除去・空/長すぎる値の除外・重複除去（初出順を維持） */
export function normalizeNameList(raw: RawParam): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of toList(raw)) {
    const name = v.trim();
    if (!name || name.length > MAX_NAME_LENGTH || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export interface ParsedOshiVodParams {
  /** 診断対象（最大12人に切り詰め済み） */
  names: string[];
  /** 13人目以降が指定されていた */
  overflow: boolean;
  /** 選択済みにしておく人物（最大12人） */
  withNames: string[];
  /** メンバー選択を開いておくグループ */
  group: string | null;
}

export function parseOshiVodParams(params: Record<string, RawParam>): ParsedOshiVodParams {
  const names = normalizeNameList(params.p);
  const withNames = normalizeNameList(params.with);
  const groupRaw = toList(params.group)[0]?.trim() ?? '';
  return {
    names: names.slice(0, OSHI_VOD_MAX_PERSONS),
    overflow: names.length > OSHI_VOD_MAX_PERSONS,
    withNames: withNames.slice(0, OSHI_VOD_MAX_PERSONS),
    group: groupRaw && groupRaw.length <= MAX_NAME_LENGTH ? groupRaw : null,
  };
}

/** 公開人物に存在する名前だけを残す（存在しない名前は unknown に） */
export function resolveKnownNames(names: string[], known: Set<string>): { valid: string[]; unknown: string[] } {
  const valid: string[] = [];
  const unknown: string[] = [];
  for (const n of names) (known.has(n) ? valid : unknown).push(n);
  return { valid, unknown };
}

function buildQuery(key: string, names: string[]): string {
  return names.slice(0, OSHI_VOD_MAX_PERSONS).map((n) => `${key}=${encodeURIComponent(n)}`).join('&');
}

/** 診断結果ページ（共有URL）のパス */
export function buildOshiVodResultPath(names: string[]): string {
  const q = buildQuery('p', names);
  return q ? `${OSHI_VOD_PATH}?${q}` : OSHI_VOD_PATH;
}

/** 人物を選択済みにした入口ページのパス（人物ページ・グループページからの導線） */
export function buildOshiVodWithPath(names: string[]): string {
  const q = buildQuery('with', names);
  return q ? `${OSHI_VOD_PATH}?${q}#oshi-vod-picker` : OSHI_VOD_PATH;
}

/** グループのメンバー選択を開いた入口ページのパス（12人超のグループ用） */
export function buildOshiVodGroupPath(groupName: string): string {
  return `${OSHI_VOD_PATH}?group=${encodeURIComponent(groupName)}#oshi-vod-picker`;
}

/** 診断結果画像のパス */
export function buildOshiVodImagePath(names: string[], size: OshiVodImageSize = 'feed'): string {
  const q = buildQuery('p', names);
  return `/api/oshi-vod/image?${q}${size === 'story' ? '&size=story' : ''}`;
}

export function parseImageSize(raw: string | null | undefined): OshiVodImageSize {
  return raw === 'story' ? 'story' : 'feed';
}
