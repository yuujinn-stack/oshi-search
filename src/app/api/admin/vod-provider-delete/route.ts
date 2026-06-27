import { NextRequest, NextResponse } from 'next/server';
import { hideVodProvider } from '@/lib/work-store';

// POST /api/admin/vod-provider-delete
// body: { personName, workId, providerName, source, type }
// VOD配信情報を1件論理削除（hidden: true をセット）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId, providerName, source, type } = body as {
    personName?: string;
    workId?: string;
    providerName?: string;
    source?: string;
    type?: string;
  };

  if (!personName || !workId || !providerName || !source || !type) {
    return NextResponse.json(
      { error: 'personName, workId, providerName, source, type が必要です' },
      { status: 400 },
    );
  }

  const ok = await hideVodProvider(personName, workId, { providerName, source, type });
  if (!ok) {
    return NextResponse.json({ error: '該当するVOD情報が見つかりません' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
