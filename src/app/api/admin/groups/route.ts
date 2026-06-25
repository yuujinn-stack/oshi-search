import { NextResponse } from 'next/server';
import { getAllGroupMetas, saveGroupMeta, deleteGroupMeta } from '@/lib/group-meta';
import type { GroupMeta } from '@/types/group';

export async function GET() {
  try {
    const metas = await getAllGroupMetas();
    return NextResponse.json(metas);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Partial<GroupMeta>;
    if (!body.groupName?.trim()) {
      return NextResponse.json({ error: 'groupName は必須です' }, { status: 400 });
    }
    const meta: GroupMeta = {
      groupName: body.groupName.trim(),
      slug: (body.slug ?? body.groupName).trim(),
      activityStatus: body.activityStatus ?? 'active',
      formedAt: body.formedAt?.trim() || undefined,
      endedAt: body.endedAt?.trim() || undefined,
      renamedFrom: body.renamedFrom?.trim() || undefined,
      renamedTo: body.renamedTo?.trim() || undefined,
      formerNames: (body.formerNames ?? []).filter(Boolean),
      officialSite: body.officialSite?.trim() || undefined,
      note: body.note?.trim() || undefined,
      createdAt: body.createdAt ?? Date.now(),
    };
    await saveGroupMeta(meta);
    return NextResponse.json(meta);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { groupName } = await req.json() as { groupName: string };
    if (!groupName) {
      return NextResponse.json({ error: 'groupName は必須です' }, { status: 400 });
    }
    await deleteGroupMeta(groupName);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
