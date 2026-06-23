import { NextRequest, NextResponse } from 'next/server';
import { getWork, upsertManualCsvVodProviders } from '@/lib/work-store';
import type { VodProvider } from '@/types/vod';

// PATCH /api/admin/work-og-source
// body: { personName, workId, sourceUrl }
//
// 指定作品の manual_csv プロバイダーに sourceUrl を保存する。
// OG画像一括取得の URL候補なしを解消するための手動入力用。
//
// - 既存の manual_csv プロバイダーがあれば sourceUrl を更新（upsert）
// - なければ最小構成の manual_csv プロバイダーを新規作成
// - DB構造は変更しない（VodProvider.sourceUrl を使う）

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId, sourceUrl } = body as {
    personName?: string;
    workId?: string;
    sourceUrl?: string;
  };

  if (!personName || !workId || !sourceUrl) {
    return NextResponse.json(
      { error: 'personName, workId, sourceUrl が必要です' },
      { status: 400 },
    );
  }

  const work = await getWork(personName, workId);
  if (!work) {
    return NextResponse.json({ error: '作品が見つかりません' }, { status: 404 });
  }

  // 既存の manual_csv プロバイダーを探す
  const existingCsvProviders = (work.vodProviders ?? []).filter(
    (p) => p.source === 'manual_csv',
  );

  const now = Date.now();

  if (existingCsvProviders.length > 0) {
    // 既存 manual_csv プロバイダー全件に sourceUrl を設定して upsert
    const updated: VodProvider[] = existingCsvProviders.map((p) => ({
      ...p,
      sourceUrl,
      updatedAt: now,
    }));
    await upsertManualCsvVodProviders(personName, workId, updated);
    return NextResponse.json({ ok: true, action: 'updated', count: updated.length });
  }

  // manual_csv プロバイダーがない場合は最小構成で新規作成
  const newProvider: VodProvider = {
    providerId: 0,
    providerName: '動画',
    type: 'unknown',
    countryCode: 'JP',
    source: 'manual_csv',
    sourceUrl,
    createdAt: now,
    updatedAt: now,
  };
  await upsertManualCsvVodProviders(personName, workId, [newProvider]);
  return NextResponse.json({ ok: true, action: 'created' });
}
