// 推し活サービスのアフィリエイト：公開ページに広告タグを出すかどうかの判定（純粋関数・DB非依存）。
//
// 広告を出すのは次をすべて満たすときだけ。それ以外は呼び出し側が従来の公式サイトへの通常リンクを表示する。
//   1. 提携状態が「承認済み」
//   2. 広告掲載が「有効」
//   3. 有効な広告素材があり、その広告タグが安全確認（checkAdTag）に通る
// 素材が複数あるときは表示順（sortOrder）の小さいもの → 先に登録したもの の順で1件だけ使う。

import { checkAdTag } from './ad-tag';
import type { CreativeKind, PartnershipStatus } from './constants';

export interface AdDecisionService {
  partnershipStatus: PartnershipStatus | string;
  isAdEnabled: boolean;
  aspId: string;
}

export interface AdDecisionCreative {
  id: number;
  kind: CreativeKind | string;
  adHtml: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: number;
}

export interface PublicAdCreative {
  creativeId: number;
  kind: string;
  /** ASPが発行したタグそのもの（改変しない） */
  adHtml: string;
}

/** 公開ページで使う広告素材。広告を出さない場合は null（呼び出し側は通常リンクを表示する） */
export function pickPublicAdCreative(service: AdDecisionService, creatives: readonly AdDecisionCreative[]): PublicAdCreative | null {
  if (service.partnershipStatus !== 'approved' || !service.isAdEnabled) return null;
  const candidates = creatives
    .filter((c) => c.isActive)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || a.id - b.id);
  for (const c of candidates) {
    if (checkAdTag(service.aspId, c.adHtml).ok) return { creativeId: c.id, kind: c.kind, adHtml: c.adHtml };
  }
  return null;
}

export type AdStatus = 'live' | 'disabled' | 'not_approved' | 'no_creative';

/** 管理画面の「広告状態」表示用。live のときだけ公開ページに広告タグが出る */
export function getAdStatus(service: AdDecisionService, creatives: readonly AdDecisionCreative[]): AdStatus {
  if (!service.isAdEnabled) return 'disabled';
  if (service.partnershipStatus !== 'approved') return 'not_approved';
  return pickPublicAdCreative(service, creatives) ? 'live' : 'no_creative';
}

export const AD_STATUS_LABELS: Record<AdStatus, string> = {
  live: '掲載中',
  disabled: '無効',
  not_approved: '有効（未承認のため非表示）',
  no_creative: '有効（表示できる素材なし）',
};
