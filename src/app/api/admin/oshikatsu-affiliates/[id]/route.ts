import { NextRequest, NextResponse } from 'next/server';
import { getOshikatsuAffiliateService, updateOshikatsuAffiliateService } from '@/lib/oshikatsu-affiliate/store';
import { parseServiceInput } from '@/lib/oshikatsu-affiliate/input';
import { revalidateOshikatsuAffiliatePages } from '@/lib/oshikatsu-affiliate/revalidate';

// 推し活サービスのアフィリエイト案件の編集（提携状態・広告の有効/無効の切り替えを含む）。
// 案件の削除は用意しない（終了した案件は提携状態を「終了」にする。広告は自動で非表示になる）。
export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
    const existing = await getOshikatsuAffiliateService(id);
    if (!existing) return NextResponse.json({ error: '見つかりません' }, { status: 404 });

    const parsed = parseServiceInput(await req.json().catch(() => null), 'update');
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const record = await updateOshikatsuAffiliateService(id, parsed.value);
    if (!record) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    revalidateOshikatsuAffiliatePages(existing.category, record.category);
    return NextResponse.json(record);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
