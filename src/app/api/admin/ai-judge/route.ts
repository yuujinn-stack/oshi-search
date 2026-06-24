import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { processPerson } from '@/lib/batch-processor';
import { getAllPersonsMerged } from '@/lib/persons';
import { getRedis } from '@/lib/redis';

// POST /api/admin/ai-judge
// body: { personName: "..." , forceRejudge?: boolean }
// 1人分の楽天商品取得 + AI判定を実行する個別エンドポイント
// processAllPersons() と同様に getAllPersonsMerged() から configOverride を取得し、
// JSON ファイル管理・CSV インポート（Redis 管理）どちらの人物でも正しく動作する
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: 'Redis が設定されていません。UPSTASH_REDIS_REST_URL / TOKEN を確認してください。' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({})) as { personName?: string; forceRejudge?: boolean };

  if (!body.personName) {
    return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });
  }

  // getAllPersonsMerged() で検索することで CSVインポート人物も configOverride で渡せる
  // これにより processPerson 内の「人物が見つかりません」早期リターンを回避する
  const persons = await getAllPersonsMerged();
  const personConfig = persons.find((p) => p.name === body.personName);
  if (!personConfig) {
    return NextResponse.json(
      { error: `人物が見つかりません: ${body.personName}` },
      { status: 404 },
    );
  }

  const result = await processPerson(body.personName, body.forceRejudge ?? false, personConfig);
  revalidatePath(`/person/${encodeURIComponent(body.personName)}`);
  return NextResponse.json({ ok: true, person: result });
}
