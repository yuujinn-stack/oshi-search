// ストーリーズ投稿の効果測定（記録の検証・指標の計算・A/B集計）。DB非依存の純粋関数。
//
// 計測方法：
// - リーチ・リンクスタンプのタップ数は、Instagram アプリのインサイト（ストーリーズ → 各ページのインサイト）を見て手入力する。
//   自動取得はしない。未入力の値は null のまま（推測で埋めない）。
// - サイト流入数は GA4 の「集客 → トラフィック獲得」等で、セッションのキャンペーン（utm_campaign）と
//   セッションの手動広告コンテンツ（utm_content）で絞り込んだセッション数を手入力する（任意）。
// - 指標は入力された値だけから計算し、分母が無い・0 の場合は null（表示は「—」）。

import type { AbTestKey, AbVariant } from './utm';
import { STORY_TEMPLATES, isBfTemplate, type StoryTemplateId, type SlideCount } from './templates';
import { parseBfRecordItems, type BfApprovedItem } from './bf-sale';

/**
 * 記録の枚数。既存のテンプレートは1〜3枚のまま。4枚は楽天BF（商品ページ2枚）のときだけ受け付ける。
 */
export type RecordSlideCount = SlideCount | 4;
/** 1〜3枚目のリーチ（既存の記録の形）。4枚の記録だけ4つ目を持つ */
export type ReachValues = [number | null, number | null, number | null, (number | null)?];
/** プレビュー環境で楽天BFの投稿記録を保存させないときの表示（画面・API 共通） */
export const BF_PREVIEW_RECORD_MESSAGE = 'プレビュー環境では記録を保存できません（楽天BFの投稿記録は本番の管理画面で保存してください）。';

/**
 * 楽天BFの投稿記録を保存させない環境か。Vercel の Preview は本番と同じ Redis に接続しているため、
 * 楽天BFの記録は Preview（scope='preview'）では新規・編集とも保存しない。他のテンプレート・本番・ローカルは従来どおり
 */
export function bfRecordSaveBlocked(templateId: StoryTemplateId, scope: string): boolean {
  return isBfTemplate(templateId) && scope === 'preview';
}

/** テンプレートごとの最大枚数（楽天BFだけ4） */
export function maxRecordSlides(templateId: StoryTemplateId): number {
  return templateId === 'bf' ? 4 : 3;
}

export interface StoryPostRecord {
  id: string;
  /** 投稿日時（日本時間の "YYYY-MM-DDTHH:mm"） */
  postedAt: string;
  templateId: StoryTemplateId;
  targetName: string | null;
  targetType: 'person' | 'group' | null;
  slideCount: RecordSlideCount;
  abTest: AbTestKey | null;
  abVariant: AbVariant | null;
  utmCampaign: string;
  utmContent: string;
  url: string;
  /** 1〜3枚目のリーチ（その枚数が無い・未入力は null）。4枚の記録（楽天BF）だけ4枚目も持つ */
  reach: ReachValues;
  /** リンクスタンプを置いたページ（1始まり） */
  linkSlide: number;
  linkTaps: number | null;
  /** リンク設置ページのリーチ（null なら reach[linkSlide-1] を使う） */
  linkSlideReach: number | null;
  ga4Sessions: number | null;
  memo: string;
  /**
   * 楽天BF・推し別セール紹介で掲載した商品と、承認欄で確認した価格・確認元・確認者・確認日時（bf・bfstory のときだけ。
   * 他のテンプレート・この項目ができる前の記録は無し）
   */
  saleItems?: BfApprovedItem[] | null;
  createdAt: string;
  updatedAt: string;
}

export class StoryRecordError extends Error {}

const MAX_COUNT = 100_000_000;
const AB_KEYS: AbTestKey[] = ['slides', 'link', 'cta', 'bg'];

function count(v: unknown, label: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_COUNT) {
    throw new StoryRecordError(`${label}は0以上の整数で入力してください。`);
  }
  return n;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** 管理画面から送られた記録を検証して正規化する（不正なら StoryRecordError） */
