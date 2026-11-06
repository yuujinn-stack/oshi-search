import { NextRequest, NextResponse } from 'next/server';
import {
  createOshikatsuAffiliateService,
  findOshikatsuAffiliateServiceByKey,
  listOshikatsuAffiliateServicesOrThrow,
} from '@/lib/oshikatsu-affiliate/store';
import { parseServiceInput } from '@/lib/oshikatsu-affiliate/input';
import { OSHIKATSU_AFFILIATE_PRESETS } from '@/lib/oshikatsu-affiliate/constants';
import { revalidateOshikatsuAffiliatePages } from '@/lib/oshikatsu-affiliate/revalidate';

// 推し活サービスのアフィリエイト案件（一覧・新規登録）。認証は src/proxy.ts（/api/admin/*）で必須。
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await listOshikatsuAffiliateServicesOrThrow());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    // 初期案件（constants.ts の OSHIKATSU_AFFILIATE_PRESETS）のうち、未登録のものだけを登録する。広告は無効で作成。
    if (body?.presets === true) {
      const created = [];
      for (const p of OSHIKATSU_AFFILIATE_PRESETS) {
        if (await findOshikatsuAffiliateServiceByKey(p.serviceKey)) continue;
        created.push(await createOshikatsuAffiliateService({ ...p, programId: null, isAdEnabled: false, note: null, checkedAt: null }));
      }
      return NextResponse.json({ created }, { status: 201 });
    }

    const parsed = parseServiceInput(body, 'create');
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (await findOshikatsuAffiliateServiceByKey(parsed.value.serviceKey)) {
      return NextResponse.json({ error: `サービスキー「${parsed.value.serviceKey}」はすでに登録されています` }, { status: 409 });
    }
    const record = await createOshikatsuAffiliateService(parsed.value);
    revalidateOshikatsuAffiliatePages(record.category);
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
