import { NextRequest, NextResponse } from 'next/server';
import {
  getAffiliateProgramById,
  createAffiliateCreative,
  type AffiliateCreativeInput,
} from '@/lib/affiliate-store';
import { revalidateAffiliateVodService } from '@/lib/affiliate-revalidate';

export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set(['raw_html', 'direct_url', 'banner', 'text', 'embed']);
const VALID_DEVICES = new Set(['all', 'desktop', 'mobile']);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const programId = Number((await params).id);
    if (!Number.isInteger(programId)) {
      return NextResponse.json({ error: '不正なIDです' }, { status: 400 });
    }
    const program = await getAffiliateProgramById(programId);
    if (!program) {
      return NextResponse.json({ error: '案件が見つかりません' }, { status: 404 });
    }

    const body = (await req.json()) as Partial<AffiliateCreativeInput>;
    if (!body.name?.trim() || !body.type || !VALID_TYPES.has(body.type)) {
      return NextResponse.json({ error: '素材名・typeは必須です' }, { status: 400 });
    }
    const device = body.device && VALID_DEVICES.has(body.device) ? body.device : 'all';

    const input: AffiliateCreativeInput = {
      name: body.name.trim(),
      type: body.type,
      rawCode: body.rawCode || null,
      destinationUrl: body.destinationUrl?.trim() || null,
      imageUrl: body.imageUrl?.trim() || null,
      altText: body.altText?.trim() || null,
      width: body.width ?? null,
      height: body.height ?? null,
      device,
      priority: body.priority ?? 0,
      isActive: body.isActive ?? true,
      startsAt: body.startsAt ?? null,
      endsAt: body.endsAt ?? null,
    };

    const record = await createAffiliateCreative(programId, input);
    revalidateAffiliateVodService(program.vodService);
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
