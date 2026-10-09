// 推しに合うサブスク診断（/oshi-vod）の型定義。DB 非依存（'use client' からも import 可）。
import type { VodPlanInfo } from '@/lib/vod-plan-info';
import type { VodProviderType } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

/** 診断対象として選ばれた人物1人分の入力（公開作品は getPublishedWorks 系で取得済みのもの） */
export interface DiagnosisPersonInput {
  name: string;
  group?: string;
  works: WorkRecord[];
}

/**
 * 1つの配信情報の分類。
 * - paid    … 有料サブスク（vod-plan-info の kind='subscription'）の見放題（flatrate）。ランキング対象
 * - free    … 配信種別 free / ads、または無料サービス（kind='free'）の配信
 * - rental  … レンタル（rent）・購入（buy）。見放題ランキングには入れず詳細比較のみ
 * - channel … Prime Video 追加チャンネル（別料金）。Prime Video 本体には数えない
 * - other   … vod-plan-info 未登録サービスの見放題（推測で分類せず「その他」として詳細比較のみ）
 */
export type ProviderBucket = 'paid' | 'free' | 'rental' | 'channel' | 'other';

export interface WorkServiceRef {
  /** normalizeProviderName() の正規化スラグ */
  service: string;
  displayName: string;
  type: VodProviderType;
  bucket: ProviderBucket;
  /** ProviderLogo 用の生データ（TMDbロゴパス） */
  logoPath?: string;
  /** Prime Video 追加チャンネル等のバッジ */
  badgeLabel?: string | null;
}

/** 重複排除後のユニーク作品 */
export interface DiagnosisWork {
  /** 重複排除キー（canonicalWorkId ?? id） */
  key: string;
  /** 表示用の代表行 */
  work: WorkRecord;
  /** この作品に出演している選択人物（選択順） */
  personNames: string[];
  /** 配信情報の確認日（既存 vodUpdatedAt の最大値。存在しない場合は undefined） */
  checkedAt?: number;
  /** 「今すぐ見られる」（既存 getStreamingProviders 判定で1件以上） */
  isStreaming: boolean;
  services: WorkServiceRef[];
}

export interface ServiceStat {
  service: string;
  displayName: string;
  logoPath?: string;
  plan: VodPlanInfo | null;
  /** 月額・コスパ比較に使えるか（isPriceComparable） */
  priceComparable: boolean;
  /** 有料見放題で見られる作品キー */
  paidKeys: string[];
  /** 無料で見られる作品キー */
  freeKeys: string[];
  /** レンタル・購入で見られる作品キー */
  rentalKeys: string[];
}

export interface RankedService {
  stat: ServiceStat;
  rank: number;
  /** 同じ順位の他サービスがあるか */
  tied: boolean;
  paidCount: number;
  /** 価格比較可能な場合のみ */
  monthlyPrice: number | null;
  /** 1作品あたり料金（円、四捨五入）。価格比較可能かつ作品数1以上の場合のみ */
  costPerWork: number | null;
}

export interface ServiceCombo {
  services: ServiceStat[];
  /** 和集合（重複を数えない）の作品数 */
  unionCount: number;
  /** 全サービスが価格比較可能な場合のみ合計月額 */
  totalPrice: number | null;
}

export interface Over80Result {
  achieved: boolean;
  /** 条件を満たす最安構成（1サービス優先） */
  combo: ServiceCombo | null;
  /** 未達の場合の、価格比較可能サービスでの最大カバー構成 */
  bestPossible: ServiceCombo | null;
}

export interface AlternativeEntry {
  /** DiagnosisResult.works の key（作品オブジェクトの重複保持を避けるためキーで参照） */
  key: string;
  /** 1位サービス以外で見られる方法（有料見放題 → 無料 → レンタル・購入 → 追加チャンネル → その他の順） */
  alternatives: WorkServiceRef[];
}

export interface PersonBreakdown {
  name: string;
  group?: string;
  registeredCount: number;
  paidCount: number;
  freeCount: number;
  /** この人物の作品数が多いサービス上位（作品数 desc → サービス順） */
  topServices: Array<{ stat: ServiceStat; count: number }>;
}

export interface DiagnosisTotals {
  /** 登録出演作品（ユニーク） */
  registered: number;
  /** カバー率の分母: いずれかの有料サブスクで見放題確認できる作品（ユニーク） */
  paid: number;
  /** 今すぐ見られる作品（既存の人物ページ「配信中」と同じ判定） */
  streaming: number;
  /** 無料で見られる作品 */
  free: number;
  /** 無料でのみ見られる作品（有料見放題なし） */
  freeOnly: number;
  /** レンタル・購入でのみ見られる作品 */
  rentalOnly: number;
  /** 現在どこでも配信を確認できない作品 */
  none: number;
}

export interface DiagnosisResult {
  persons: Array<{ name: string; group?: string }>;
  works: DiagnosisWork[];
  totals: DiagnosisTotals;
  stats: ServiceStat[];
  byWorkCount: RankedService[];
  byMonthlyPrice: RankedService[];
  byCostPerWork: RankedService[];
  bestPair: ServiceCombo | null;
  /** 1サービスで全有料見放題作品をカバーできる場合 true */
  singleCoversAll: boolean;
  over80: Over80Result;
  /** 無料で見られる作品の key（DiagnosisResult.works を参照） */
  freeWorkKeys: string[];
  /** 作品数1位サービスで見放題にならない作品と代替手段 */
  unwatchable: AlternativeEntry[];
  personBreakdown: PersonBreakdown[];
  headline: string;
  /** 配信確認日の範囲（既存データに存在する場合のみ） */
  checkedRange: { min: number; max: number } | null;
}
