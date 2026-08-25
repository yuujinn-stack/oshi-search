import { NextRequest, NextResponse } from 'next/server';
import { upsertPhotobookSetting, resetPhotobookSetting } from '@/db/write';

// POST /api/admin/photobooks/setting
// 写真集の表示設定・例外設定を更新する（商品データ自体は一切変更しない）。
// body: { personName, productId, sourceCategory?, status?, published?, homeState?,
//         homePinnedPosition?, sortOrder?, dedupGroupOverride?, forceRepresentative?, note? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      personName: string;
      productId: string;
      sourceCategory?: string;
      status?: 'auto' | 'manual_include' | 'manual_exclude';
      published?: boolean;
      homeState?: 'auto' | 'pinned' | 'hidden';
      homePinnedPosition?: number | null;
      sortOrder?: number | null;
      dedupGroupOverride?: string | null;
      forceRepresentative?: boolean;
      note?: string | null;
    };
    if (!body.personName || !body.productId) {
      return NextResponse.json({ error: 'personName, productId は必須です' }, { status: 400 });
    }
    await upsertPhotobookSetting({ ...body, updatedBy: 'admin' });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE /api/admin/photobooks/setting — 設定を削除し自動判定(auto)に戻す
export async function DELETE(req: NextRequest) {
  try {
    const { personName, productId } = await req.json() as { personName: string; productId: string };
    if (!personName || !productId) {
      return NextResponse.json({ error: 'personName, productId は必須です' }, { status: 400 });
    }
    await resetPhotobookSetting(personName, productId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
