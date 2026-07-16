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
  const startMs = Date.now();

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { ok: false, status: 'server_error', error: 'Redis が設定されていません。UPSTASH_REDIS_REST_URL / TOKEN を確認してください。' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({})) as { personName?: string; forceRejudge?: boolean };

  if (!body.personName) {
    return NextResponse.json({ ok: false, status: 'bad_request', error: 'personName が必要です' }, { status: 400 });
  }

  // getAllPersonsMerged() で検索することで CSVインポート人物も configOverride で渡せる
  const persons = await getAllPersonsMerged();
  const personConfig = persons.find((p) => p.name === body.personName);
  if (!personConfig) {
    return NextResponse.json(
      { ok: false, status: 'not_found', error: `人物が見つかりません: ${body.personName}` },
      { status: 404 },
    );
  }

  let result;
  try {
    result = await processPerson(body.personName, body.forceRejudge ?? false, personConfig);
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.error(`[ai-judge] operation:rakuten_refetch personName:${body.personName} status:server_error durationMs:${durationMs} error:${String(err)}`);
    return NextResponse.json(
      { ok: false, status: 'server_error', error: '処理中にエラーが発生しました' },
      { status: 500 },
    );
  }

  const durationMs = Date.now() - startMs;

  // ── RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY 未設定 ────────────────────────────
  if (result.rakutenConfigMissing) {
    console.log(`[ai-judge] operation:rakuten_refetch personName:${body.personName} status:config_missing durationMs:${durationMs} envVarsMissing:RAKUTEN_APP_ID,RAKUTEN_ACCESS_KEY`);
    return NextResponse.json(
      { ok: false, status: 'config_missing', error: '楽天APIの設定が不足しています（RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY）' },
      { status: 503 },
    );
  }

  // ── 楽天API upstream エラー（全カテゴリ取得0件） ─────────────────────────
  if (result.fetchFailed > 0 && result.stored === 0 && result.upstreamHttpStatus !== undefined) {
    const httpStatus = result.upstreamHttpStatus;
    console.log(`[ai-judge] operation:rakuten_refetch personName:${body.personName} status:upstream_error upstreamHttpStatus:${httpStatus} fetchFailed:${result.fetchFailed} durationMs:${durationMs}`);
    return NextResponse.json(
      { ok: false, status: 'upstream_error', error: `楽天APIが ${httpStatus} を返しました`, httpStatus },
      { status: 502 },
    );
  }

  // ── ネットワーク障害 / タイムアウト（全カテゴリ取得0件） ──────────────────
  if (result.fetchFailed > 0 && result.stored === 0 && result.upstreamHttpStatus === undefined) {
    console.log(`[ai-judge] operation:rakuten_refetch personName:${body.personName} status:network_error fetchFailed:${result.fetchFailed} durationMs:${durationMs}`);
    return NextResponse.json(
      { ok: false, status: 'network_error', error: '楽天APIへの接続に失敗しました（タイムアウトまたはネットワーク障害）' },
      { status: 500 },
    );
  }

  // ── DB保存失敗 ────────────────────────────────────────────────────────────
  if (result.error?.startsWith('DB保存失敗')) {
    console.error(`[ai-judge] operation:rakuten_refetch personName:${body.personName} status:db_error durationMs:${durationMs} error:${result.error}`);
    return NextResponse.json(
      { ok: false, status: 'db_error', error: 'データベースへの保存に失敗しました' },
      { status: 500 },
    );
  }

  revalidatePath(`/person/${encodeURIComponent(body.personName)}`);

  // ── 正常系メッセージ生成 ──────────────────────────────────────────────────
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
    message = '楽天API正常・該当商品0件';
  } else if (result.aiQueued === 0 && result.stored > 0) {
    message = `取得${result.stored}件（全件判定済みのためAI判定スキップ）`;
  } else {
    message = `取得${result.stored}件 AI判定${result.aiJudged}/${result.aiQueued}件`;
  }

  console.log([
    `[ai-judge] operation:rakuten_refetch`,
    `personName:${body.personName}`,
    `status:ok`,
    `fetched:${result.stored}`,
    `skipped:${result.skipped}`,
    `excluded:${result.excluded}`,
    `fetchFailed:${result.fetchFailed}`,
    `upstreamHttpStatus:${result.upstreamHttpStatus ?? '-'}`,
    `targeted:${result.aiQueued}`,
    `processed:${result.aiJudged}`,
    `succeeded:${result.aiJudged}`,
    `failed:${result.aiFailed}`,
    `related:${result.relatedCount}`,
    `unrelated:${result.unrelatedCount}`,
    `uncertain:${result.uncertainCount}`,
    `durationMs:${durationMs}`,
  ].join(' '));

  return NextResponse.json({ ok: true, person: { ...result, message } });
}
