// 共有リンク経由で訪れたことを、このタブの間だけ覚えておく（共有ページからの新規作成の計測用。クライアント専用）。
import type { OshiCardShareMethod, OshiCardVariant } from './params';

export interface OshiCardShareAttribution {
  variant: OshiCardVariant;
  method: OshiCardShareMethod;
}

const KEY = 'oshi-card-share-attribution';

export function rememberOshiCardShare(attr: OshiCardShareAttribution): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(attr)); } catch { /* 保存できなくても画面操作は続行 */ }
}

export function readOshiCardShare(): OshiCardShareAttribution | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<OshiCardShareAttribution>;
    if ((v.variant === 'cool' || v.variant === 'cute') && typeof v.method === 'string') return { variant: v.variant, method: v.method as OshiCardShareMethod };
    return null;
  } catch {
    return null;
  }
}

/** GA4 に付ける共有経由の情報（共有経由でなければ via_share: false だけ） */
export function oshiCardShareParams(): Record<string, string | boolean> {
  const s = readOshiCardShare();
  return s ? { via_share: true, share_variant: s.variant, share_method: s.method } : { via_share: false };
}