export function parseStoryPostRecord(raw: unknown, now: Date = new Date()): StoryPostRecord {
  if (!raw || typeof raw !== 'object') throw new StoryRecordError('記録の形式が正しくありません。');
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new StoryRecordError('記録のIDが正しくありません。');
  const postedAt = str(r.postedAt, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(postedAt)) throw new StoryRecordError('投稿日時を入力してください。');
  const templateId = str(r.templateId, 32) as StoryTemplateId;
  if (!STORY_TEMPLATES.some((t) => t.id === templateId)) throw new StoryRecordError('テンプレートが正しくありません。');
  const slideCount = Number(r.slideCount);
  if (slideCount === 4 && maxRecordSlides(templateId) < 4) throw new StoryRecordError('投稿枚数は1〜3枚です。');
  if (slideCount !== 1 && slideCount !== 2 && slideCount !== 3 && slideCount !== 4) throw new StoryRecordError(`投稿枚数は1〜${maxRecordSlides(templateId)}枚です。`);
  const abTest = r.abTest ? (str(r.abTest, 16) as AbTestKey) : null;
  if (abTest && !AB_KEYS.includes(abTest)) throw new StoryRecordError('A/Bテストの種類が正しくありません。');
  const abVariant = abTest ? (r.abVariant === 'a' || r.abVariant === 'b' ? r.abVariant : null) : null;
  if (abTest && !abVariant) throw new StoryRecordError('A/Bテストのパターン（A・B）を選んでください。');
  const targetType = r.targetType === 'person' || r.targetType === 'group' ? r.targetType : null;
  const reachRaw = Array.isArray(r.reach) ? r.reach : [];
  // 既存の記録と同じく3つ。4枚のときだけ4つ目を足す（3枚以下の記録の形は変えない）
  const reach = Array.from({ length: Math.max(3, slideCount) }, (_, i) =>
    i < slideCount ? count(reachRaw[i], `${i + 1}枚目のリーチ`) : null,
  ) as ReachValues;
  const linkSlide = Number(r.linkSlide);
  if (!Number.isInteger(linkSlide) || linkSlide < 1 || linkSlide > slideCount) throw new StoryRecordError('リンクを置いたページが正しくありません。');
  const nowIso = now.toISOString();
  let saleItems: BfApprovedItem[] | null = null;
  if (isBfTemplate(templateId)) {
    try {
      saleItems = parseBfRecordItems(r.saleItems);
    } catch (err) {
      throw new StoryRecordError(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    id,
    postedAt,
    templateId,
    targetName: str(r.targetName, 100) || null,
    targetType: str(r.targetName, 100) ? targetType : null,
    slideCount: slideCount as RecordSlideCount,
    abTest,
    abVariant,
    utmCampaign: str(r.utmCampaign, 80),
    utmContent: str(r.utmContent, 80),
    url: str(r.url, 1000),
    reach,
    linkSlide,
    linkTaps: count(r.linkTaps, 'リンクスタンプのタップ数'),
    linkSlideReach: count(r.linkSlideReach, 'リンク設置ページのリーチ'),
    ga4Sessions: count(r.ga4Sessions, 'GA4のサイト流入数'),
    memo: str(r.memo, 500),
    ...(saleItems ? { saleItems } : {}),
    createdAt: str(r.createdAt, 40) || nowIso,
    updatedAt: nowIso,
  };
}

/** 割合（0〜1）。分母が無い・0、分子が無いときは null */
export function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

export interface StoryPostMetrics {
  /** 1枚目 → 最後のページの閲覧維持率（2枚以上のときだけ） */
  retention: number | null;
  /** 1枚目 → 2枚目、2枚目 → 3枚目 */
  stepRetention: [number | null, number | null];
  /** リンク設置ページのリーチ（入力値、無ければそのページのリーチ） */
  linkReach: number | null;
  /** リンクタップ率＝タップ数 ÷ リンク設置ページのリーチ */
  tapRate: number | null;
  /** サイト流入率＝GA4流入数 ÷ タップ数（参考） */
  arrivalRate: number | null;
}

export function linkReachOf(r: Pick<StoryPostRecord, 'linkSlideReach' | 'reach' | 'linkSlide'>): number | null {
  return r.linkSlideReach ?? r.reach[r.linkSlide - 1] ?? null;
}

export function computeStoryMetrics(r: StoryPostRecord): StoryPostMetrics {
  const last = r.reach[r.slideCount - 1] ?? null;
  const linkReach = linkReachOf(r);
  return {
    retention: r.slideCount >= 2 ? ratio(last, r.reach[0]) : null,
    stepRetention: [
      r.slideCount >= 2 ? ratio(r.reach[1], r.reach[0]) : null,
      r.slideCount >= 3 ? ratio(r.reach[2], r.reach[1]) : null,
    ],
    linkReach,
    tapRate: ratio(r.linkTaps, linkReach),
    arrivalRate: ratio(r.ga4Sessions, r.linkTaps),
  };
}

export interface AbVariantSummary {
  posts: number;
  /** タップ率の計算に使えた投稿（タップ数とリンク設置ページのリーチが両方ある）の合計 */
  taps: number;
  linkReach: number;
  tapRate: number | null;
  /** 閲覧維持率（2枚以上で1枚目・最後のリーチが両方ある投稿の、リーチ合計どうしの比） */
  retention: number | null;
  ga4Sessions: number;
}

export interface AbGroupSummary {
  /** 集計の単位：テンプレート × A/Bテストの種類 × 対象 */
  key: string;
  templateId: StoryTemplateId;
  abTest: AbTestKey;
  targetName: string | null;
  a: AbVariantSummary;
  b: AbVariantSummary;
  /** タップ率が高い方（両方計算できたときだけ。同率は null） */
  better: AbVariant | null;
}

function summarize(records: StoryPostRecord[]): AbVariantSummary {
  let taps = 0, linkReach = 0, firstSum = 0, lastSum = 0, ga4 = 0;
  let tapPosts = 0, retentionPosts = 0;
  for (const r of records) {
    const lr = linkReachOf(r);
    if (r.linkTaps !== null && lr !== null && lr > 0) { taps += r.linkTaps; linkReach += lr; tapPosts++; }
    const first = r.reach[0], last = r.reach[r.slideCount - 1] ?? null;
    if (r.slideCount >= 2 && first !== null && last !== null && first > 0) { firstSum += first; lastSum += last; retentionPosts++; }
    if (r.ga4Sessions !== null) ga4 += r.ga4Sessions;
  }
  return {
    posts: records.length,
    taps,
    linkReach,
    tapRate: tapPosts > 0 ? taps / linkReach : null,
    retention: retentionPosts > 0 ? lastSum / firstSum : null,
    ga4Sessions: ga4,
  };
}

export function summarizeAbTests(records: StoryPostRecord[]): AbGroupSummary[] {
  const groups = new Map<string, StoryPostRecord[]>();
  for (const r of records) {
    if (!r.abTest || !r.abVariant) continue;
    const key = `${r.templateId}|${r.abTest}|${r.targetName ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, rs]) => {
    const a = summarize(rs.filter((r) => r.abVariant === 'a'));
    const b = summarize(rs.filter((r) => r.abVariant === 'b'));
    const better = a.tapRate !== null && b.tapRate !== null && a.tapRate !== b.tapRate ? (a.tapRate > b.tapRate ? 'a' : 'b') : null;
    return { key, templateId: rs[0].templateId, abTest: rs[0].abTest!, targetName: rs[0].targetName, a, b, better };
  });
}

export function formatPercent(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}

/** 記録の一覧を CSV（Excel で開ける BOM 付き UTF-8）にする */
export function storyRecordsToCsv(records: StoryPostRecord[]): string {
  const head = ['投稿日時', 'テンプレート', '対象', '枚数', 'A/Bテスト', 'パターン', 'utm_campaign', 'utm_content', '1枚目リーチ', '2枚目リーチ', '3枚目リーチ', 'リンク設置ページ', 'リンク設置ページのリーチ', 'タップ数', 'GA4流入', '閲覧維持率', 'タップ率', 'URL', 'メモ'];
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // 4枚の記録（楽天BF）があるときだけ、最後の列に「4枚目リーチ」を足す（無ければ従来と同じ列）
  const has4 = records.some((r) => r.slideCount === 4);
  if (has4) head.push('4枚目リーチ');
  const rows = records.map((r) => {
    const m = computeStoryMetrics(r);
    const tpl = STORY_TEMPLATES.find((t) => t.id === r.templateId)?.title ?? r.templateId;
    const cols = [r.postedAt, tpl, r.targetName, r.slideCount, r.abTest, r.abVariant?.toUpperCase() ?? null, r.utmCampaign, r.utmContent, r.reach[0], r.reach[1], r.reach[2], r.linkSlide, m.linkReach, r.linkTaps, r.ga4Sessions, formatPercent(m.retention), formatPercent(m.tapRate), r.url, r.memo];
    if (has4) cols.push(r.reach[3] ?? null);
    return cols.map(esc).join(',');
  });
  return `﻿${[head.join(','), ...rows].join('\n')}\n`;
}
