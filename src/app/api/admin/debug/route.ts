// デバッグ用 API — persons:published の中身と検索動作を直接確認する
// 本番にそのまま置いても問題ないが、デバッグ後は削除してよい
import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { getAllPublishedPersonsRaw } from '@/lib/published-persons';
import { getAllPersonsMerged, searchPersonsMerged } from '@/lib/persons';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';

  // 1. Redis 生データを直接読む
  const redis = getRedis();
  const redisAvailable = !!redis;
  let rawKeys: string[] = [];
  let rawCount = 0;
  let rawError: string | null = null;

  if (redis) {
    try {
      const raw = await redis.hgetall('persons:published');
      rawKeys = raw ? Object.keys(raw) : [];
      rawCount = rawKeys.length;
    } catch (err) {
      rawError = String(err);
    }
  }

  // 2. getAllPublishedPersonsRaw を通したパース後のデータ
  const publishedRecords = await getAllPublishedPersonsRaw();

  // 3. マージ後の全件
  const allMerged = await getAllPersonsMerged();

  // 4. 検索クエリがあれば検索結果も
  const searchResults = q ? await searchPersonsMerged(q) : null;

  return NextResponse.json({
    redis: {
      available: redisAvailable,
      rawKeyCount: rawCount,
      rawKeys,
      rawError,
    },
    publishedRecords: {
      count: publishedRecords.length,
      names: publishedRecords.map((r) => r.name),
    },
    allMerged: {
      count: allMerged.length,
      // 最初の 10 件だけ返す（大きくなりすぎないよう）
      sample: allMerged.slice(0, 10).map((p) => ({ name: p.name, group: p.group, genre: p.genre })),
    },
    ...(q && searchResults !== null
      ? {
          searchQuery: q,
          searchResults: {
            count: searchResults.length,
            names: searchResults.map((p) => p.name),
          },
        }
      : {}),
  });
}
