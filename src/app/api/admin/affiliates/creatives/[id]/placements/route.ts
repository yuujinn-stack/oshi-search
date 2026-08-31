import { NextRequest, NextResponse } from 'next/server';
import {
  getAffiliateCreativeById,
  getAffiliateProgramById,
  addAffiliatePlacement,
} from '@/lib/affiliate-store';
import { revalidateAffiliateVodService } from '@/lib/affiliate-revalidate';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const creativeId = Number((await params).id);
    if (!Number.isInteger(creativeId)) {
      return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
    }
    const creative = await getAffiliateCreativeById(creativeId);
    if (!creative) {
      return NextResponse.json({ error: '広告素材が見つかりません' }, { status: 404 });
    }

    const body = (await req.json()) as { slotKey?: string };
    if (!body.slotKey?.trim()) {
      return NextResponse.json({ error: 'slotKeyは必須です' }, { status: 400 });
    }

    const record = await addAffiliatePlacement(creativeId, body.slotKey.trim());
    const program = await getAffiliateProgramById(creative.programId);
    if (program) revalidateAffiliateVodService(program.vodService);
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
