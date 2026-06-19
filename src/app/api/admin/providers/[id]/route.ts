import { NextRequest, NextResponse } from 'next/server';
import { getAllProviders, saveProvider, deleteProvider } from '@/lib/provider-store';
import type { ProviderRecord } from '@/lib/provider-store';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: slug } = await params;
    const body = (await req.json()) as Partial<ProviderRecord>;

    const all = await getAllProviders();
    const existing = all.find((p) => p.slug === slug);
    if (!existing) {
      return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    }

    const updated: ProviderRecord = {
      ...existing,
      name: body.name?.trim() ?? existing.name,
      logoUrl: body.logoUrl?.trim() ?? existing.logoUrl,
      isActive: body.isActive ?? existing.isActive,
      updatedAt: Date.now(),
    };

    await saveProvider(updated);
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
    const { id: slug } = await params;
    await deleteProvider(slug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
