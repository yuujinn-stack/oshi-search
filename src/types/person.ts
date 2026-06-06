export type Genre = '坂道' | '芸人' | 'テレビ' | 'アーティスト' | '俳優';

export type ProductCategory = '写真集' | '本・雑誌' | 'Blu-ray・DVD' | 'グッズ';

export interface Person {
  name: string;
  group: string;
  genre: Genre;
}

export interface MockProduct {
  id: string;
  title: string;
  price: number;
  reviewCount: number;
  reviewAverage: number;
  imageColor: string;
  itemUrl: string;
  category: ProductCategory;
}
