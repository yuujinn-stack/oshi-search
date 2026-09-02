// GET /api/cron/person-fetch
//
// 以前は Vercel Cron から日次実行されていたが、人物登録のたびに商品AI判定・
// 出演作品処理・作品AI判定・作品AI補完が自動実行されOpenAI費用が発生していたため、
// vercel.json の Cron 定義から削除し、自動実行を停止した。
// 同じ処理（processQueuedPersonJobs）は管理画面 /admin/people/import の
// 「処理開始」ボタン（/api/admin/person-jobs/process-now、要管理者ログイン）から
// 手動でのみ実行される。人物登録自体（/api/admin/people/import）はキューに積むだけで、
// このルートを含めどの経路からも自動では処理されない。
//
// このルート自体はCRON_SECRET認証つきのまま残しており、削除はしていない
// （Cronから外れているだけで、必要であれば運用上手動で叩くことも可能）。
// 1回の実行でキューから最大 PERSON_JOB_BATCH_SIZE 件を順番に処理（デフォルト1件、最大3件）

import { NextRequest, NextResponse } from 'next/server';
import { processQueuedPersonJobs } from '@/lib/person-job-processor';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = Math.min(
  parseInt(process.env.PERSON_JOB_BATCH_SIZE ?? process.env.PERSON_FETCH_BATCH_SIZE ?? '1', 10),
  3,
);

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET が設定されていません' }, { status: 503 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '認証エラー' }, { status: 401 });
  }

  try {
    const result = await processQueuedPersonJobs({ batchSize: BATCH_SIZE });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
