import { NextResponse } from 'next/server';
import { getAllGroupMetas, saveGroupMeta, deleteGroupMeta } from '@/lib/group-meta';
import { isAsciiSlug } from '@/lib/group-slug';
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

    const rawSlug = body.slug?.trim() ?? '';

    // slug が空でない場合はフォーマットチェック
    if (rawSlug && !isAsciiSlug(rawSlug)) {
      return NextResponse.json(
        { error: 'slugは英小文字・数字・ハイフンのみ、先頭は英数字で入力してください' },
        { status: 400 },
      );
    }

    // slug 重複チェック（同一グループ名を除く）
    if (rawSlug) {
      const existing = await getAllGroupMetas();
      const dup = existing.find(
        (m) => m.groupName !== body.groupName!.trim() && isAsciiSlug(m.slug) && m.slug === rawSlug,
      );
      if (dup) {
        return NextResponse.json(
          { error: `このslugは「${dup.groupName}」で既に使用されています` },
          { status: 409 },
        );
      }
    }

    const meta: GroupMeta = {
      groupName: body.groupName.trim(),
      slug: rawSlug,
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
