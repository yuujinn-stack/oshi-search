import { NextRequest, NextResponse } from 'next/server';
import {
  getAffiliateCreativeById,
  updateAffiliateCreative,
  deleteAffiliateCreative,
  getAffiliateProgramById,
  type AffiliateCreativeInput,
} from '@/lib/affiliate-store';
import { revalidateAffiliateVodService } from '@/lib/affiliate-revalidate';

export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set(['raw_html', 'direct_url', 'banner', 'text', 'embed']);
const VALID_DEVICES = new Set(['all', 'desktop', 'mobile']);

async function revalidateByProgramId(programId: number) {
  const program = await getAffiliateProgramById(programId);
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
    const existing = await getAffiliateCreativeById(id);
    if (!existing) {
      return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    }

    const body = (await req.json()) as Partial<AffiliateCreativeInput>;
    if (body.type !== undefined && !VALID_TYPES.has(body.type)) {
      return NextResponse.json({ error: '不正なtypeです' }, { status: 400 });
    }
    if (body.device !== undefined && !VALID_DEVICES.has(body.device)) {
      return NextResponse.json({ error: '不正なdeviceです' }, { status: 400 });
    }

    const input: AffiliateCreativeInput = {
      name: body.name?.trim() ?? existing.name,
      type: body.type ?? existing.type,
      rawCode: body.rawCode !== undefined ? (body.rawCode || null) : existing.rawCode,
      destinationUrl: body.destinationUrl !== undefined ? (body.destinationUrl?.trim() || null) : existing.destinationUrl,
      imageUrl: body.imageUrl !== undefined ? (body.imageUrl?.trim() || null) : existing.imageUrl,
      altText: body.altText !== undefined ? (body.altText?.trim() || null) : existing.altText,
      width: body.width !== undefined ? body.width : existing.width,
      height: body.height !== undefined ? body.height : existing.height,
      device: body.device ?? existing.device,
      priority: body.priority ?? existing.priority,
      isActive: body.isActive ?? existing.isActive,
      startsAt: body.startsAt !== undefined ? body.startsAt : existing.startsAt,
      endsAt: body.endsAt !== undefined ? body.endsAt : existing.endsAt,
    };

    const updated = await updateAffiliateCreative(id, input);
    if (!updated) {
      return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    }
    await revalidateByProgramId(updated.programId);
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
    const existing = await getAffiliateCreativeById(id);
    await deleteAffiliateCreative(id);
    if (existing) await revalidateByProgramId(existing.programId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
