import { NextRequest, NextResponse } from 'next/server';
import { getAllWorks } from '@/lib/work-store';

// GET /api/admin/works?person={name}
// 人物の全作品一覧を返す（管理画面用）
export async function GET(req: NextRequest) {
  const person = req.nextUrl.searchParams.get('person');
  if (!person) {
    return NextResponse.json({ error: 'person パラメータが必要です' }, { status: 400 });
  }
  const works = await getAllWorks(person);
  return NextResponse.json({ works });
}
