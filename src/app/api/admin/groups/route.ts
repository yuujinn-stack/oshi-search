import { NextResponse } from 'next/server';
import { getAllGroupMetas, saveGroupMeta, deleteGroupMeta, saveGroupHomeCategory } from '@/lib/group-meta';
import { isHomeGroupCategory } from '@/lib/home-group-category';
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
      gender: body.gender === 'female' || body.gender === 'male' ? body.gender : undefined,
      createdAt: body.createdAt ?? Date.now(),
    };
    await saveGroupMeta(meta);
    return NextResponse.json(meta);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// トップページ「グループで探す」の分類だけを保存する（管理画面の分類のプルダウン＋保存ボタン）。
// /api/admin/* は src/proxy.ts で管理者セッション必須。値は女性アイドル・男性アイドル・その他の3つだけ受け付ける。
// POST（グループ編集フォーム）は home_category を変更しないため、分類の変更はこの PATCH だけで行われる。
export async function PATCH(req: Request) {
  let body: { groupName?: unknown; homeCategory?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が正しくありません' }, { status: 400 });
  }
  const groupName = typeof body.groupName === 'string' ? body.groupName.trim() : '';
  if (!groupName) {
    return NextResponse.json({ error: 'groupName は必須です' }, { status: 400 });
  }
  if (!isHomeGroupCategory(body.homeCategory)) {
    return NextResponse.json({ error: '分類は「女性アイドル」「男性アイドル」「その他」のいずれかを選んでください' }, { status: 400 });
  }
  try {
    const found = await saveGroupHomeCategory(groupName, body.homeCategory);
    if (!found) {
      return NextResponse.json({ error: `グループ「${groupName}」が見つかりません` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, groupName, homeCategory: body.homeCategory });
  } catch (err) {
    return NextResponse.json({ error: `保存に失敗しました: ${String(err)}` }, { status: 500 });
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
