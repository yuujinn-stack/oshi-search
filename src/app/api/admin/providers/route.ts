import { NextRequest, NextResponse } from 'next/server';
import { getAllProviders, saveProvider } from '@/lib/provider-store';
import type { ProviderRecord } from '@/lib/provider-store';
import { normalizeProviderName } from '@/lib/vod-dedup';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const providers = await getAllProviders();
    return NextResponse.json(providers);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ProviderRecord>;
    const { name, slug, logoUrl, isActive } = body;

    if (!name?.trim() || !slug?.trim() || !logoUrl?.trim()) {
      return NextResponse.json(
        { error: '名前・slug・logoUrl は必須です' },
        { status: 400 },
      );
    }

    // slug は ProviderLogo の resolveServiceKey と同じ正規化ルールを適用する
    // 例: "U-NEXT" / "u-next" → "unext" / "Prime Video" → "primevideo"
    const normalizedSlug = normalizeProviderName(slug.trim());

    const record: ProviderRecord = {
      id: normalizedSlug,
      name: name.trim(),
      slug: normalizedSlug,
      logoUrl: logoUrl.trim(),
      isActive: isActive ?? true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveProvider(record);
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
