import { NextRequest, NextResponse } from 'next/server';
import { getImportHistoryList, getImportHistoryDetail } from '@/lib/import-history';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');

    if (id) {
      const detail = await getImportHistoryDetail(id);
      if (!detail) return NextResponse.json({ error: '履歴が見つかりません' }, { status: 404 });
      return NextResponse.json(detail);
    }

    const list = await getImportHistoryList(100);
    return NextResponse.json({ list });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
