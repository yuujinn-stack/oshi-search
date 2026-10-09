// 公開画面における「配信中として確認済み」「今すぐ見られる」の共通判定。
//
// これまで人物ページ・StreamingNowSection・グループページ・Instagram投稿（site-ui）に
// 同一内容のローカル関数として重複していた処理を1箇所にまとめたもの。
// 判定条件そのものは vod-dedup.ts の isConfirmedVodAvailability（hidden / unknown /
// AI低確度 / 終了済み・inactive の除外）と deduplicateProviders（同一サービスの集約）を
// そのまま組み合わせているだけで、新しい判定は一切追加していない。
//
// 'use client' コンポーネントからも安全に import できるよう、DB には依存しない。

import type { VodProvider, VodProviderType } from '@/types/vod';
import type { WorkRecord } from '@/types/work';
import { deduplicateProviders, isConfirmedVodAvailability } from '@/lib/vod-dedup';

/** 「今すぐ見られる」とみなす配信種別（見放題・無料・広告付き無料） */
export const STREAMING_TYPES: readonly VodProviderType[] = ['flatrate', 'free', 'ads'];

/**
 * 公開してよい配信情報のみを返す（確認済み判定 → 同一サービス集約の順）。
 * 配信種別（flatrate / rent / buy 等）による絞り込みは行わない。
 */
export function getConfirmedProviders(
  providers: VodProvider[] | undefined,
  terminatedSlugs: Set<string>,
): VodProvider[] {
  return deduplicateProviders(
    (providers ?? []).filter((p) => isConfirmedVodAvailability(p, terminatedSlugs)),
  );
}

/** 作品の「今すぐ見られる」配信情報（見放題・無料・広告付き無料のみ） */
export function getStreamingProviders(work: WorkRecord, terminatedSlugs: Set<string>): VodProvider[] {
  return getConfirmedProviders(work.vodProviders, terminatedSlugs)
    .filter((p) => STREAMING_TYPES.includes(p.type));
}
