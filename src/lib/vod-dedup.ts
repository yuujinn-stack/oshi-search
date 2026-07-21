import type { VodProvider } from '@/types/vod';

// ソース優先順位（数値が小さいほど高優先度）
// 同じサービス名が複数ソースにある場合、この順序で1件を残す
export const VOD_SOURCE_PRIORITY: Record<string, number> = {
  tmdb_watch_provider: 1,
  openai_web_search:   2,
  openai_supplement:   3,
  manual:              4,
  manual_csv:          5,
};

export const VOD_SOURCE_LABEL: Record<string, string> = {
  tmdb_watch_provider: 'TMDb',
  openai_web_search:   'AI Web検索',
  openai_supplement:   'AI補完',
  manual:              '手動',
  manual_csv:          'CSV',
};

/**
 * プロバイダー名を照合用に正規化する
 *
 * 例:
 *   "U-NEXT CSV" → "unext"
 *   "U-NEXT"     → "unext"
 *   "u-next"     → "unext"
 *   "Disney+"    → "disneyplus"
 *   "Apple TV+"  → "appletvplus"
 */
export function normalizeProviderName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*csv\s*$/i, '')          // 末尾の " CSV" を除去
    .replace(/^csv\s+/i, '')             // 先頭の "CSV " を除去
    .replace(/\s*[|｜]\s*.*$/g, '')      // "|" 以降を削除（"Hulu | フールー" → "hulu"）
    .replace(/[+＋]/g, 'plus')           // "+" → "plus"（Disney+ など）
    .replace(/[-_\s・　]/g, '')           // ハイフン・アンダースコア・スペース除去
    .replace(/[（(][^)）]*[)）]/g, '')    // 括弧とその中身を除去
    .trim();
}

/**
 * 配信プロバイダーリストから重複を除去する
 *
 * 同じ providerName（正規化後）が複数ある場合は優先度が高いソースを残す。
 * 同優先度の場合は updatedAt が新しい方を残す。
 * 入力配列の相対順序を維持する。
 *
 * 優先: TMDb > AI Web検索 > AI補完 > 手動 > CSV
 */
export function deduplicateProviders(providers: VodProvider[]): VodProvider[] {
  // Key: 正規化済みサービス名
  // Value: その名前について「勝者」となったプロバイダーオブジェクト
  const winner = new Map<string, VodProvider>();

  for (const p of providers) {
    const key = normalizeProviderName(p.providerName);
    const existing = winner.get(key);
    if (!existing) {
      winner.set(key, p);
      continue;
    }
    const existingPriority = VOD_SOURCE_PRIORITY[existing.source] ?? 99;
    const newPriority      = VOD_SOURCE_PRIORITY[p.source] ?? 99;
    if (
      newPriority < existingPriority ||
      (newPriority === existingPriority && (p.updatedAt ?? 0) > (existing.updatedAt ?? 0))
    ) {
      winner.set(key, p);
    }
  }

  // オブジェクト参照で勝者セットを作成し、入力順を維持しながらフィルタリング
  const winnerSet = new Set(winner.values());
  return providers.filter((p) => winnerSet.has(p));
}

/**
 * 公開画面に表示してよい配信情報かどうかを判定する
 *
 * 以下はすべて「確認済み配信なし」として除外する:
 * - hidden フラグあり
 * - providerName が空または 'unknown'（配信サービス名が特定できていない）
 * - type が 'unknown'（配信種別が特定できていない）
 * - AI ソースかつ confidence=low（信頼度が低い）
 */
export function isConfirmedVodAvailability(p: VodProvider): boolean {
  if (p.hidden) return false;
  const normalizedName = (p.providerName ?? '').trim().toLowerCase();
  if (!normalizedName || normalizedName === 'unknown') return false;
  if (p.type === 'unknown') return false;
  const isAiSource = p.source === 'openai_supplement' || p.source === 'openai_web_search';
  if (isAiSource && p.confidence === 'low') return false;
  return true;
}

/**
 * 重複があるかどうかだけを確認する（変更なし）
 */
export function hasDuplicateProviders(providers: VodProvider[]): boolean {
  const seen = new Set<string>();
  for (const p of providers) {
    const key = normalizeProviderName(p.providerName);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
