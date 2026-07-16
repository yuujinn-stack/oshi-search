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

  // レスポンスに診断メッセージを付与（ログと UI 表示の手がかりに）
  let message = '';
  if (result.error) {
    message = result.error;
  } else if (result.fetchFailed > 0 && result.stored === 0) {
    message = `楽天API取得エラー (${result.fetchFailed}カテゴリ)`;
  } else if (result.aiKeyMissing) {
    message = 'OPENAI_API_KEY 未設定: AI判定をスキップしました';
  } else if (result.aiFailed > 0) {
    message = `AI判定 ${result.aiQueued}件中 ${result.aiFailed}件がエラーになりました`;
  } else if (result.stored === 0 && result.skipped === 0 && result.fetchFailed === 0) {
    message = '楽天API取得0件（API未設定またはヒットなし）';
  } else if (result.aiQueued === 0 && result.stored > 0) {
    message = `取得${result.stored}件（全件判定済みのためAI判定スキップ）`;
  } else {
    message = `取得${result.stored}件 AI判定${result.aiJudged}/${result.aiQueued}件`;
  }
  console.log(`[ai-judge] operation:person-fetch-judge personName:${body.personName} stored:${result.stored} fetchFailed:${result.fetchFailed} aiQueued:${result.aiQueued} aiJudged:${result.aiJudged} aiFailed:${result.aiFailed} aiKeyMissing:${result.aiKeyMissing} message:"${message}"`);

  return NextResponse.json({ ok: true, person: { ...result, message } });
}
