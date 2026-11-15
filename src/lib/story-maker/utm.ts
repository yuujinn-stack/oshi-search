// ストーリーズ用の計測URL（UTM付き）とファイル名（DB非依存・'use client' からも import 可）。

import { STORY_SITE_ORIGIN, type SlideCount, type StoryTarget, type StoryTemplateDef } from './templates';
import { GROUP_NAME_TO_SLUG, isAsciiSlug } from '@/lib/group-slug';

export type AbTestKey = 'slides' | 'link' | 'cta' | 'bg';
export type AbVariant = 'a' | 'b';

export interface StoryUtm {
  source: string;
  medium: string;
  campaign: string;
  content: string;
}

/** UTM の値に使える形（英小文字・数字・_・-）にそろえる */
export function sanitizeUtmValue(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/_{2,}/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 60);
}

/** 32bit FNV-1a（英数字にできない名前の識別子用。人物名から毎回同じ値になる） */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(6, '0').slice(-6);
}

/**
 * 対象の英数字の識別子（utm_content の先頭）。
 * グループの英数字slug → 既知のグループslug → 名前の英数字部分（M!LK → milk）→ 名前から作る短い識別子（t + 6桁）。
 * 管理画面で書き換えられる（日本語名の人物は分かりやすい英字に書き換えてもらう前提の初期値）。
 */
export function suggestTargetKey(target: StoryTarget | null): string {
  if (!target) return 'all';
  if (target.slug && isAsciiSlug(target.slug)) return target.slug;
  const mapped = GROUP_NAME_TO_SLUG[target.name];
  if (mapped) return mapped;
  // 英字の間の「!」は I の飾り文字として読む（M!LK → milk）
  const ascii = sanitizeUtmValue(target.name.normalize('NFKC').replace(/(?<=[A-Za-z])!(?=[A-Za-z])/g, 'i'));
  // 名前の大半が日本語のとき（例「山田花子2」→「2」）は英数字部分だけでは識別できないため使わない
  if (ascii.replace(/[-_]/g, '').length >= 2) return ascii;
  return `t${fnv1a(target.name)}`;
}

/** utm_content のパターン部分。通常は枚数（2p）、A/Bテストは test_a / test_b */
export function patternToken(slides: SlideCount, ab: { test: AbTestKey; variant: AbVariant } | null): string {
  return ab ? `${ab.test}_${ab.variant}` : `${slides}p`;
}

export function buildStoryUtm(
  template: Pick<StoryTemplateDef, 'key'>,
  targetKey: string,
  slides: SlideCount,
  ab: { test: AbTestKey; variant: AbVariant } | null,
): StoryUtm {
  const target = sanitizeUtmValue(targetKey) || 'all';
  return {
    source: 'instagram',
    medium: 'social',
    campaign: `story_${sanitizeUtmValue(template.key)}`,
    content: `${target}_${patternToken(slides, ab)}`,
  };
}

/**
 * 既存のURL（パス・完全URL・クエリ/ハッシュ付き）に UTM を付ける。
 * 既存のクエリは残し、utm_* は上書き。ハッシュ（#oshi-vod-picker 等）はクエリの後ろに残す。
 */
export function appendUtm(baseUrl: string, utm: StoryUtm, origin: string = STORY_SITE_ORIGIN): string {
  const url = new URL(baseUrl, origin);
  url.searchParams.set('utm_source', utm.source);
  url.searchParams.set('utm_medium', utm.medium);
  url.searchParams.set('utm_campaign', utm.campaign);
  url.searchParams.set('utm_content', utm.content);
  return url.toString();
}

/** 推しサーチの公開サイトのURLか（それ以外を誘導先にしたときに注意を出す） */
export function isSiteUrl(url: string, origin: string = STORY_SITE_ORIGIN): boolean {
  try {
    return new URL(url, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/** story_vod_milk_01.png / A/B は story_vod_milk_cta_a_01.png */
export function storyFileName(
  template: Pick<StoryTemplateDef, 'key'>,
  targetKey: string,
  index: number,
  ab: { test: AbTestKey; variant: AbVariant } | null,
): string {
  const parts = ['story', sanitizeUtmValue(template.key), sanitizeUtmValue(targetKey) || 'all'];
  if (ab) parts.push(ab.test, ab.variant);
  parts.push(String(index + 1).padStart(2, '0'));
  return `${parts.join('_')}.png`;
}

export function storyZipName(template: Pick<StoryTemplateDef, 'key'>, targetKey: string, ab: { test: AbTestKey; variant: AbVariant } | null): string {
  return storyFileName(template, targetKey, 0, ab).replace(/_01\.png$/, '.zip');
}
