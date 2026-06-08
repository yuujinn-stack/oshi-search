import { NextRequest, NextResponse } from 'next/server';
import { getPersonWithConfig } from '@/lib/persons';
import { getAllStoredProducts } from '@/lib/product-store';
import { getAllVerdicts } from '@/lib/judgment-store';

// GET /api/admin/products?person=名前
// Redis に保存済みの商品データと判定結果を返す（Rakuten API は呼ばない）
// 管理画面からのみ呼び出し（認証はmiddlewareで済み）
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('person');
  if (!name) return NextResponse.json({ error: 'person パラメータが必要です' }, { status: 400 });

  const person = getPersonWithConfig(name);
  if (!person) return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });

  // Redis から保存済みデータを取得
  const [storedData, verdicts] = await Promise.all([
    getAllStoredProducts(person.name),
    getAllVerdicts(person.name),
  ]);

  // カテゴリ形式に変換
  const categories = Object.fromEntries(
    Object.entries(storedData).map(([cat, data]) => [
      cat,
      { status: 'ok', products: data.products, fetchedAt: data.fetchedAt },
    ])
  );

  return NextResponse.json({
    person: { name: person.name, group: person.group, genre: person.genre, config: person.config },
    categories,
    verdicts,
  });
}
