import 'server-only';
import { getRedis } from '@/lib/redis';
import { BF_PREVIEW_RECORD_MESSAGE, bfRecordSaveBlocked, parseStoryPostRecord, StoryRecordError, type StoryPostRecord } from '@/lib/story-maker/metrics';
import { isBfTemplate } from '@/lib/story-maker/templates';
import { verifyBfRecordApprovals } from './bf-approval';

/**
 * Instagramストーリーズの効果測定の記録（/admin/story-maker）。
 * SNS投稿の計測用の補助データのため Redis のハッシュ1つに保存する（DBのテーブル・列は増やさない。
 * 人物・作品・商品などの正本データには触れない）。
 *
 * Vercel の Preview は Production と同じ Redis を使う設定のため、本番（VERCEL_ENV=production）だけが
 * 基本のキーを使い、Preview・ローカルは環境ごとの別キーに保存する（sns-cta-settings.ts と同じ考え方）。
 */
const BASE_KEY = 'story-maker:posts:v1';
const MAX_RECORDS = 2000;

export function storyPostsKey(vercelEnv: string | undefined = process.env.VERCEL_ENV): string {
  return vercelEnv === 'production' ? BASE_KEY : `${BASE_KEY}:${vercelEnv || 'local'}`;
}

export function storyPostsScope(vercelEnv: string | undefined = process.env.VERCEL_ENV): 'production' | 'preview' | 'local' {
  return vercelEnv === 'production' ? 'production' : vercelEnv === 'preview' ? 'preview' : 'local';
}

export class StoryStorageUnavailableError extends Error {
  constructor() {
    super('記録の保存先（Redis）が設定されていないため、この環境では記録を保存できません。CSVで書き出してください。');
  }
}

function decode(raw: unknown): StoryPostRecord | null {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const rec = obj as StoryPostRecord;
    // 保存済みの値は検証済み。createdAt/updatedAt を保ったまま形だけ確かめる
    parseStoryPostRecord(rec);
    return rec;
  } catch {
    return null;
  }
}

export async function listStoryPosts(): Promise<{ records: StoryPostRecord[]; storage: boolean }> {
  const redis = getRedis();
  if (!redis) return { records: [], storage: false };
  const all = (await redis.hgetall<Record<string, unknown>>(storyPostsKey())) ?? {};
  const records = Object.values(all)
    .map(decode)
    .filter((r): r is StoryPostRecord => r !== null)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt) || b.createdAt.localeCompare(a.createdAt));
  return { records, storage: true };
}

/** 追加・更新（同じIDは上書き。作成日時は最初の値を保つ） */
export async function saveStoryPost(raw: unknown): Promise<StoryPostRecord> {
  const redis = getRedis();
  if (!redis) throw new StoryStorageUnavailableError();
  const key = storyPostsKey();
  const draft = parseStoryPostRecord(raw);
  // Preview（本番と同じ Redis）では楽天BFの記録を保存しない。Redis を読む・書く前に止める
  if (bfRecordSaveBlocked(draft.templateId, storyPostsScope())) throw new StoryRecordError(BF_PREVIEW_RECORD_MESSAGE);
  const existing = decode(await redis.hget(key, draft.id));
  // 楽天BF：掲載商品の承認がサーバーの署名つきで、投稿日時の時点で有効だったか。新しく記録する承認はサーバーの今の時刻でも有効なこと
  // （保存済みの記録と同じ承認はそのまま編集できる）。他のテンプレートは従来どおり
  if (isBfTemplate(draft.templateId)) {
    const errors = await verifyBfRecordApprovals(draft, Date.now(), existing?.saleItems ?? null);
    if (errors.length > 0) throw new StoryRecordError(errors.join(' '));
  }
  if (!existing && (await redis.hlen(key)) >= MAX_RECORDS) {
    throw new StoryRecordError(`記録は${MAX_RECORDS}件までです。不要な記録を削除してください。`);
  }
  const record: StoryPostRecord = { ...draft, createdAt: existing?.createdAt ?? draft.createdAt };
  await redis.hset(key, { [record.id]: JSON.stringify(record) });
  return record;
}

export async function deleteStoryPost(id: string): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new StoryStorageUnavailableError();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new StoryRecordError('記録のIDが正しくありません。');
  await redis.hdel(storyPostsKey(), id);
}
