import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { getGroupGenderRows } from '@/lib/photobook-store';
import { bulkSetGroupGender } from '@/lib/photobook-gender-write';

// 1回のリクエストで一括変更できるグループ数の上限（暴走リクエスト・異常に大量な値を防ぐ）
const MAX_BULK_TARGETS = 500;

function isValidNameList(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0 || value.length > MAX_BULK_TARGETS) return false;
  return value.every((v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200);
}

// GET: gender管理パネル用のグループ一覧
export async function GET() {
  try {
    const rows = await getGroupGenderRows();
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST: 選択した複数グループへ一括でgenderを設定する（推測は一切行わない）。
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { groupNames?: unknown; gender?: unknown };
    const { groupNames, gender } = body;
    if (!isValidNameList(groupNames)) {
      return NextResponse.json(
        { error: `groupNames は1〜${MAX_BULK_TARGETS}件の空でない文字列配列である必要があります` },
        { status: 400 },
      );
    }
    if (gender !== 'female' && gender !== 'male' && gender !== null) {
      return NextResponse.json({ error: 'gender は female/male/null のいずれかである必要があります' }, { status: 400 });
    }
    const result = await bulkSetGroupGender(groupNames, gender);

    revalidateTag('photobook-home', { expire: 0 });
    revalidatePath('/photobooks');

    return NextResponse.json({ ok: true, updated: result.updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
