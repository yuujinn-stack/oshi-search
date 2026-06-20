// GET /api/cron/person-fetch
// 人物データ取得ジョブキューを処理する Vercel Cron（日次実行）
// 1回の実行でキューから最大 PERSON_JOB_BATCH_SIZE 件を順番に処理（デフォルト1件、最大3件）

import { NextRequest, NextResponse } from 'next/server';
import {
  dequeuePersonJob,
  getJob,
  updateJob,
  type PersonJob,
} from '@/lib/person-job-queue';
import { getAllImportedPersons, updateImportedPersonStatus } from '@/lib/imported-persons';
import { processPerson } from '@/lib/batch-processor';
import { processPersonWorks } from '@/lib/work-processor';
import type { PersonWithConfig } from '@/types/person';

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

  const allImported = await getAllImportedPersons();
  const results: { name: string; status: string; error?: string }[] = [];

  for (let i = 0; i < BATCH_SIZE; i++) {
    const jobId = await dequeuePersonJob();
    if (!jobId) break;

    const job = await getJob(jobId);
    if (!job || job.status === 'cancelled') continue;

    const imported = allImported.find((p) => p.name === job.personName);
    if (!imported) {
      await updateJob(jobId, {
        status: 'failed',
        completedAt: Date.now(),
        errorMessage: '人物データが見つかりません',
      });
      continue;
    }

    await updateJob(jobId, { status: 'processing', startedAt: Date.now() });
    await updateImportedPersonStatus(job.personName, 'processing');

    const personWithConfig: PersonWithConfig = {
      name: imported.name,
      group: imported.group,
      genre: imported.genre,
      config: {
        aliases: imported.aliases.length > 0 ? imported.aliases : undefined,
        tmdbPersonId: imported.tmdbPersonId,
        checkStatus: 'unchecked',
      },
    };

    const steps: PersonJob['steps'] = {
      tmdb: { status: 'pending' },
      rakuten: { status: 'pending' },
    };
    const errors: string[] = [];
    let successCount = 0;

    // 楽天商品取得 + AI判定（変更禁止ロジック）
    try {
      const result = await processPerson(job.personName, false, personWithConfig);
      if (result.error) {
        errors.push(`楽天商品: ${result.error}`);
        steps.rakuten = { status: 'failed', error: result.error };
      } else {
        successCount++;
        steps.rakuten = { status: 'done' };
      }
    } catch (err) {
      const msg = String(err);
      errors.push(`楽天商品: ${msg}`);
      steps.rakuten = { status: 'failed', error: msg };
    }

    // TMDb出演作品取得
    try {
      const result = await processPersonWorks(personWithConfig, { action: 'tmdb', includeVod: false });
      if (result.error) {
        errors.push(`作品情報: ${result.error}`);
        steps.tmdb = { status: 'failed', error: result.error };
      } else {
        successCount++;
        steps.tmdb = { status: 'done' };
      }
    } catch (err) {
      const msg = String(err);
      errors.push(`作品情報: ${msg}`);
      steps.tmdb = { status: 'failed', error: msg };
    }

    const finalStatus =
      errors.length === 0 ? 'completed' :
      successCount > 0    ? 'partial_error' :
      'failed';
    const errorMessage = errors.length > 0 ? errors.join(' / ') : undefined;

    await updateJob(jobId, {
      status: finalStatus,
      completedAt: Date.now(),
      steps,
      errorMessage,
    });
    await updateImportedPersonStatus(job.personName, finalStatus, errorMessage);

    results.push({ name: job.personName, status: finalStatus, error: errorMessage });
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
