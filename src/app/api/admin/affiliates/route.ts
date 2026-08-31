import { NextRequest, NextResponse } from 'next/server';
import {
  getAllAffiliateProgramsOrThrow,
  createAffiliateProgram,
  type AffiliateProgramInput,
} from '@/lib/affiliate-store';
import { revalidateAffiliateVodService } from '@/lib/affiliate-revalidate';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const programs = await getAllAffiliateProgramsOrThrow();
    return NextResponse.json(programs);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<AffiliateProgramInput>;
    const { vodService, aspName, programName } = body;

    if (!vodService?.trim() || !aspName?.trim() || !programName?.trim()) {
      return NextResponse.json(
        { error: 'VODサービス・ASP名・案件名は必須です' },
        { status: 400 },
      );
    }

    const input: AffiliateProgramInput = {
      vodService: vodService.trim(),
      aspName: aspName.trim(),
      programName: programName.trim(),
      status: body.status ?? 'active',
      rulesNote: body.rulesNote?.trim() || null,
      directUrlAllowed: body.directUrlAllowed ?? true,
      customCreativeAllowed: body.customCreativeAllowed ?? true,
      isActive: body.isActive ?? true,
    };

    const record = await createAffiliateProgram(input);
    revalidateAffiliateVodService(record.vodService);
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
