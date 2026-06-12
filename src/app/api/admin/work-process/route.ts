import { NextRequest, NextResponse } from 'next/server';
import { getPersonWithConfig } from '@/lib/persons';
import { processPersonWorks } from '@/lib/work-processor';

// POST /api/admin/work-process
// body: { personName: string }
// TMDb から出演作品を取得し AI 判定して Redis に保存する
// 管理画面からのみ呼び出し可（proxy.ts で認証済み）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, forceRejudge } = body as {
    personName?: string;
    forceRejudge?: boolean;
  };

  if (!personName) {
    return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });
  }

  const person = getPersonWithConfig(personName);
  if (!person) {
    return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });
  }

  const result = await processPersonWorks(person, forceRejudge ?? false);
  return NextResponse.json(result);
}
