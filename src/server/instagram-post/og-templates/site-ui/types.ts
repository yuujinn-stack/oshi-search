import type { ProductKind, SiteUiImage } from './shared';

/** F〜Iのページに渡すデータ（すべて推しサーチの人物ページと同じ集計結果から作る） */
export interface SiteUiTemplateWork {
  image: SiteUiImage;
  title: string;
  releaseYear: number | null;
  /** 配信サービスの表示名（最大2件） */
  services: string[];
}

export interface SiteUiTemplateProductSection {
  label: ProductKind;
  count: number;
  /** 表示順の先頭の商品名（表示用に整形済み、最大3件） */
  titles: string[];
}

export interface SiteUiTemplateData {
  personName: string;
  group: string | null;
  workCount: number;
  streamingWorkCount: number;
  serviceCount: number;
  /** 配信中の作品数が多い順 */
  services: { name: string; count: number }[];
  productCount: number;
  productSections: SiteUiTemplateProductSection[];
  /** 表示用の作品（配信中の作品を優先、最大3件） */
  works: SiteUiTemplateWork[];
  /** G案1枚目の検索履歴に使う作品名（無ければnull） */
  sampleWorkTitle: string | null;
  /** 人物ページのパンくずに出るジャンル（H案3枚目の人物ページ画面で使用） */
  genre: string;
}
