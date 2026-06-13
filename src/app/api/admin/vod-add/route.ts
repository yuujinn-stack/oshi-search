import { NextRequest, NextResponse } from 'next/server';
import { addManualVodProvider, removeManualVodProvider } from '@/lib/work-store';
import type { VodProvider } from '@/types/vod';

// POST /api/admin/vod-add
// body: { personName, workId, provider: VodProvider }
// 管理画面から手動で配信サービスを追加
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId, provider } = body as {
    personName?: string;
    workId?: string;
    provider?: Partial<VodProvider>;
  };

  if (!personName || !workId || !provider?.providerName) {
    return NextResponse.json(
      { error: 'personName, workId, provider.providerName が必要です' },
      { status: 400 },
    );
  }

  const fullProvider: VodProvider = {
    providerId: provider.providerId ?? Date.now(), // 手動追加は一意IDをタイムスタンプで生成
    providerName: provider.providerName,
    logoPath: provider.logoPath,
    displayPriority: provider.displayPriority,
    type: provider.type ?? 'flatrate',
    countryCode: provider.countryCode ?? 'JP',
    source: 'manual',
    link: provider.link,
  };

  await addManualVodProvider(personName, workId, fullProvider);
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/vod-add
// body: { personName, workId, providerId }
// 手動追加した配信サービスを削除
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId, providerId } = body as {
    personName?: string;
    workId?: string;
    providerId?: number;
  };

  if (!personName || !workId || providerId === undefined) {
    return NextResponse.json(
      { error: 'personName, workId, providerId が必要です' },
      { status: 400 },
    );
  }

  await removeManualVodProvider(personName, workId, providerId);
  return NextResponse.json({ ok: true });
}
