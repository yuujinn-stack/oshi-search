export type Genre = '坂道' | '芸人' | 'テレビ' | 'アーティスト' | '俳優';
export type CheckStatus = 'unchecked' | 'ok' | 'needs_fix';
export type ProductCategory = '写真集' | '本・雑誌' | 'Blu-ray・DVD' | 'グッズ' | 'CD' | '中古';
export type ActivityStatus = 'active' | 'graduated' | 'withdrawn' | 'hiatus' | 'retired' | 'unknown';
export type CareerStatus = 'active' | 'inactive' | 'retired' | 'deceased' | 'unknown';

export interface PersonConfig {
  customKeywords?: string[];  // 補助検索語 / AI判定の関連キーワードとして渡す
  excludeKeywords?: string[]; // 除外キーワード（含む商品は AI スキップして即 unrelated）
  strictMode?: boolean;       // 互換性のため残存（現在は未使用）
  checkStatus?: CheckStatus;  // 管理者の確認状態
  // AI 判定に渡す人物詳細情報（省略可）
  realName?: string;          // 本名
  reading?: string;           // 読み仮名
  aliases?: string[];         // 旧芸名・愛称・コンビ名など
  // TMDb 人物検索設定
  tmdbPersonId?: number;         // 正しい TMDb 人物ID（設定時はそれを直接使用・同名別人対策）
  tmdbSearchKeywords?: string[]; // TMDb 検索用追加キーワード（ローマ字表記など）
  expectedDepartment?: string;   // 期待する known_for_department（Acting / Music 等）
}

export interface Person {
  name: string;
  group: string;
  genre: Genre;
}

export interface PersonWithConfig extends Person {
  config: PersonConfig;
}
