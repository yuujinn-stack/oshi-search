import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getAllVerdicts, bulkSaveVerdict } from '@/lib/judgment-store';

// POST /api/admin/product-delete
// body: { personName, productIds: string[] }           → 指定商品を削除
//       { personName, deleteAllHidden: true }          → 非表示(unrelated)を全削除
// 管理画面からのみ呼び出し（認証はmiddlewareで済み）
// 削除 = verdict:'deleted' source:'manual' で保存 → バッチ再実行でも復活しない

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, productIds, deleteAllHidden } = body as {
    personName?: string;
    productIds?: string[];
    deleteAllHidden?: boolean;
  };

  if (!personName) {
    return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });
  }

  let targetIds: string[] = [];

  if (deleteAllHidden) {
    const verdicts = await getAllVerdicts(personName);
    targetIds = Object.entries(verdicts)
      .filter(([, v]) => v.verdict === 'unrelated')
      .map(([id]) => id);
  } else if (Array.isArray(productIds) && productIds.length > 0) {
    targetIds = productIds;
  } else {
    return NextResponse.json({ error: 'productIds または deleteAllHidden が必要です' }, { status: 400 });
  }

  if (targetIds.length === 0) {
    return NextResponse.json({ deletedCount: 0 });
  }

  await bulkSaveVerdict(personName, targetIds, 'deleted');
  revalidatePath(`/person/${encodeURIComponent(personName)}`);

  console.log('[product-delete]', { personName, deletedCount: targetIds.length, deleteAllHidden: !!deleteAllHidden });

  return NextResponse.json({ deletedCount: targetIds.length });
}
