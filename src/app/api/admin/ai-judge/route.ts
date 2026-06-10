import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { processPerson } from '@/lib/batch-processor';
import { getRedis } from '@/lib/redis';

// POST /api/admin/ai-judge
// body: { personName: "..." }
// 1人分の楽天商品取得 + AI判定を実行する個別エンドポイント
// 既存の一括処理 /api/admin/batch とは独立して動作する
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: 'Redis が設定されていません。UPSTASH_REDIS_REST_URL / TOKEN を確認してください。' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({})) as { personName?: string };

  if (!body.personName) {
    return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });
  }

  const result = await processPerson(body.personName);
  revalidatePath(`/person/${encodeURIComponent(body.personName)}`);
  return NextResponse.json({ ok: true, person: result });
}
