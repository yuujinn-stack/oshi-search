import { MockProduct, ProductCategory } from '@/types/person';

const COLORS = ['4F46E5', '6366F1', 'F59E0B', 'EC4899', '10B981', '0EA5E9'];

const TITLES: Record<ProductCategory, [string, string]> = {
  '写真集': ['1st写真集', '2nd写真集'],
  '本・雑誌': ['掲載雑誌 特集号', '公式ガイドブック'],
  'Blu-ray・DVD': ['コンサート Blu-ray', '全国ツアー映像 BD'],
  'グッズ': ['アクリルスタンド', 'クリアファイルセット'],
};

function seed(name: string): number {
  return name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
}

export function getMockProducts(personName: string, category: ProductCategory): MockProduct[] {
  const s = seed(personName);
  const c1 = COLORS[s % COLORS.length];
  const c2 = COLORS[(s + 2) % COLORS.length];
  const [title1, title2] = TITLES[category];

  return [
    {
      id: `${personName}-${category}-1`,
      title: `${personName} ${title1}`,
      price: 2800 + (s % 2200),
      reviewCount: 40 + (s % 400),
      reviewAverage: Math.round((4.0 + (s % 10) / 10) * 10) / 10,
      imageColor: c1,
      itemUrl: 'https://www.rakuten.co.jp/',
      category,
    },
    {
      id: `${personName}-${category}-2`,
      title: `${personName} ${title2}`,
      price: 1800 + ((s + 500) % 3200),
      reviewCount: 20 + ((s + 100) % 250),
      reviewAverage: Math.round((4.0 + ((s + 3) % 10) / 10) * 10) / 10,
      imageColor: c2,
      itemUrl: 'https://www.rakuten.co.jp/',
      category,
    },
  ];
}
