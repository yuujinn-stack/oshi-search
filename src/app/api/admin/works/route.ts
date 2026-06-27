import { NextRequest, NextResponse } from 'next/server';
import { getAllWorks } from '@/lib/work-store';

// GET /api/admin/works?person={name}[&includeDeleted=true]
// 人物の全作品一覧を返す（管理画面用）デフォルトは論理削除済みを除外
export async function GET(req: NextRequest) {
  const person = req.nextUrl.searchParams.get('person');
  if (!person) {
    return NextResponse.json({ error: 'person パラメータが必要です' }, { status: 400 });
  }
  const includeDeleted = req.nextUrl.searchParams.get('includeDeleted') === 'true';
  const all = await getAllWorks(person);
  const works = includeDeleted ? all : all.filter((w) => !w.deleted);
  return NextResponse.json({ works });
}
