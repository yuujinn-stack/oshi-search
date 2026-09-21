import { db } from '@/db/client';
import { instagramPosts } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

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
