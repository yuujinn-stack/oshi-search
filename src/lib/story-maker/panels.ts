// ストーリーズの自動作成で、実画面の画像の代わりに描くカード（B＝関連商品、E＝グッズ制作サービス）のデータ。
// 'use client' からも import 可（DB・サーバー専用モジュールに依存しない）。
//
// - 内容はすべてサイトに掲載中のデータだけ（B は商品データ、E は /oshikatsu/goods-making の掲載内容）。
// - 画像は data: URL（サーバーで取得したもの）だけを使う。外部URLを直接描くと PNG 保存で欠けるため。
// - 価格・納期・ランキングは載せない。

import { CHECK_OFFICIAL, GOODS_MAKING_SERVICES } from '@/lib/oshikatsu-services/goods-making';
import { OSHIKATSU_SERVICE_LINKS } from '@/lib/oshikatsu-services/links';

export interface ProductPanelItem {
  /** 商品データの商品名（そのまま） */
  title: string;
  /** サイトの見出し（写真集・書籍 / CD / Blu-ray・DVD / グッズ など） */
  section: string;
  /** 商品画像（data: URL）。取得できなかったときは null（代替カードで商品名を表示） */
  imageSrc: string | null;
  /** 商品ページ（管理画面での確認用。画像には描かない） */
  url: string;
}

export interface ServicePanelItem {
  name: string;
  /** 比較ページのアイコン代わりの1文字（公式ロゴは使わない） */
  mark: string;
  /** 比較ページの紹介文（そのまま） */
  catchCopy: string;
  /** 比較表「主な制作アイテム」（そのまま） */
  items: string;
  /** 比較表「最小注文個数」の先頭（括弧書きの前まで） */
  minQty: string;
}

export type StoryPanel =
  | { kind: 'products'; title: string; items: ProductPanelItem[] }
  | { kind: 'services'; title: string; items: ServicePanelItem[] };

/** 画像を作るときの変更検出用（画像の中身まで比べず、長さと末尾で十分） */
export function panelSignature(panel: StoryPanel): string {
  const s = JSON.stringify(panel);
  return `${panel.kind}:${s.length}:${s.slice(-48)}`;
}

/**
 * E：グッズ制作比較ページ（/oshikatsu/goods-making）に掲載中のサービス（掲載順のまま。順位は付けない）。
 * 料金・送料・納期は載せない（確認日のある比較ページ側で見てもらう）。
 */
export function buildServicesPanel(): StoryPanel {
  return {
    kind: 'services',
    title: `比較ページ掲載中の${GOODS_MAKING_SERVICES.length}サービス`,
    items: GOODS_MAKING_SERVICES.map((s) => ({
      name: OSHIKATSU_SERVICE_LINKS[s.id].serviceName,
      mark: s.mark,
      catchCopy: s.catchCopy,
      items: s.compare.items,
      minQty: s.compare.minQty === CHECK_OFFICIAL ? '' : s.compare.minQty.split('（')[0].trim(),
    })),
  };
}
