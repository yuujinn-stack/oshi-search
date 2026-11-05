// 推し活サービス（/oshikatsu）のジャンル一覧。ホームの「推し活サービス」コーナーと総合ページの両方がここを参照する。
//
// - 比較ページがあるジャンルだけ status='available' と href を持つ。準備中のジャンルは href=null で、リンクにしない
//   （存在しないページへのリンクを作らない）。
// - 比較ページを追加したら、そのジャンルの status を 'available'、href をページのパスにするだけで
//   ホーム・総合ページの両方でリンクが有効になる（sitemap.ts への追加も忘れずに）。
// - 各サービスの外部リンク（公式サイト／提携後の広告リンク）は links.ts で管理する。ここには書かない。

import { GOODS_MAKING_PATH } from './goods-making';

export const OSHIKATSU_PATH = '/oshikatsu';

export type OshikatsuCategoryId = 'goods_making' | 'goods_buyback' | 'fashion_rental';

export type OshikatsuCategoryIcon = 'make' | 'box' | 'hanger';

export interface OshikatsuCategory {
  id: OshikatsuCategoryId;
  name: string;
  /** ホームのカードに出す短い説明 */
  summary: string;
  /** 総合ページに出す「こんなときに」の説明 */
  purposes: string[];
  icon: OshikatsuCategoryIcon;
  status: 'available' | 'coming_soon';
  /** 比較ページのパス。準備中は null（リンクにしない） */
  href: string | null;
  /** 比較ページで紹介しているサービス名（利用可能なジャンルのみ。一目で中身が分かるように表示） */
  serviceNames: string[];
}

export const OSHIKATSU_CATEGORIES: OshikatsuCategory[] = [
  {
    id: 'goods_making',
    name: 'グッズ制作',
    summary: '推し色やオリジナルデザインで、自分だけのグッズを作る',
    purposes: [
      '写真などの画像から、アクリルスタンドやキーホルダーを1個から作りたい',
      '推し色の組み合わせで、手持ちのグッズを飾るアイテムを選びたい',
    ],
    icon: 'make',
    status: 'available',
    href: GOODS_MAKING_PATH,
    serviceNames: ['しまうまプラス', 'Cherish Palette'],
  },
  {
    id: 'goods_buyback',
    name: 'グッズ買取',
    summary: '大切にしてきたグッズの整理・買取サービスを比較',
    purposes: [
      '増えてきたアイドル・アーティストグッズを整理したい',
      '使わなくなったグッズを、次のファンに引き継ぎたい',
    ],
    icon: 'box',
    status: 'coming_soon',
    href: null,
    serviceNames: [],
  },
  {
    id: 'fashion_rental',
    name: 'ファッションレンタル',
    summary: 'ライブ参戦服やイベント用の洋服を探す',
    purposes: [
      'ライブやイベントに着ていく服を、買わずに用意したい',
      '推し色を取り入れたコーディネートを探したい',
    ],
    icon: 'hanger',
    status: 'coming_soon',
    href: null,
    serviceNames: [],
  },
];

/** リンクを有効にしてよいジャンルか（利用可能かつパスあり） */
export function isCategoryLinkable(c: OshikatsuCategory): c is OshikatsuCategory & { href: string } {
  return c.status === 'available' && typeof c.href === 'string' && c.href.length > 0;
}
