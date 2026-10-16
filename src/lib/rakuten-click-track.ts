// 楽天商品リンクのクリック計測（クライアント専用）。公開ページの楽天リンクはすべてここを通す。
//
// 既存の2つの計測経路を再利用し、新しい送信先は作らない:
//   1. /api/track（type:'product'）… Redis の product:click:* / product:meta:*（トップ「人気商品」の集計元）
//   2. GA4 affiliate_click（src/lib/ga-event.ts の sendGaEvent 経由。本番ホスト以外では送信しない）
//      OshiAdBanner と同じイベント名を使い、affiliate_name='rakuten' で区別する。
//
// 二重計測の防止: 1回のクリックで1回だけ呼ぶ（カード内の画像・商品名・ボタンは別々の <a> なので
// どれか1つの onClick しか発火しない）。加えて、同じ商品・同じ表示位置の連続クリック
// （ダブルクリック等）は短時間に1回だけ送る。
// リンク自体（href・target・rel）には一切手を加えないため、アフィリエイトリンクの動作に影響しない。
import { sendGaEvent } from '@/lib/ga-event';

export type RakutenPageType = 'home' | 'person' | 'group' | 'work' | 'photobooks';
export type RakutenLinkElement = 'image' | 'title' | 'cta' | 'card';

export interface RakutenClickInfo {
  productId: string;
  /** 人物名（人物ページの slug と同じ値）。不明なら空文字 */
  personSlug: string;
  title: string;
  /** 表示カテゴリ（写真集・書籍 / CD / Blu-ray・DVD / グッズ / その他 / 中古 等） */
  category: string;
  imageUrl: string;
  affiliateUrl: string;
  pageType: RakutenPageType;
  /** 表示位置（例: person_featured / person_product_list / home_popular_products） */
  placement: string;
  /** 表示位置内での順番（1始まり） */
  position?: number;
  linkElement?: RakutenLinkElement;
  /**
   * /api/track に商品メタデータ（タイトル・人物・画像等）を保存するか。既定 true。
   * 人物が特定できない表示位置（グループ・作品ページ）では false にして、
   * 人物ページ由来のメタデータ（personSlug 等）を空値で上書きしないようにする（クリック数は加算する）。
   */
  saveMeta?: boolean;
}

const DEDUPE_WINDOW_MS = 1000;
const recentClicks = new Map<string, number>();

/** GA4 のパラメータ値は100文字まで */
function clip(s: string, max = 100): string {
  return s.length > max ? s.slice(0, max) : s;
}

export function trackRakutenClick(info: RakutenClickInfo): void {
  if (typeof window === 'undefined') return;

  const dedupeKey = `${info.productId}|${info.placement}|${info.position ?? ''}`;
  const now = Date.now();
  const last = recentClicks.get(dedupeKey);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
  recentClicks.set(dedupeKey, now);

  const saveMeta = info.saveMeta !== false;
  try {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 別タブで開くリンクでも送信が中断されないよう keepalive を付ける
      keepalive: true,
      body: JSON.stringify(
        saveMeta
          ? {
              type: 'product',
              productId: info.productId,
              slug: info.personSlug,
              title: info.title,
              category: info.category,
              imageUrl: info.imageUrl,
              affiliateUrl: info.affiliateUrl,
            }
          : { type: 'product', productId: info.productId, slug: info.personSlug },
      ),
    }).catch(() => {});
  } catch {
    // 計測失敗で画面操作を妨げない
  }

  sendGaEvent('affiliate_click', {
    affiliate_name: 'rakuten',
    page_type: info.pageType,
    placement: info.placement,
    position: info.position,
    link_element: info.linkElement,
    person_name: info.personSlug || undefined,
    product_id: clip(info.productId),
    product_category: info.category || undefined,
    item_name: clip(info.title),
  });
}
