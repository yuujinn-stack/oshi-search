import { NextRequest, NextResponse } from 'next/server';
import {
  deleteOshikatsuAffiliateCreative,
  getOshikatsuAffiliateCreative,
  getOshikatsuAffiliateService,
  updateOshikatsuAffiliateCreative,
} from '@/lib/oshikatsu-affiliate/store';
import { parseCreativeInput } from '@/lib/oshikatsu-affiliate/input';
import { revalidateOshikatsuAffiliatePages } from '@/lib/oshikatsu-affiliate/revalidate';

// 広告素材の更新・削除。タグを差し替える場合も安全確認（checkAdTag）に通ったものだけを改変せずに保存する。
export const dynamic = 'force-dynamic';

type Loaded =
  | { ok: false; res: NextResponse }
  | { ok: true; id: number; service: NonNullable<Awaited<ReturnType<typeof getOshikatsuAffiliateService>>> };

async function load(params: Promise<{ id: string }>): Promise<Loaded> {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return { ok: false, res: NextResponse.json({ error: '不正なIDです' }, { status: 400 }) };
  const creative = await getOshikatsuAffiliateCreative(id);
  if (!creative) return { ok: false, res: NextResponse.json({ error: '素材が見つかりません' }, { status: 404 }) };
  const service = await getOshikatsuAffiliateService(creative.serviceId);
  if (!service) return { ok: false, res: NextResponse.json({ error: '案件が見つかりません' }, { status: 404 }) };
  return { ok: true, id, service };
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const loaded = await load(params);
    if (!loaded.ok) return loaded.res;
    const parsed = parseCreativeInput(await req.json().catch(() => null), loaded.service.aspId, 'update');
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const record = await updateOshikatsuAffiliateCreative(loaded.id, parsed.value);
    revalidateOshikatsuAffiliatePages(loaded.service.category);
    return NextResponse.json(record);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const loaded = await load(params);
    if (!loaded.ok) return loaded.res;
    await deleteOshikatsuAffiliateCreative(loaded.id);
    revalidateOshikatsuAffiliatePages(loaded.service.category);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
