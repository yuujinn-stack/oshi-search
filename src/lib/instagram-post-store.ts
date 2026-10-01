import { db } from '@/db/client';
import { instagramPosts, instagramPostSchedules } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { buildTemplateHistory, type TemplateHistory } from './instagram-template-history';

export interface InstagramPostRecord {
  id: number;
  personName: string;
  mediaId: string;
  imageUrls: string[];
  caption: string;
  publishedAt: Date;
}

/** 投稿成功時に、人物名・media_id・使用画像URL・キャプションを記録する */
export async function recordInstagramPost(data: {
  personName: string;
  mediaId: string;
  imageUrls: string[];
  caption: string;
}): Promise<void> {
  await db.insert(instagramPosts).values({
    personName: data.personName,
    mediaId: data.mediaId,
    imageUrls: data.imageUrls,
    caption: data.caption,
  });
}

/** 指定した人物への投稿履歴を新しい順で返す（重複投稿の警告表示用） */
export async function getInstagramPostHistory(personName: string): Promise<InstagramPostRecord[]> {
  const rows = await db.select()
    .from(instagramPosts)
    .where(eq(instagramPosts.personName, personName))
    .orderBy(desc(instagramPosts.publishedAt));

  return rows.map((r) => ({
    id: r.id,
    personName: r.personName,
    mediaId: r.mediaId,
    imageUrls: (r.imageUrls as string[] | null) ?? [],
    caption: r.caption,
    publishedAt: r.publishedAt,
  }));
}

/** 指定した人物への投稿履歴が1件でもあるか */
export async function hasBeenPostedToInstagram(personName: string): Promise<boolean> {
  const history = await getInstagramPostHistory(personName);
  return history.length > 0;
}

/** Instagramへ投稿済みの人物名一覧（重複除去）。一括予約画面の「投稿済み」表示用 */
export async function listPostedPersonNames(): Promise<string[]> {
  const rows = await db.selectDistinct({ personName: instagramPosts.personName }).from(instagramPosts);
  return rows.map((r) => r.personName);
}

/**
 * 投稿済みの人物ごとに、直近の投稿日時（最新のpublishedAt）を返す。
 * 一括予約画面（1週間分作成モード）の「投稿済み・直近投稿日」表示用。
 * publishedAt降順で取得し、人物名ごとに最初に出てきたもの（＝最新）だけを残す。
 */
export async function listPostedPersonsWithLastDate(): Promise<{ personName: string; lastPublishedAt: Date }[]> {
  const rows = await db.select({ personName: instagramPosts.personName, publishedAt: instagramPosts.publishedAt })
    .from(instagramPosts)
    .orderBy(desc(instagramPosts.publishedAt));

  const seen = new Map<string, Date>();
  for (const r of rows) {
    if (!seen.has(r.personName)) seen.set(r.personName, r.publishedAt);
  }
  return Array.from(seen, ([personName, lastPublishedAt]) => ({ personName, lastPublishedAt }));
}

/**
 * 「人物 × テンプレート」の投稿履歴（読み取りのみ）。
 * 予約のうち status='published' かつ media_id ありのものをテンプレート別に数え、
 * 予約と media_id で結び付かない instagram_posts（手動投稿など）はテンプレ不明として人物ごとに持つ。
 * 判定ルールは instagram-template-history.ts の buildTemplateHistory。
 */
export async function getTemplateHistory(): Promise<TemplateHistory> {
  const [schedules, posts] = await Promise.all([
    db.select({
      personName: instagramPostSchedules.personName,
      templateId: instagramPostSchedules.templateId,
      status: instagramPostSchedules.status,
      mediaId: instagramPostSchedules.mediaId,
      publishedAt: instagramPostSchedules.publishedAt,
    }).from(instagramPostSchedules).where(eq(instagramPostSchedules.status, 'published')),
    db.select({ personName: instagramPosts.personName, mediaId: instagramPosts.mediaId, publishedAt: instagramPosts.publishedAt }).from(instagramPosts),
  ]);
  return buildTemplateHistory(schedules, posts);
}
