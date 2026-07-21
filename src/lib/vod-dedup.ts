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

// 正規化済みスラグ → 統一スラグへの完全一致エイリアスマップ
// 過度な部分一致を防ぐため完全一致のみ。不明なサービスはマップに追加しない。
const CANONICAL_SLUG_MAP: Record<string, string> = {
  // Amazon Prime Video 各種表記 → primevideo
  'amazonprimevideo':         'primevideo',
  'amazonプライムビデオ':      'primevideo',
  'amazonprimevideowithads':  'primevideo',
  'primevideowithads':        'primevideo',
  // U-NEXT カナ表記（ー = U+30FC, 除去対象外のためエイリアスで対応）
  'ユーネクスト':              'unext',
  // Disney+ カナ表記
  'ディズニープラス':           'disneyplus',
  // ABEMA（AbemaTV → abema）
  'abematv':                  'abema',
};

/**
 * プロバイダー名を照合用に正規化する（重複除去・終了済みチェックのキーとして使用）
 *
 * 例:
 *   "U-NEXT CSV"              → "unext"
 *   "U-NEXT JP"               → "unext"   ← 末尾 "jp" を除去
 *   "U‐NEXT" (U+2010)         → "unext"   ← Unicode ハイフンを除去
 *   "ユーネクスト"               → "unext"   ← カナ → エイリアス
 *   "Amazon Prime Video"      → "primevideo"
 *   "Amazonプライム・ビデオ"    → "primevideo"
 *   "Amazon Prime Video with Ads" → "primevideo"
 *   "AbemaTV"                 → "abema"
 *   "ディズニープラス"           → "disneyplus"
 *   "Disney+"                 → "disneyplus"
 *   "Apple TV+"               → "appletvplus"
 */
export function normalizeProviderName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\s*csv\s*$/i, '')                                           // 末尾の " CSV" を除去
    .replace(/^csv\s+/i, '')                                              // 先頭の "CSV " を除去
    .replace(/\s*[|｜]\s*.*$/g, '')                                       // "|" 以降を削除
    .replace(/[+＋]/g, 'plus')                                            // "+" → "plus"
    // ASCII ハイフン(U+002D)に加え Unicode ハイフン類も除去
    // U+2010 HYPHEN / U+2011 NON-BREAKING HYPHEN / U+2012 FIGURE DASH
    // U+2013 EN DASH / U+2014 EM DASH / U+2015 HORIZONTAL BAR / U+FF0D FULLWIDTH
    .replace(/[-‐‑‒–—―－_\s・　]/g, '')
    .replace(/[（(][^)）]*[)）]/g, '')                                     // 括弧とその中身を除去
    .trim();

  // 末尾の地域表記 "jp" を除去（"Hulu JP" → "hulu"、"U-NEXT JP" → "unext"）
  // 除去後が 2 文字未満になる場合はフォールバックとして除去前を返す
  const stripped = base.replace(/jp$/, '');
  const noJp = stripped.length >= 2 ? stripped : base;

  // 完全一致エイリアスで統一スラグへ変換（過度な部分一致禁止）
  return CANONICAL_SLUG_MAP[noJp] ?? noJp;
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
 * - terminatedSlugs に含まれるサービス（管理画面で isActive=false に設定済み）
 */
export function isConfirmedVodAvailability(p: VodProvider, terminatedSlugs?: Set<string>): boolean {
  if (p.hidden) return false;
  const normalizedName = (p.providerName ?? '').trim().toLowerCase();
  if (!normalizedName || normalizedName === 'unknown') return false;
  if (p.type === 'unknown') return false;
  const isAiSource = p.source === 'openai_supplement' || p.source === 'openai_web_search';
  if (isAiSource && p.confidence === 'low') return false;
  if (terminatedSlugs?.size && terminatedSlugs.has(normalizeProviderName(p.providerName ?? ''))) return false;
  return true;
}

/**
 * 公開画面用フィルタ + 重複除去をまとめて行う
 *
 * isConfirmedVodAvailability（hidden / unknown / type / AI confidence / 終了済み）で
 * 除外したのち deduplicateProviders で同名サービスを1件に集約する。
 */
export function filterPublicVodProviders(
  providers: VodProvider[],
  terminatedSlugs: Set<string> = new Set(),
): VodProvider[] {
  return deduplicateProviders(
    providers.filter((p) => isConfirmedVodAvailability(p, terminatedSlugs)),
  );
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
