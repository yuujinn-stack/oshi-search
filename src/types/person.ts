export type Genre = '坂道' | '芸人' | 'テレビ' | 'アーティスト' | '俳優';
export type CheckStatus = 'unchecked' | 'ok' | 'needs_fix';
export type ProductCategory = '写真集' | '本・雑誌' | 'Blu-ray・DVD' | 'グッズ';

export interface PersonConfig {
  customKeywords?: string[];  // 補助検索語（追加検索、置き換えではない）
  excludeKeywords?: string[]; // 除外キーワード（商品名に含まれる場合スコア -100）
  strictMode?: boolean;       // true: 表示閾値を 20→50 に引き上げ（短い名前向け）
  checkStatus?: CheckStatus;  // 管理者の確認状態
}

export interface Person {
  name: string;
  group: string;
  genre: Genre;
}

export interface PersonWithConfig extends Person {
  config: PersonConfig;
}
