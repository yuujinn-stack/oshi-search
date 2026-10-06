import { NextRequest } from 'next/server';
import { handleWorkerRequest, str } from '@/server/video-jobs/worker-route';
import { VideoJobError } from '@/server/video-jobs/job-store';
import { getFirst3SourceCards, getFirst3SourceWorks } from '@/server/video-jobs/first3-source';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 1回に問い合わせられる作品数（Workerは候補の新しい順に最大25件まで確認する） */
const MAX_WORK_IDS = 30;

/**
 * 「まず見る3作 ショートV1」の作品選定の入力データ（読み取りのみ。DBへは書き込まない）。
 *   { personName } → 人物ページの「出演作品」と同じ作品カード
 *   { workIds }    → 作品ページと同じ作品名・種別・年・配信情報
 * 選定ルールはoshi-video-maker側（first3Selection）にだけあり、ここでは選ばない。
 */
export async function POST(req: NextRequest) {
  return handleWorkerRequest(req, async ({ body }) => {
    if (Array.isArray(body.workIds)) {
      const ids = body.workIds.filter((id): id is string => typeof id === 'string').map((id) => id.slice(0, 200)).slice(0, MAX_WORK_IDS);
      return { works: await getFirst3SourceWorks(ids) };
    }
    const personName = str(body.personName, 100)?.trim();
    if (!personName) throw new VideoJobError('personName または workIds を指定してください。', 400);
    const cards = await getFirst3SourceCards(personName);
    if (!cards) throw new VideoJobError(`推しサーチに登録されていない人物です: ${personName}`, 404);
    return cards;
  });
}
