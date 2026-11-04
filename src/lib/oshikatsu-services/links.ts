// 推し活サービス比較ページ（/oshikatsu/*）の外部リンク設定。サービスごとのリンクはここだけで管理する。
//
// - 提携前は公式サイトへの通常リンク（officialUrl）だけを使う。affiliateUrl は null・isAffiliateEnabled は false。
// - ASP（A8.net 等）の提携が承認されたら、管理画面で取得した正規の広告リンクを affiliateUrl に貼り、
//   isAffiliateEnabled を true にする。ダミーや推測の広告URLは絶対に入れない。
// - 広告リンクを有効にしたサービスがあるページでは、PR表記（PrNotice）と各リンクの「PR」表示が自動で出る
//   （resolveServiceLink / hasAffiliateLink を参照）。rel には sponsored が付く。
// - ASPの報酬額・プログラムIDは一般ユーザー向けページに表示しない（運営メモは docs/development-log.md の Task 171 に記録）。
//
// 将来「グッズ買取」「ファッションレンタル」を追加するときは、category に値を足してここにサービスを追加する。

export type OshikatsuServiceCategory = 'goods_making';
// 予定: 'goods_buyback'（アイドル・アーティストグッズ買取）, 'fashion_rental'（ファッションレンタル）

export type OshikatsuServiceId = 'shimauma_plus' | 'cherish_palette';

export interface OshikatsuServiceLink {
  serviceId: OshikatsuServiceId;
  serviceName: string;
  category: OshikatsuServiceCategory;
  /** 公式サイト（通常リンク）。提携前・提携停止時はこちらを使う */
  officialUrl: string;
  /** ASP管理画面で取得した正規の広告リンク。未提携の間は null */
  affiliateUrl: string | null;
  /** true かつ affiliateUrl がある場合だけ広告リンクを使う */
  isAffiliateEnabled: boolean;
  /**
   * ASPから利用許可を得た広告素材（バナー画像）。未取得の間は null（公式サイトの画像は使わない）。
   * 広告リンクが有効なときだけ、サービスカードにリンク付きで表示する。
   */
  creative: OshikatsuServiceCreative | null;
}

export interface OshikatsuServiceCreative {
  imageUrl: string;
  width: number;
  height: number;
  alt: string;
}

export const OSHIKATSU_SERVICE_LINKS: Record<OshikatsuServiceId, OshikatsuServiceLink> = {
  shimauma_plus: {
    serviceId: 'shimauma_plus',
    serviceName: 'しまうまプラス',
    category: 'goods_making',
    officialUrl: 'https://www.shimauma-plus.n-pri.jp/',
    affiliateUrl: null,
    isAffiliateEnabled: false,
    creative: null,
  },
  cherish_palette: {
    serviceId: 'cherish_palette',
    serviceName: 'Cherish Palette',
    category: 'goods_making',
    officialUrl: 'https://cherish-palette.jp/',
    affiliateUrl: null,
    isAffiliateEnabled: false,
    creative: null,
  },
};

export interface ResolvedServiceLink {
  href: string;
  /** true のときは広告リンク（PR表示・rel="sponsored" が必要） */
  isAffiliate: boolean;
}

/** 実際に使うリンク先。広告リンクは「有効フラグ＋URLあり」のときだけ使い、それ以外は公式サイトへの通常リンク */
export function resolveServiceLink(link: OshikatsuServiceLink): ResolvedServiceLink {
  const affiliateUrl = link.affiliateUrl?.trim();
  if (link.isAffiliateEnabled && affiliateUrl) return { href: affiliateUrl, isAffiliate: true };
  return { href: link.officialUrl, isAffiliate: false };
}

/** ページ内に広告リンクが1つでもあるか（PR表記の表示判定に使う） */
export function hasAffiliateLink(ids: readonly OshikatsuServiceId[]): boolean {
  return ids.some((id) => resolveServiceLink(OSHIKATSU_SERVICE_LINKS[id]).isAffiliate);
}
