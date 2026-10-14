// 推しに合うサブスク診断（/oshi-vod）の結果を、動画生成Worker（oshi-video-maker）へ渡す形に変換する（純粋関数・DB非依存）。
//
// 計算は一切しない。computeOshiVodDiagnosis（core.ts）が返した DiagnosisResult の値を取り出し、
// 表示用の文字列は診断ページと同じ format.ts の関数で作る（ページの表示と同じ値・同じ表記になる）。
// 動画側（oshi-video-maker）はこの値を表示するだけで、比較ロジックを持たない。

import type { DiagnosisResult, RankedService, ServiceCombo, ServiceStat } from './types';
import { formatCoverage, formatMonthlyPrice, formatWorkFraction, formatYen, priceExclusionLabel } from './format';

export const OSHI_VOD_VIDEO_PAYLOAD_VERSION = 1;

export interface VideoDiagnosisService {
  /** 正規化スラグ（例: unext） */
  service: string;
  displayName: string;
  /** TMDbのロゴパス（ページの ProviderLogo と同じ生データ。無ければ null） */
  logoPath: string | null;
  paidCount: number;
  /** 「33 / 74作品」 */
  fractionText: string;
  /** 「44.5%」（ページと同じ切り捨て） */
  coverageText: string;
  /** 月額・コスパ比較の対象か（料金を公式で確認できたサービスだけ true） */
  priceComparable: boolean;
  /** 比較対象の場合だけ月額（円） */
  monthlyPrice: number | null;
  /** 「月額2,189円（税込）」（ページのランキングと同じ表記。比較対象外は null） */
  priceText: string | null;
  /** 比較対象外の理由（ランキング行の表記。比較対象なら null） */
  priceNote: string | null;
  /** 比較対象外の理由（結論カード等の短い表記。比較対象なら null） */
  priceNoteShort: string | null;
  planName: string | null;
}

export interface VideoDiagnosisRanked extends VideoDiagnosisService {
  rank: number;
  tied: boolean;
  /** 「1位」「同率3位」（ページのランキングと同じ表記） */
  rankLabel: string;
  /** 1作品あたり料金（円・四捨五入。比較対象外は null） */
  costPerWork: number | null;
}

export interface VideoDiagnosisCombo {
  services: VideoDiagnosisService[];
  unionCount: number;
  fractionText: string;
  coverageText: string;
  /** 全サービスが料金比較対象の場合だけ合計月額 */
  totalPrice: number | null;
  /** 「合計 月額3,509円」（ページと同じ表記。合計月額が無ければ null） */
  totalPriceText: string | null;
}

export interface VideoDiagnosisPayload {
  version: typeof OSHI_VOD_VIDEO_PAYLOAD_VERSION;
  /** 選択順。slug は推しサーチDBの人物slug（personVideoSlug） */
  persons: Array<{ slug: string; name: string; group: string | null }>;
  /** 結果画面最上部の結論文 */
  headline: string;
  totals: DiagnosisResult['totals'];
  /** 作品数重視（有料見放題作品数の多い順）の全サービス */
  byWorkCount: VideoDiagnosisRanked[];
  /** 月額重視（料金比較対象のサービスだけ） */
  byMonthlyPrice: VideoDiagnosisRanked[];
  /** コスパ重視（料金比較対象のサービスだけ） */
  byCostPerWork: VideoDiagnosisRanked[];
  /** 一番多く見られる2サービス（候補が1サービスならその1サービス。0件なら null） */
  bestPair: VideoDiagnosisCombo | null;
  /** 1サービスで見放題確認できる全作品をカバーできる */
  singleCoversAll: boolean;
  /** 80%以上を最安で見る方法 */
  over80: {
    achieved: boolean;
    combo: VideoDiagnosisCombo | null;
    /** 未達の場合の、料金比較可能サービスでの最大カバー構成 */
    bestPossible: VideoDiagnosisCombo | null;
  };
  /** 配信情報の確認日（epoch ms） */
  checkedRange: { min: number; max: number } | null;
}

function toService(stat: ServiceStat, paidTotal: number): VideoDiagnosisService {
  const comparable = stat.priceComparable;
  return {
    service: stat.service,
    displayName: stat.displayName,
    logoPath: stat.logoPath ?? null,
    paidCount: stat.paidKeys.length,
    fractionText: formatWorkFraction(stat.paidKeys.length, paidTotal),
    coverageText: formatCoverage(stat.paidKeys.length, paidTotal),
    priceComparable: comparable,
    monthlyPrice: comparable ? stat.plan!.monthlyPrice : null,
    priceText: formatMonthlyPrice(stat.plan, comparable),
    priceNote: comparable ? null : priceExclusionLabel(stat.plan, 'long'),
    priceNoteShort: comparable ? null : priceExclusionLabel(stat.plan, 'short'),
    planName: stat.plan?.planName ?? null,
  };
}

function toRanked(r: RankedService, paidTotal: number): VideoDiagnosisRanked {
  return {
    ...toService(r.stat, paidTotal),
    paidCount: r.paidCount,
    rank: r.rank,
    tied: r.tied,
    rankLabel: r.tied ? `同率${r.rank}位` : `${r.rank}位`,
    costPerWork: r.costPerWork,
  };
}

function toCombo(c: ServiceCombo | null, paidTotal: number): VideoDiagnosisCombo | null {
  if (!c) return null;
  return {
    services: c.services.map((s) => toService(s, paidTotal)),
    unionCount: c.unionCount,
    fractionText: formatWorkFraction(c.unionCount, paidTotal),
    coverageText: formatCoverage(c.unionCount, paidTotal),
    totalPrice: c.totalPrice,
    totalPriceText: c.totalPrice != null ? `合計 月額${formatYen(c.totalPrice)}` : null,
  };
}

export function toVideoDiagnosisPayload(
  result: DiagnosisResult,
  persons: Array<{ slug: string; name: string }>,
): VideoDiagnosisPayload {
  const paidTotal = result.totals.paid;
  const groupByName = new Map(result.persons.map((p) => [p.name, p.group ?? null]));
  return {
    version: OSHI_VOD_VIDEO_PAYLOAD_VERSION,
    persons: persons.map((p) => ({ slug: p.slug, name: p.name, group: groupByName.get(p.name) ?? null })),
    headline: result.headline,
    totals: result.totals,
    byWorkCount: result.byWorkCount.map((r) => toRanked(r, paidTotal)),
    byMonthlyPrice: result.byMonthlyPrice.map((r) => toRanked(r, paidTotal)),
    byCostPerWork: result.byCostPerWork.map((r) => toRanked(r, paidTotal)),
    bestPair: toCombo(result.bestPair, paidTotal),
    singleCoversAll: result.singleCoversAll,
    over80: {
      achieved: result.over80.achieved,
      combo: toCombo(result.over80.combo, paidTotal),
      bestPossible: toCombo(result.over80.bestPossible, paidTotal),
    },
    checkedRange: result.checkedRange,
  };
}
