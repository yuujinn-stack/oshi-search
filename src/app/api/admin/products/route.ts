import { NextRequest, NextResponse } from 'next/server';
import { getPersonWithConfig } from '@/lib/persons';
import { getProductsByCategory } from '@/lib/rakuten';
import { getAllVerdicts } from '@/lib/judgment-store';
import type { ProductCategory } from '@/types/rakuten';

const CATEGORIES: ProductCategory[] = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ'];

// GET /api/admin/products?person=名前
// 管理画面からのみ呼び出し（認証はmiddlewareで済み）
// 常に最新データを取得（ISRキャッシュを使わない）
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('person');
  if (!name) return NextResponse.json({ error: 'person パラメータが必要です' }, { status: 400 });

  const person = getPersonWithConfig(name);
  if (!person) return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });

  // 楽天API + AI判定結果を並列取得（管理画面なので常に最新: no-store）
  const [verdictsResult, ...productSettled] = await Promise.allSettled([
    getAllVerdicts(person.name),
    ...CATEGORIES.map((cat) =>
      getProductsByCategory(person.name, person.group, cat, person.config, 'no-store')
    ),
  ]);

  const verdicts = verdictsResult.status === 'fulfilled' ? verdictsResult.value : {};

  const categories = Object.fromEntries(
    CATEGORIES.map((cat, i) => {
      const settled = productSettled[i];
      if (settled?.status !== 'fulfilled') return [cat, { status: 'error', products: [] }];
      const result = settled.value;
      if (result.status !== 'ok') return [cat, { status: result.status, products: [] }];
      return [cat, { status: 'ok', products: result.products }];
    })
  );

  return NextResponse.json({
    person: { name: person.name, group: person.group, genre: person.genre, config: person.config },
    categories,
    verdicts,
  });
}
