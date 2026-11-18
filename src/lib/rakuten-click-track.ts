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
//
// 中クリック（ホイールクリック＝新しいタブで開く）は click ではなく auxclick だけが発火するため、
// 各リンクの onAuxClick から trackRakutenAuxClick を呼んで補完する（button===1 のときだけ。
// 右クリック＝コンテキストメニューの表示は計測しない）。通常クリック・Ctrl/Cmd+クリックは onClick 側で1回。
import { sendGaEvent } from '@/lib/ga-event';
import { productKeyOfLink } from '@/lib/rakuten-affiliate-link';

export type RakutenPageType = 'home' | 'person' | 'group' | 'work' | 'photobooks' | 'oshi_shopping' | 'live_archive';
export type RakutenLinkElement = 'image' | 'title' | 'cta' | 'card';

export interface RakutenClickInfo {
  productId: string;
  /** 人物名（人物ページの slug と同じ値）。不明なら空文字 */
  personSlug: string;
  /** グループ名（グループページ・ライブ映像コーナー）。GA4 の group_name にだけ使う */
  groupName?: string;
  /** 作品ID（作品ページ）。GA4 の work_id にだけ使う */
  workId?: string;
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
  /**
   * /api/track（Redis のクリック数。トップ「人気商品」の集計元）に送るか。既定 true。
   * 人物の関連商品ではない一般商品（推し活お買い物診断の一般商品）は false にして GA4 だけに送り、
   * 人物の商品ランキングに混ざらないようにする。
   */
  countInRanking?: boolean;
}

const DEDUPE_WINDOW_MS = 1000;
const recentClicks = new Map<string, number>();

/** GA4 のパラメータ値は100文字まで */
function clip(s: string, max = 100): string {
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * リンク先URLから楽天のショップを取り出す（楽天ブックス＝'books'、楽天市場＝店舗コード）。
 * 楽天アフィリエイトURLは遷移先（pc=）から判定する。URLは読むだけで加工しない。分からなければ undefined
 */
export function rakutenShopOf(url: string | undefined | null): string | undefined {
  const key = productKeyOfLink(url);
  if (!key) return undefined;
  return key.source === 'books' ? 'books' : key.shop;
}

/** GA4 affiliate_click のパラメータ（既存項目は名前・値とも従来どおり。追加は group_name・work_id・rakuten_shop） */
export function rakutenClickGaParams(info: RakutenClickInfo): Record<string, string | number | undefined> {
  const shop = rakutenShopOf(info.affiliateUrl);
  return {
    affiliate_name: 'rakuten',
    page_type: info.pageType,
    placement: info.placement,
    position: info.position,
    link_element: info.linkElement,
    person_name: info.personSlug || undefined,
    group_name: info.groupName ? clip(info.groupName) : undefined,
    work_id: info.workId ? clip(info.workId) : undefined,
    product_id: clip(info.productId),
    product_category: info.category || undefined,
    item_name: clip(info.title),
    rakuten_shop: shop ? clip(shop) : undefined,
  };
}

/** 中クリック（auxclick の button===1）だけを計測する。右クリック等は何もしない。計測したら true */
export function trackRakutenAuxClick(event: { button: number }, info: RakutenClickInfo): boolean {
  if (event.button !== 1) return false;
  return trackRakutenClick(info);
}

/**
 * 計測したら true、重複（1秒以内の同じ商品・同じ表示位置）・サーバー側で呼ばれた場合は false。
 * 同じクリックで別の GA4 イベントも送る呼び出し側（ライブ映像）は、true のときだけ送れば重複しない。
 */
export function trackRakutenClick(info: RakutenClickInfo): boolean {
  if (typeof window === 'undefined') return false;

  const dedupeKey = `${info.productId}|${info.placement}|${info.position ?? ''}`;
  const now = Date.now();
  const last = recentClicks.get(dedupeKey);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  recentClicks.set(dedupeKey, now);

  const saveMeta = info.saveMeta !== false;
  if (info.countInRanking !== false) {
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
  }

  sendGaEvent('affiliate_click', rakutenClickGaParams(info));
  return true;
}
