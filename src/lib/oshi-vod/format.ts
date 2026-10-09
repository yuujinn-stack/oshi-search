// /oshi-vod の表示用フォーマット・表示モデル変換（純粋関数・DB非依存）。
import type { VodPageWork } from '@/lib/vod-page';
import type { VodProviderType } from '@/types/vod';
import { getDisplayWorkType, DISPLAY_WORK_TYPE_LABEL, DISPLAY_WORK_TYPE_ICON } from '@/lib/work-display-type';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';
import { getWorkPublicUrl } from '@/lib/work-url';
import type { VodPlanInfo } from '@/lib/vod-plan-info';
import { coveragePercentFloor } from './core';
import type { DiagnosisWork } from './types';

export function formatYen(n: number): string {
  return `${n.toLocaleString('ja-JP')}円`;
}

/** 'YYYY-MM-DD' → 'YYYY/MM/DD'（日付の推測・補完はしない） */
export function formatIsoDate(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return iso.replace(/-/g, '/');
}

/** 'YYYY-MM-DD' → 'YYYY年M月D日'（日付の推測・補完はしない） */
export function formatIsoDateJa(iso: string | null): string | null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

/** epoch ms → 'YYYY/MM/DD'（日本時間） */
export function formatEpochDate(ms: number | undefined | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 「月額2,189円（税込）」。価格比較不可の場合は null */
export function formatMonthlyPrice(plan: VodPlanInfo | null, comparable: boolean): string | null {
  if (!plan || !comparable || plan.monthlyPrice == null) return null;
  return `${plan.priceLabel ?? '月額'}${formatYen(plan.monthlyPrice)}（${plan.taxIncluded ? '税込' : '税抜'}）`;
}

/**
 * 月額・コスパ比較の対象外である理由の表示文言（理由ごとに出し分ける）。
 * long … ランキング行・組み合わせ内訳用 / short … 結論カード・詳細比較の月額欄用
 */
export function priceExclusionLabel(plan: VodPlanInfo | null, length: 'long' | 'short' = 'long'): string {
  if (plan?.kind === 'free') return length === 'long' ? '無料サービスのため月額比較なし' : '無料サービス';
  if (plan?.notComparableReason === 'tax_unconfirmed') {
    return length === 'long' ? '税込料金を公式で確認できないため比較対象外' : '税込料金未確認';
  }
  return length === 'long' ? '料金未確認のため比較対象外' : '料金未確認';
}

/** 「14 / 21作品」 */
export function formatWorkFraction(count: number, total: number): string {
  return `${count} / ${total}作品`;
}

/** 「66.6%」（切り捨て） */
export function formatCoverage(count: number, total: number): string {
  return `${coveragePercentFloor(count, total)}%`;
}

/** VodWorkCard（/vod/[provider] の既存作品カード）用の表示モデルへ変換 */
export function toVodPageWork(w: DiagnosisWork, availabilityType: VodProviderType): VodPageWork {
  const displayType = getDisplayWorkType(w.work);
  return {
    workId: w.work.id,
    title: w.work.title,
    releaseYear: w.work.releaseYear,
    displayTypeLabel: DISPLAY_WORK_TYPE_LABEL[displayType],
    displayTypeIcon: DISPLAY_WORK_TYPE_ICON[displayType],
    posterUrl: getRenderableWorkImageUrl(getWorkDisplayImage(w.work)),
    availabilityType,
    checkedAt: w.checkedAt,
    detailUrl: workDetailUrl(w),
    mainCastNames: w.personNames.slice(0, 3),
    totalCastCount: w.personNames.length,
  };
}

export function workDetailUrl(w: DiagnosisWork): string {
  return getWorkPublicUrl({ workId: w.work.id, canonicalWorkId: w.work.canonicalWorkId }) ?? `/work/${encodeURIComponent(w.work.id)}`;
}

/** 選択人物の短い表記（結論・画像・シェア文用）。4人以上は「A・B・Cほか○人」 */
export function formatPersonList(names: string[], max = 3): string {
  if (names.length <= max) return names.join('・');
  return `${names.slice(0, max).join('・')}ほか${names.length - max}人`;
}
