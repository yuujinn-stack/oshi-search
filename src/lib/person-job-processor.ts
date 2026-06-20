// 人物ジョブ処理の共通ロジック
// Vercel Cron (/api/cron/person-fetch) と手動実行 (/api/admin/person-jobs/process-now) で共有

import {
  dequeuePersonJob,
  getJob,
  updateJob,
  type PersonJob,
} from './person-job-queue';
import { getAllImportedPersons, updateImportedPersonStatus } from './imported-persons';
import { processPerson } from './batch-processor';
import { processPersonWorks } from './work-processor';
import type { PersonWithConfig } from '@/types/person';
import type { ImportedPerson } from './imported-persons';

export interface JobProcessResult {
  name: string;
  status: string;
  error?: string;
}

// 1件のジョブを処理する（楽天取得 + TMDb取得）
export async function processPersonJobById(
  jobId: string,
  allImported: ImportedPerson[],
): Promise<JobProcessResult> {
  const job = await getJob(jobId);
  if (!job) return { name: '不明', status: 'skipped', error: 'ジョブが見つかりません' };
  if (job.status === 'cancelled') return { name: job.personName, status: 'skipped', error: 'キャンセル済み' };
  if (job.status !== 'queued') return { name: job.personName, status: job.status, error: 'キュー待機中ではありません' };

  const imported = allImported.find((p) => p.name === job.personName);
  if (!imported) {
    await updateJob(jobId, { status: 'failed', completedAt: Date.now(), errorMessage: '人物データが見つかりません' });
    await updateImportedPersonStatus(job.personName, 'failed', '人物データが見つかりません');
    return { name: job.personName, status: 'failed', error: '人物データが見つかりません' };
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

  const steps: PersonJob['steps'] = { tmdb: { status: 'pending' }, rakuten: { status: 'pending' } };
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

  await updateJob(jobId, { status: finalStatus, completedAt: Date.now(), steps, errorMessage });
  await updateImportedPersonStatus(job.personName, finalStatus, errorMessage);

  return { name: job.personName, status: finalStatus, error: errorMessage };
}

// キューからN件取り出して処理、または指定ジョブIDを処理
export async function processQueuedPersonJobs(options?: {
  jobIds?: string[];
  batchSize?: number;
}): Promise<{ processed: number; results: JobProcessResult[] }> {
  const MAX_BATCH = 3;
  const allImported = await getAllImportedPersons();
  const results: JobProcessResult[] = [];

  if (options?.jobIds && options.jobIds.length > 0) {
    // 指定ジョブを処理（キューから取り出さず、jobIdで直接処理）
    const ids = options.jobIds.slice(0, MAX_BATCH);
    for (const jobId of ids) {
      results.push(await processPersonJobById(jobId, allImported));
    }
  } else {
    // キューから FIFO で取り出して処理
    const batchSize = Math.min(options?.batchSize ?? 1, MAX_BATCH);
    for (let i = 0; i < batchSize; i++) {
      const jobId = await dequeuePersonJob();
      if (!jobId) break;
      const job = await getJob(jobId);
      // 既に処理済み（手動実行済みなど）はスキップ
      if (!job || job.status !== 'queued') continue;
      results.push(await processPersonJobById(jobId, allImported));
    }
  }

  return { processed: results.length, results };
}
