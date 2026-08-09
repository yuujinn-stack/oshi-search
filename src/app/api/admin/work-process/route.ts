import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getPersonWithConfigMerged } from '@/lib/persons';
import { processPersonWorks } from '@/lib/work-processor';
import { RANKING_DATA_CACHE_TAG } from '@/lib/ranking';

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

  const person = await getPersonWithConfigMerged(personName);
  if (!person) {
    return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });
  }

  const result = await processPersonWorks(person, {
    action: action ?? 'tmdb',
    forceRejudge: forceRejudge ?? false,
    deleteSupplementFirst: deleteSupplementFirst ?? false,
    includeVod: includeVod ?? false,
  });
  // TMDb再取得は既存作品のposterUrlも更新しうるため、正常に処理できた場合のみ
  // 「人気作品」のホーム表示キャッシュを再検証する
  if (!result.error) {
    revalidateTag(RANKING_DATA_CACHE_TAG, { expire: 0 });
  }
  return NextResponse.json(result);
}
