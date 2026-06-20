import { NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllStoredProducts } from '@/lib/product-store';
import { getAllVerdicts } from '@/lib/judgment-store';
import type { RakutenItem } from '@/types/rakuten';
import type { JudgmentRecord } from '@/lib/judgment-store';

export interface UncertainItem {
  personName: string;
  product: RakutenItem;
  verdict: JudgmentRecord;
}

// GET /api/admin/uncertain
// AI が uncertain と判定した商品を全人物分まとめて返す
export async function GET() {
  const persons = await getAllPersonsMerged();

  const items: UncertainItem[] = [];

  await Promise.all(
    persons.map(async (person) => {
      const [storedData, verdicts] = await Promise.all([
        getAllStoredProducts(person.name),
        getAllVerdicts(person.name),
      ]);

      for (const [productId, verdict] of Object.entries(verdicts)) {
        if (verdict.verdict !== 'uncertain') continue;

        // 対応する商品データを storedData から探す
        let found: RakutenItem | undefined;
        for (const catData of Object.values(storedData)) {
          const match = catData?.products.find((p) => p.id === productId);
          if (match) { found = match; break; }
        }
        if (!found) continue;

        items.push({ personName: person.name, product: found, verdict });
      }
    })
  );

  // AI スコアの低い順（確信度が低い = 最も要確認）に並べる
  items.sort((a, b) => a.verdict.score - b.verdict.score);

  return NextResponse.json({ items, total: items.length });
}
