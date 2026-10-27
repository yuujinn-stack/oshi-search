// 商品の「紹介候補」としての優先度と、その理由。純粋関数。
//
// 「紹介候補」（どの商品から確認するとよいか）と「イベント特典の確認済み」（公式根拠で確認した状態・rakuten_event_products）は別物。
// ここでは特典の有無を判断しない（優先度は確認作業の順番の目安で、投稿文の内容には使わない）。
// - 使う情報は、既存の判定（related か）・カテゴリ・中古か・楽天の商品コードの有無・紐付けの状態と、
//   楽天APIで確認できた情報（24時間以内のキャッシュ。在庫・商品別のポイント倍率・タイムセール）だけ。推測で補わない。
// - 商品コードが無い（楽天ブックスの商品など）ことは減点しない（APIで確認できないだけで、対象外の根拠ではない）。
import { activePointRate, activeTimeSale, type CheckStatus, type ItemCheckInfo } from './core';
import { classifyProductDetailed } from '@/lib/product-curation';
import type { ProductCategory } from '@/types/person';

export type ApiCheckState =
  | { code: 'ok'; info: ItemCheckInfo }
  | { code: 'not_found'; fetchedAt: number }
  | { code: 'unchecked' }
  | { code: 'no_item_code' };

export const API_STATE_LABEL: Record<ApiCheckState['code'], string> = {
  ok: 'API確認済み',
  not_found: 'APIで該当なし',
  unchecked: 'API未確認',
  no_item_code: '商品コード・商品番号なし（API確認不可）',
};

export interface CandidateInput {
  category: string;
  /** 表示分類（公開ページと同じ classifyProductDetailed）に使う。無ければ保存カテゴリで判断 */
  title?: string;
  itemUrl?: string | null;
  verdict: string | null;
  isUsed: boolean;
  itemCode: string | null;
  linkedStatus: CheckStatus | null;
  api: ApiCheckState;
}

export interface Priority {
  score: number;
  /** 高・中・低 */
  level: 'high' | 'mid' | 'low';
  reasons: string[];
}

const CORE_SECTIONS = new Set(['写真集・書籍', 'CD', 'Blu-ray・DVD']);
const STORED_TO_SECTION: Record<string, string> = { 写真集: '写真集・書籍', '本・雑誌': '写真集・書籍', CD: 'CD', 'Blu-ray・DVD': 'Blu-ray・DVD', グッズ: 'グッズ', 中古: '中古' };

export function candidatePriority(c: CandidateInput, nowMs: number): Priority {
  let score = 50;
  const reasons: string[] = [];
  if (c.verdict === 'related') { score += 10; reasons.push('サイトに掲載中（related）'); } else { score -= 30; reasons.push(`サイトに非掲載（${c.verdict ?? '未判定'}）`); }
  // カテゴリは公開ページと同じ表示分類で見る（写真集として保存された CD は CD として扱う）
  const cls = c.title != null ? classifyProductDetailed(c.title, c.category as ProductCategory, c.itemUrl ?? '') : null;
  const section = cls?.section ?? STORED_TO_SECTION[c.category] ?? c.category;
  if (c.isUsed || c.category === '中古') { score -= 20; reasons.push('中古商品'); } else if (CORE_SECTIONS.has(section)) { score += 5; reasons.push(`推し活の定番カテゴリ（${section}）`); }
  if (cls?.needsReview) { score -= 5; reasons.push('表示カテゴリが要確認（商品名から種類を判断できない）'); }
  if (c.api.code === 'ok' && c.api.info.source === 'books') {
    // 楽天ブックス：価格と購入できるかだけ（ポイント倍率・タイムセールの項目は API に無い）
    if (c.api.info.availability === 0) { score -= 40; reasons.push('楽天ブックスで購入できない（品切れ・販売終了等）'); }
    else reasons.push('楽天ブックスで購入できることを確認（ポイント倍率は API に無い）');
  } else if (c.api.code === 'ok') {
    const info = c.api.info;
    if (info.availability === 0) { score -= 40; reasons.push('APIで在庫なし'); }
    const pr = activePointRate(info, nowMs);
    if (pr) { score += 30; reasons.push(`APIで商品別ポイント${pr.rate}倍を確認（特典の確認は別途必要）`); }
    if (activeTimeSale(info, nowMs)) { score += 20; reasons.push('APIでタイムセールの設定を確認（特典の確認は別途必要）'); }
    if (!pr && !activeTimeSale(info, nowMs) && info.availability !== 0) reasons.push('APIで在庫あり・商品別の倍率やタイムセールは無し');
  } else if (c.api.code === 'not_found') {
    score -= 10; reasons.push('APIで該当なし（販売終了の可能性。対象外とは判断していません）');
  } else if (c.api.code === 'unchecked') {
    reasons.push('楽天APIで未確認（選んで確認できます）');
  } else {
    reasons.push('商品コード・商品番号なし（楽天APIでは確認できないため、商品ページで確認）');
  }
  if (c.linkedStatus) reasons.push(`紐付け済み（${c.linkedStatus === 'confirmed' ? '確認済み' : c.linkedStatus === 'excluded' ? '対象外' : '要確認'}）`);
  const level = score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low';
  return { score, level, reasons };
}

export const PRIORITY_LABEL: Record<Priority['level'], string> = { high: '高', mid: '中', low: '低' };
