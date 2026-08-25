import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { getPersonGenderRows } from '@/lib/photobook-store';
import { bulkSetPersonGender } from '@/lib/photobook-gender-write';

// 1回のリクエストで一括変更できる人物数の上限（暴走リクエスト・異常に大量な値を防ぐ）
const MAX_BULK_TARGETS = 500;

function isValidNameList(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0 || value.length > MAX_BULK_TARGETS) return false;
  return value.every((v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200);
}

// GET: gender管理パネル用の人物一覧（絞り込みはクライアント側で行う）
export async function GET() {
  try {
    const rows = await getPersonGenderRows();
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST: 選択した複数人物へ一括でgenderを設定する。
// gender推測は一切行わない。管理者が選択した人物名リストへ、指定されたgender値を
// そのまま保存するだけ（'female' | 'male' | null(未設定に戻す)）。
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { personNames?: unknown; gender?: unknown };
    const { personNames, gender } = body;
    if (!isValidNameList(personNames)) {
      return NextResponse.json(
        { error: `personNames は1〜${MAX_BULK_TARGETS}件の空でない文字列配列である必要があります` },
        { status: 400 },
      );
    }
    if (gender !== 'female' && gender !== 'male' && gender !== null) {
      return NextResponse.json({ error: 'gender は female/male/null のいずれかである必要があります' }, { status: 400 });
    }
    const result = await bulkSetPersonGender(personNames, gender);

    // 保存直後に写真集一覧・ホームへ反映されるようキャッシュを無効化する
    // （/photobooks・/admin/photobooksはsearchParams依存/force-dynamicのため元々動的だが、
    //  ホームのunstable_cacheラップ分だけ明示的にrevalidateする）。
    revalidateTag('photobook-home', { expire: 0 });
    revalidatePath('/photobooks');

    return NextResponse.json({ ok: true, updated: result.updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
