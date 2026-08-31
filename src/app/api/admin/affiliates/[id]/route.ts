import { NextRequest, NextResponse } from 'next/server';
import {
  getAffiliateProgramById,
  updateAffiliateProgram,
  deleteAffiliateProgram,
  type AffiliateProgramInput,
} from '@/lib/affiliate-store';
import { revalidateAffiliateVodService } from '@/lib/affiliate-revalidate';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = Number((await params).id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
    }

    const existing = await getAffiliateProgramById(id);
    if (!existing) {
      return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    }

    const body = (await req.json()) as Partial<AffiliateProgramInput>;
    if (body.vodService !== undefined && !body.vodService.trim()) {
      return NextResponse.json({ error: 'VODサービスは必須です' }, { status: 400 });
    }

    const input: AffiliateProgramInput = {
      vodService: body.vodService?.trim() ?? existing.vodService,
      aspName: body.aspName?.trim() ?? existing.aspName,
      programName: body.programName?.trim() ?? existing.programName,
      status: body.status ?? existing.status,
      rulesNote: body.rulesNote !== undefined ? (body.rulesNote?.trim() || null) : existing.rulesNote,
      directUrlAllowed: body.directUrlAllowed ?? existing.directUrlAllowed,
      customCreativeAllowed: body.customCreativeAllowed ?? existing.customCreativeAllowed,
      isActive: body.isActive ?? existing.isActive,
    };

    const updated = await updateAffiliateProgram(id, input);
    if (!updated) {
      return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    }
    revalidateAffiliateVodService(existing.vodService);
    revalidateAffiliateVodService(updated.vodService);
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
    const existing = await getAffiliateProgramById(id);
    await deleteAffiliateProgram(id);
    if (existing) revalidateAffiliateVodService(existing.vodService);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
