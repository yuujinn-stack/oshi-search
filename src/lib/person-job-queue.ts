import { getRedis } from './redis';

const QUEUE_KEY = 'person:jobs:queue';
const JOB_PREFIX = 'person:jobs:';
const BY_PERSON_KEY = 'person:jobs:by-person';
const JOB_TTL = 60 * 60 * 24 * 30; // 30日

export type PersonJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial_error'
  | 'failed'
  | 'cancelled';

export interface PersonJobStep {
  status: 'pending' | 'running' | 'done' | 'failed';
  error?: string;
}

export interface PersonJob {
  jobId: string;
  personName: string;
  status: PersonJobStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
  steps: {
    tmdb: PersonJobStep;
    rakuten: PersonJobStep;
  };
}

function makeJobId(): string {
  return `pj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseJob(raw: unknown): PersonJob | null {
  try {
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as PersonJob;
  } catch {
    return null;
  }
}

export async function enqueuePersonJob(personName: string): Promise<string> {
  const redis = getRedis();
  if (!redis) throw new Error('Redis not available');

  const jobId = makeJobId();
  const job: PersonJob = {
    jobId,
    personName,
    status: 'queued',
    createdAt: Date.now(),
    steps: {
      tmdb: { status: 'pending' },
      rakuten: { status: 'pending' },
    },
  };

  await redis.set(`${JOB_PREFIX}${jobId}`, JSON.stringify(job), { ex: JOB_TTL });
  await redis.hset(BY_PERSON_KEY, { [personName]: jobId });
  await redis.lpush(QUEUE_KEY, jobId);

  return jobId;
}

export async function dequeuePersonJob(): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  const result = await redis.rpop<string>(QUEUE_KEY);
  return result ?? null;
}

export async function getJob(jobId: string): Promise<PersonJob | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(`${JOB_PREFIX}${jobId}`);
  if (!raw) return null;
  return parseJob(raw);
}

export async function updateJob(jobId: string, updates: Partial<PersonJob>): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const job = await getJob(jobId);
  if (!job) return;
  await redis.set(`${JOB_PREFIX}${jobId}`, JSON.stringify({ ...job, ...updates }), { ex: JOB_TTL });
}

export async function getJobByPerson(personName: string): Promise<PersonJob | null> {
  const redis = getRedis();
  if (!redis) return null;
  const jobId = await redis.hget<string>(BY_PERSON_KEY, personName);
  if (!jobId) return null;
  return getJob(jobId);
}

export async function getQueueLength(): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  try { return await redis.llen(QUEUE_KEY); } catch { return 0; }
}

export async function getAllJobs(limit = 200): Promise<PersonJob[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const byPerson = await redis.hgetall(BY_PERSON_KEY);
    if (!byPerson) return [];
    const jobIds = Object.values(byPerson) as string[];
    const jobs = await Promise.all(jobIds.map((id) => getJob(id)));
    return (jobs.filter(Boolean) as PersonJob[])
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  } catch (err) {
    console.error('[person-job-queue] getAllJobs failed:', err);
    return [];
  }
}

// status=processing かつ startedAt が一定時間以上前のジョブを検出し queued にリセット
// Vercel Function タイムアウト時に processing のまま残るジョブを自動復旧するために使用
export async function resetStuckJobs(): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];

  const stuckMinutes = parseInt(process.env.PERSON_JOB_STUCK_MINUTES ?? '15', 10);
  const threshold = Date.now() - stuckMinutes * 60 * 1000;

  const byPerson = await redis.hgetall(BY_PERSON_KEY);
  if (!byPerson) return [];

  const jobIds = Object.values(byPerson) as string[];
  const jobs = await Promise.all(jobIds.map((id) => getJob(id)));

  const reset: string[] = [];
  for (const job of jobs) {
    if (!job || job.status !== 'processing') continue;
    if (!job.startedAt || job.startedAt >= threshold) continue;
    await requeueJob(job.jobId);
    reset.push(job.jobId);
  }
  return reset;
}

export async function requeueJob(jobId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const job = await getJob(jobId);
  if (!job) return;

  const updated: PersonJob = {
    ...job,
    status: 'queued',
    startedAt: undefined,
    completedAt: undefined,
    errorMessage: undefined,
    steps: {
      tmdb: { status: 'pending' },
      rakuten: { status: 'pending' },
    },
  };
  await redis.set(`${JOB_PREFIX}${jobId}`, JSON.stringify(updated), { ex: JOB_TTL });
  await redis.hset(BY_PERSON_KEY, { [job.personName]: jobId });
  await redis.lpush(QUEUE_KEY, jobId);
}
