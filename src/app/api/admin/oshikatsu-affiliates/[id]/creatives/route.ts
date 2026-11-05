import { NextRequest, NextResponse } from 'next/server';
import { createOshikatsuAffiliateCreative, getOshikatsuAffiliateService } from '@/lib/oshikatsu-affiliate/store';
import { parseCreativeInput } from '@/lib/oshikatsu-affiliate/input';
import { revalidateOshikatsuAffiliatePages } from '@/lib/oshikatsu-affiliate/revalidate';

// 広告素材（ASP発行の広告HTMLタグ）の登録。タグは安全確認（checkAdTag）に通ったものだけを、改変せずに保存する。
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
    const service = await getOshikatsuAffiliateService(id);
    if (!service) return NextResponse.json({ error: '案件が見つかりません' }, { status: 404 });

    const parsed = parseCreativeInput(await req.json().catch(() => null), service.aspId, 'create');
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const record = await createOshikatsuAffiliateCreative(id, parsed.value);
    revalidateOshikatsuAffiliatePages(service.category);
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
