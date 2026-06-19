import { NextRequest, NextResponse } from 'next/server';
import { getAllProviders, saveProvider } from '@/lib/provider-store';
import type { ProviderRecord } from '@/lib/provider-store';

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

    const record: ProviderRecord = {
      id: slug.trim().toLowerCase(),
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
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
