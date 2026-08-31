import { NextRequest, NextResponse } from 'next/server';
import {
  getAffiliatePlacementById,
  setAffiliatePlacementActive,
  deleteAffiliatePlacement,
  getAffiliateCreativeById,
  getAffiliateProgramById,
} from '@/lib/affiliate-store';
import { revalidateAffiliateVodService } from '@/lib/affiliate-revalidate';

export const dynamic = 'force-dynamic';

async function revalidateByPlacementCreativeId(creativeId: number) {
  const creative = await getAffiliateCreativeById(creativeId);
  if (!creative) return;
  const program = await getAffiliateProgramById(creative.programId);
  if (program) revalidateAffiliateVodService(program.vodService);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
    }
    const existing = await getAffiliatePlacementById(id);
    if (!existing) {
      return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    }
    const body = (await req.json()) as { isActive?: boolean };
    const updated = await setAffiliatePlacementActive(id, body.isActive ?? existing.isActive);
    if (updated) await revalidateByPlacementCreativeId(updated.creativeId);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
    }
    const existing = await getAffiliatePlacementById(id);
    await deleteAffiliatePlacement(id);
    if (existing) await revalidateByPlacementCreativeId(existing.creativeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
