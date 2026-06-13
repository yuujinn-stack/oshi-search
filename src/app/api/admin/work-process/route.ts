import { NextRequest, NextResponse } from 'next/server';
import { getPersonWithConfig } from '@/lib/persons';
import { processPersonWorks } from '@/lib/work-processor';

// POST /api/admin/work-process
// body: { personName, action?, forceRejudge?, deleteSupplementFirst?, includeVod? }
// 管理画面からのみ呼び出し可（proxy.ts で認証済み）
// includeVod=true にすると、作品処理後に配信情報取得（TMDb+AI Web検索）まで自動実行する
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, action, forceRejudge, deleteSupplementFirst, includeVod } = body as {
    personName?: string;
    action?: 'tmdb' | 'supplement' | 'all';
    forceRejudge?: boolean;
    deleteSupplementFirst?: boolean;
    includeVod?: boolean;
  };

  if (!personName) {
    return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });
  }

  const person = getPersonWithConfig(personName);
  if (!person) {
    return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });
  }

  const result = await processPersonWorks(person, {
    action: action ?? 'tmdb',
    forceRejudge: forceRejudge ?? false,
    deleteSupplementFirst: deleteSupplementFirst ?? false,
    includeVod: includeVod ?? false,
  });
  return NextResponse.json(result);
}
