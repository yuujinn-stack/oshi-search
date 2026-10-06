import { NextRequest } from 'next/server';
import { handleWorkerRequest } from '@/server/video-jobs/worker-route';
import { getAllPersonsMerged } from '@/lib/persons';
import { personVideoSlug } from '@/server/video-jobs/person-slug';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 動画の対象人物一覧（管理画面 /admin/video-maker の人物一覧と同じ getAllPersonsMerged）。
 * 「まず見る3作」の全人物の台本準備で使う。推しサーチに人物を登録すれば、コード変更なしで対象に入る。
 * slugは管理画面の依頼（personVideoSlug）と同じ値。Worker側でPERSON_REGISTRYの人物は既存のslugへ読み替える。
 */
export async function POST(req: NextRequest) {
  return handleWorkerRequest(req, async () => {
    const persons = await getAllPersonsMerged();
    return { persons: persons.map((p) => ({ name: p.name, slug: personVideoSlug(p.name) })) };
  });
}
