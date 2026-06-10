import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { processAllPersons, processPerson } from '@/lib/batch-processor';
import { getRedis } from '@/lib/redis';

// POST /api/admin/batch
// body: {} → 全員処理
// body: { personName: "..." } → 1人だけ処理（タイムアウト回避のため推奨）
// 認証: middleware で admin-session Cookie を検証済み
export async function POST(req: NextRequest) {
  // Redis 接続確認（未設定なら即座にエラーを返す）
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      {
        error:
          'Redis が設定されていません。Vercel ダッシュボードの環境変数に UPSTASH_REDIS_REST_URL と UPSTASH_REDIS_REST_TOKEN を設定してください。',
      },
      { status: 503 },
    );
  }

  let body: { personName?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body なし or 無効な JSON → 全員処理とみなす
  }

  try {
    if (body.personName) {
      // 1人だけ処理（クライアントが1人ずつ呼ぶ方式）
      const result = await processPerson(body.personName);
      revalidatePath(`/person/${encodeURIComponent(body.personName)}`);
      return NextResponse.json({ ok: true, person: result });
    }

    // 後方互換: body なしの場合は全員処理（Cron から直接呼ぶ場合など）
    const summary = await processAllPersons();
    // 全人物の ISR キャッシュをクリア
    for (const p of summary.persons) {
      revalidatePath(`/person/${encodeURIComponent(p.personName)}`);
    }
    const elapsed = ((summary.finishedAt - summary.startedAt) / 1000).toFixed(1);
    const errors = summary.persons.filter((p) => p.error);
    const totalStored = summary.persons.reduce((s, r) => s + r.stored, 0);

    return NextResponse.json({
      ok: true,
      elapsed: `${elapsed}秒`,
      personCount: summary.persons.length,
      totalStored,
      totalAiJudged: summary.totalAiCalls,
      errors: errors.map((e) => ({ name: e.personName, error: e.error })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
